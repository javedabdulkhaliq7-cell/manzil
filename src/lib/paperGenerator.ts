// Phase 9: generates a practice paper from answer-ready question-bank rows.
// One pure module: it works only on the data passed in (no database, no network, no AI),
// so the same code can run online now and offline later.

export type BlueprintSection = {
  part: string
  heading: string
  instruction: string
  // 'writing' = a letter, application or essay question. It is only used in full-book papers.
  type: 'mcq' | 'short' | 'long' | 'writing'
  count: number
  marks_each: number
  attempt?: number // "attempt any N of count"
  or?: boolean // each long question comes with an alternative
}

export type Blueprint = {
  pattern: string
  board: string
  title: string
  subject_line: string
  time_minutes: number
  total_marks: number
  sections: BlueprintSection[]
}

export type BankMcq = {
  id: string
  chapter_id: string
  question: string
  option_a: string
  option_b: string
  option_c: string
  option_d: string
  correct_option: string
  image_url?: string | null
  diagram_type?: string | null
}

export type BankWritten = {
  id: string
  chapter_id: string
  question: string
  answer: string | null
  rubric: unknown
  marks: number | null
  image_url?: string | null
  diagram_type?: string | null
}

// A letter, application or essay question taken from the real past papers (it belongs to no chapter).
export type BankWriting = {
  id: string
  section_type: string // 'letter' or 'essay'
  question: string
  marks: number | null
  year?: number | null
}

export type GenChapter = { id: string; number: number }

export type GenerateInput = {
  scope: 'full' | 'chapters'
  chapterIds: string[] // used when scope is 'chapters'
  blueprint: Blueprint
  chapters: GenChapter[]
  mcqs: BankMcq[]
  shorts: BankWritten[]
  longs: BankWritten[]
  writing?: BankWriting[] // used only when scope is 'full'
  importance: Record<string, number> // chapter id -> importance percentage
  repeatCounts: Record<string, number> // "table:id" -> how many times it repeated in past papers
  used: Record<string, number> // "table:id" -> when it was last given (ms)
  rng?: () => number
  now?: Date
}

export type BankTable = 'mcqs' | 'short_questions' | 'long_questions' | 'past_paper_questions'

export type BankPick = { table: BankTable; id: string }

export type SnapshotSection = {
  id: string
  part_name: string
  position: number
  instruction: string
  attempt_count: number | null
  choose_from: number | null
}

export type SnapshotQuestion = {
  id: string
  section_id: string
  part_name: string
  section_type: 'mcq' | 'short' | 'long'
  question_number: number
  sub_part: string | null
  question: string
  options: string[] | null
  answer: string
  marks: number
  or_pair_key: string | null
  is_alternate: boolean
  rubric: unknown
  group_id: null
  chapter_id: string | null // null for letters, applications and essays
  bank_table: BankTable
  bank_question_id: string
}

export type GeneratedPaper = {
  version: 1
  header: {
    title: string
    exam_title: string
    board: string
    subject_line: string
    total_marks: number
    time_minutes: number
    pattern: string
    paper_note: string
    year: number
  }
  sections: SnapshotSection[]
  questions: SnapshotQuestion[]
}

export type GenerateResult = { paper: GeneratedPaper; picks: BankPick[]; chapterIds: string[] }

export class NotEnoughQuestionsError extends Error {
  part: string
  needed: number
  available: number
  constructor(part: string, needed: number, available: number) {
    super(`Not enough questions for ${part}: need ${needed}, found ${available}`)
    this.name = 'NotEnoughQuestionsError'
    this.part = part
    this.needed = needed
    this.available = available
  }
}

// Total marks of the paper. A chapter paper leaves out the writing questions, so its total is lower.
export function paperTotalFor(bp: Blueprint, scope: 'full' | 'chapters'): number {
  if (scope !== 'chapters') return bp.total_marks
  const writing = bp.sections
    .filter(s => s.type === 'writing')
    .reduce((sum, s) => sum + (s.attempt && s.attempt < s.count ? s.attempt : s.count) * s.marks_each, 0)
  return bp.total_marks - writing
}

// ---- tuning constants -------------------------------------------------------
const BASE_WEIGHT = 1
const REPEAT_BONUS_PER_EXTRA = 1.5 // weight added for each extra time a question repeated
const TINY_WEIGHT = 0.01 // chapters with no importance still help if others run short
const LABEL = 'IQRA Test Paper'

type Rng = () => number
const OPTION_KEYS = ['A', 'B', 'C', 'D'] as const

function hasDiagram(x: { image_url?: string | null; diagram_type?: string | null }): boolean {
  return !!(x.image_url && x.image_url.trim()) || !!(x.diagram_type && x.diagram_type.trim())
}

function rubricTotal(raw: unknown): number {
  if (!Array.isArray(raw)) return 0
  return raw.reduce((sum, r) => sum + (r && typeof r === 'object' ? Number((r as { points?: number }).points ?? 0) : 0), 0)
}

function keyOf(table: BankTable, id: string): string {
  return `${table}:${id}`
}

// Weighted random draw without replacement.
function weightedSample<T>(items: T[], k: number, weightOf: (t: T) => number, rng: Rng): T[] {
  const pool = items.slice()
  const out: T[] = []
  while (out.length < k && pool.length > 0) {
    const weights = pool.map(weightOf)
    const total = weights.reduce((a, b) => a + b, 0)
    let r = rng() * total
    let idx = 0
    for (; idx < pool.length - 1; idx++) {
      r -= weights[idx]
      if (r <= 0) break
    }
    out.push(pool[idx])
    pool.splice(idx, 1)
  }
  return out
}

// Choose k questions from one chapter: fresh ones first (weighted draw),
// then, if the chapter has run out, the ones given longest ago.
function drawFromChapter<T extends { id: string }>(
  items: T[], k: number, table: BankTable,
  repeatCounts: Record<string, number>, used: Record<string, number>, rng: Rng,
): T[] {
  const fresh = items.filter(i => used[keyOf(table, i.id)] === undefined)
  const weightOf = (t: T) => BASE_WEIGHT + REPEAT_BONUS_PER_EXTRA * Math.max(0, (repeatCounts[keyOf(table, t.id)] ?? 1) - 1)
  if (fresh.length >= k) return weightedSample(fresh, k, weightOf, rng)
  const reused = items
    .filter(i => used[keyOf(table, i.id)] !== undefined)
    .map(i => ({ i, t: used[keyOf(table, i.id)], tie: rng() }))
    .sort((a, b) => a.t - b.t || a.tie - b.tie)
    .map(x => x.i)
  return [...fresh, ...reused.slice(0, k - fresh.length)]
}

// Decide how many slots each chapter gets.
// Proportional to weight, at least one each where the slot count allows, never above capacity.
function allocate(
  n: number, weights: Map<string, number>, capacity: Map<string, number>, rng: Rng,
): Map<string, number> | null {
  const ids = Array.from(weights.keys()).filter(id => (capacity.get(id) ?? 0) > 0 && (weights.get(id) ?? 0) > 0)
  const totalCap = ids.reduce((s, id) => s + (capacity.get(id) ?? 0), 0)
  if (n === 0) return new Map()
  if (totalCap < n) return null

  const out = new Map<string, number>()
  if (n < ids.length) {
    const chosen = weightedSample(ids, n, id => weights.get(id) ?? 0, rng)
    chosen.forEach(id => out.set(id, 1))
    return out
  }

  // Every chapter gets one slot, then the rest are shared out in proportion to weight.
  // Random rounding means that, over many papers, each chapter gets its fair share.
  const wSum = ids.reduce((s, id) => s + (weights.get(id) ?? 0), 0)
  const extraSlots = n - ids.length
  const ideal = new Map<string, number>()
  const extra = new Map<string, number>()
  ids.forEach(id => {
    const x = (extraSlots * (weights.get(id) ?? 0)) / wSum
    ideal.set(id, x)
    const rounded = Math.floor(x) + (rng() < x - Math.floor(x) ? 1 : 0)
    extra.set(id, Math.min((capacity.get(id) ?? 1) - 1, rounded))
  })
  const total = () => Array.from(extra.values()).reduce((a, b) => a + b, 0)
  let guard = 0
  while (total() > extraSlots && guard++ < 1000) {
    const cand = ids.filter(id => extra.get(id)! > 0)
    cand.sort((a, b) => (extra.get(b)! - ideal.get(b)!) - (extra.get(a)! - ideal.get(a)!) || rng() - 0.5)
    extra.set(cand[0], extra.get(cand[0])! - 1)
  }
  while (total() < extraSlots && guard++ < 2000) {
    const cand = ids.filter(id => extra.get(id)! < (capacity.get(id) ?? 1) - 1)
    if (cand.length === 0) return null
    cand.sort((a, b) => (ideal.get(b)! - extra.get(b)!) - (ideal.get(a)! - extra.get(a)!) || rng() - 0.5)
    extra.set(cand[0], extra.get(cand[0])! + 1)
  }
  if (total() !== extraSlots) return null
  ids.forEach(id => out.set(id, 1 + extra.get(id)!))
  return out
}

export function generatePaper(input: GenerateInput): GenerateResult {
  const rng: Rng = input.rng ?? Math.random
  const now = input.now ?? new Date()
  const bp = input.blueprint
  const chapterNumber = new Map(input.chapters.map(c => [c.id, c.number]))
  const chapterRank = (id: string) => chapterNumber.get(id) ?? 999

  const scopeSet = input.scope === 'chapters' ? new Set(input.chapterIds) : null
  const inScope = (chapterId: string) => !scopeSet || scopeSet.has(chapterId)

  // Only answer-ready, diagram-free questions, in scope.
  const mcqPool = input.mcqs.filter(q =>
    inScope(q.chapter_id) && !hasDiagram(q) &&
    OPTION_KEYS.includes(String(q.correct_option).toUpperCase() as typeof OPTION_KEYS[number]) &&
    [q.option_a, q.option_b, q.option_c, q.option_d].every(o => typeof o === 'string' && o.trim() !== ''))
  const writtenOk = (q: BankWritten, marks: number) =>
    inScope(q.chapter_id) && !hasDiagram(q) && !!q.answer && q.answer.trim() !== '' &&
    Array.isArray(q.rubric) && rubricTotal(q.rubric) === marks

  const sections: SnapshotSection[] = []
  const questions: SnapshotQuestion[] = []
  const picks: BankPick[] = []
  const alreadyPicked = new Set<string>()
  let questionNumber = 0

  // Importance weights: full paper follows chapter importance, chapter-wise is even.
  function weightsFor(chapterIds: string[], capacity: Map<string, number>, needed: number): Map<string, number> {
    const w = new Map<string, number>()
    if (input.scope === 'chapters') {
      chapterIds.forEach(id => w.set(id, 1))
      return w
    }
    chapterIds.forEach(id => {
      const imp = input.importance[id] ?? 0
      if (imp > 0) w.set(id, imp)
    })
    const weightedCap = Array.from(w.keys()).reduce((s, id) => s + (capacity.get(id) ?? 0), 0)
    if (w.size === 0 || weightedCap < needed) chapterIds.forEach(id => { if (!w.has(id)) w.set(id, TINY_WEIGHT) })
    return w
  }

  const byChapter = <T extends { chapter_id: string }>(rows: T[]): Map<string, T[]> => {
    const m = new Map<string, T[]>()
    rows.forEach(r => m.set(r.chapter_id, [...(m.get(r.chapter_id) ?? []), r]))
    return m
  }

  // A chapter paper leaves out letters, applications and essays: they belong to no chapter.
  const sectionsToUse = input.scope === 'chapters' ? bp.sections.filter(s => s.type !== 'writing') : bp.sections

  sectionsToUse.forEach((bs, sIndex) => {
    const sectionId = `gen-sec-${sIndex + 1}`

    // Letters, applications and essays (full papers only), taken from the real past papers.
    // They have no model answer yet, so the student marks them by hand in the exam screen.
    if (bs.type === 'writing') {
      const pair = !!bs.or
      const need = bs.count * (pair ? 2 : 1)
      const pool = (input.writing ?? []).filter(w => !alreadyPicked.has(keyOf('past_paper_questions', w.id)))
      if (pool.length < need) throw new NotEnoughQuestionsError(bs.part, need, pool.length)
      const partName = bs.heading || bs.part
      sections.push({
        id: sectionId, part_name: partName, position: sIndex + 1, instruction: bs.instruction,
        attempt_count: null, choose_from: null,
      })
      const taken = new Set<string>()
      const takeOne = (preferLetter: boolean): BankWriting => {
        const free = pool.filter(w => !taken.has(w.id))
        const letters = free.filter(w => w.section_type === 'letter')
        const from = preferLetter && letters.length > 0 ? letters : free
        const w = from[Math.floor(rng() * from.length)]
        taken.add(w.id)
        return w
      }
      for (let n = 0; n < bs.count; n++) {
        const members = pair ? [takeOne(true), takeOne(false)] : [takeOne(false)]
        questionNumber += 1
        members.forEach((w, idx) => {
          alreadyPicked.add(keyOf('past_paper_questions', w.id))
          questions.push({
            id: w.id, section_id: sectionId, part_name: partName, section_type: 'long', group_id: null,
            chapter_id: null, bank_table: 'past_paper_questions', bank_question_id: w.id,
            question_number: questionNumber, sub_part: null, question: w.question,
            options: null, answer: '', marks: bs.marks_each,
            or_pair_key: pair ? `Q${questionNumber}` : null, is_alternate: idx === 1, rubric: null,
          })
        })
      }
      return
    }
    const isPair = bs.type === 'long' && !!bs.or
    sections.push({
      id: sectionId,
      part_name: bs.heading || bs.part,
      position: sIndex + 1,
      instruction: bs.instruction,
      attempt_count: bs.attempt && bs.attempt < bs.count ? bs.attempt : null,
      choose_from: bs.attempt && bs.attempt < bs.count ? bs.count : null,
    })

    // 1. Pool for this section, by chapter, minus anything already in this paper
    const table: BankTable = bs.type === 'mcq' ? 'mcqs' : bs.type === 'short' ? 'short_questions' : 'long_questions'
    type Row = { id: string; chapter_id: string }
    let rows: Row[]
    if (bs.type === 'mcq') rows = mcqPool
    else rows = (bs.type === 'short' ? input.shorts : input.longs).filter(q => writtenOk(q, bs.marks_each))
    rows = rows.filter(r => !alreadyPicked.has(keyOf(table, r.id)))
    const grouped = byChapter(rows)

    // 2. How many slots per chapter (pairs count as one slot, but need two questions)
    const slotsNeeded = bs.count
    const capacity = new Map<string, number>()
    grouped.forEach((list, id) => capacity.set(id, isPair ? Math.floor(list.length / 2) : list.length))
    const weights = weightsFor(Array.from(grouped.keys()), capacity, slotsNeeded)
    const alloc = allocate(slotsNeeded, weights, capacity, rng)
    if (!alloc) {
      const available = Array.from(capacity.values()).reduce((a, b) => a + b, 0)
      throw new NotEnoughQuestionsError(bs.part, slotsNeeded, available)
    }

    // 3. Draw the questions, chapter by chapter, in syllabus order
    const chapterOrder = Array.from(alloc.keys()).sort((a, b) => chapterRank(a) - chapterRank(b))
    const chosen: { q: Row; pair?: Row }[] = []
    for (const cid of chapterOrder) {
      const slots = alloc.get(cid)!
      const list = grouped.get(cid)!
      const need = isPair ? slots * 2 : slots
      const drawn = drawFromChapter(list as Array<Row & { id: string }>, need, table, input.repeatCounts, input.used, rng)
      if (isPair) for (let i = 0; i < drawn.length; i += 2) chosen.push({ q: drawn[i], pair: drawn[i + 1] })
      else drawn.forEach(q => chosen.push({ q }))
    }
    chosen.forEach(c => {
      alreadyPicked.add(keyOf(table, c.q.id))
      if (c.pair) alreadyPicked.add(keyOf(table, c.pair.id))
    })

    // 4. Write them into the snapshot
    const partName = bs.heading || bs.part
    const common = (id: string, chapterId: string) => ({
      section_id: sectionId, part_name: partName, section_type: bs.type as 'mcq' | 'short' | 'long', group_id: null as null,
      chapter_id: chapterId, bank_table: table, bank_question_id: id,
    })
    if (bs.type === 'mcq') {
      questionNumber += 1
      chosen.forEach((c, i) => {
        const m = c.q as BankMcq
        const letter = String(m.correct_option).toUpperCase() as typeof OPTION_KEYS[number]
        const opts = [m.option_a, m.option_b, m.option_c, m.option_d]
        questions.push({
          ...common(m.id, m.chapter_id),
          id: m.id, question_number: questionNumber, sub_part: String(i + 1), question: m.question,
          options: opts, answer: `${letter}) ${opts[OPTION_KEYS.indexOf(letter)]}`,
          marks: bs.marks_each, or_pair_key: null, is_alternate: false, rubric: null,
        })
        picks.push({ table, id: m.id })
      })
    } else if (bs.type === 'short') {
      questionNumber += 1
      chosen.forEach((c, i) => {
        const w = c.q as BankWritten
        questions.push({
          ...common(w.id, w.chapter_id),
          id: w.id, question_number: questionNumber, sub_part: String(i + 1).padStart(2, '0'), question: w.question,
          options: null, answer: w.answer as string, marks: bs.marks_each, or_pair_key: null,
          is_alternate: false, rubric: w.rubric,
        })
        picks.push({ table, id: w.id })
      })
    } else {
      chosen.forEach(c => {
        questionNumber += 1
        const members = c.pair ? [c.q, c.pair] : [c.q]
        members.forEach((row, idx) => {
          const w = row as BankWritten
          questions.push({
            ...common(w.id, w.chapter_id),
            id: w.id, question_number: questionNumber, sub_part: null, question: w.question,
            options: null, answer: w.answer as string, marks: bs.marks_each,
            or_pair_key: c.pair ? `Q${questionNumber}` : null, is_alternate: idx === 1, rubric: w.rubric,
          })
          picks.push({ table, id: w.id })
        })
      })
    }
  })

  // The paper must add up to exactly the blueprint's total
  const expectedTotal = paperTotalFor(bp, input.scope)
  const counted = sectionsToUse.reduce((sum, bs) => sum + (bs.attempt && bs.attempt < bs.count ? bs.attempt : bs.count) * bs.marks_each, 0)
  if (counted !== expectedTotal) throw new Error(`Generated paper adds up to ${counted}, expected ${expectedTotal}`)

  const chapterIds = Array.from(new Set(questions.map(q => q.chapter_id).filter((id): id is string => !!id)))
  return {
    paper: {
      version: 1,
      header: {
        title: `${LABEL}`,
        exam_title: bp.title.replace(/model paper/i, 'Practice Paper'),
        board: 'balochistan',
        subject_line: bp.subject_line,
        total_marks: expectedTotal,
        time_minutes: bp.time_minutes,
        pattern: bp.pattern,
        paper_note: LABEL,
        year: now.getFullYear(),
      },
      sections,
      questions,
    },
    picks,
    chapterIds,
  }
}
