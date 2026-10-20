// Pure scoring logic for past-paper Exam mode. No React, no database.
// Rules come from the build plan: MCQs marked against the stored correct option,
// written answers self-marked, OR pairs count once, "attempt any N" counts the best N.

export type ExamQuestion = {
  id: string
  section_id: string | null
  part_name: string | null
  section_type: string
  question_number: number
  sub_part: string | null
  question: string
  options: string[] | null
  answer: string | null
  marks: number | null
  or_pair_key: string | null
  is_alternate: boolean | null
  rubric: unknown
  chapter_id: string | null
}

export type ExamSection = {
  id: string
  part_name: string
  position: number
  instruction: string | null
  attempt_count: number | null
  choose_from: number | null
}

// One thing the student answers: a single question, or an OR pair (two alternatives).
export type Slot = {
  key: string
  sectionId: string
  kind: 'mcq' | 'written'
  alts: ExamQuestion[] // length 1, or 2 for an OR pair
}

// What the student did on one slot.
export type SlotAnswer = {
  option?: number // MCQ: index of the chosen option
  choice?: number // written: index of the alternative answered (0 for a single question)
}

export type Awards = Record<string, number> // question id -> self-marked marks (written)

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

export function letterOf(index: number): string {
  return OPTION_LETTERS[index] ?? String(index + 1)
}

// MCQ answers are stored like "B) option text". Returns the letter, or null.
export function correctLetter(answer: string | null): string | null {
  if (!answer) return null
  const m = answer.trim().match(/^\(?([A-Fa-f])[)\].:\s]/)
  return m ? m[1].toUpperCase() : null
}

export function marksOf(q: ExamQuestion): number {
  return Number(q.marks ?? 0)
}

// The practical part is printed on the paper but sits outside the paper's marks.
export function isPracticalSection(s: ExamSection): boolean {
  return /^\s*practical/i.test(s.part_name)
}

function sortQuestions(a: ExamQuestion, b: ExamQuestion): number {
  if (a.question_number !== b.question_number) return a.question_number - b.question_number
  const altA = a.is_alternate ? 1 : 0
  const altB = b.is_alternate ? 1 : 0
  if (altA !== altB) return altA - altB
  return (a.sub_part ?? '').localeCompare(b.sub_part ?? '', undefined, { numeric: true })
}

export function buildSlots(sections: ExamSection[], questions: ExamQuestion[]): Slot[] {
  const slots: Slot[] = []
  const sorted = questions.slice().sort(sortQuestions)
  for (const section of sections.slice().sort((a, b) => a.position - b.position)) {
    const qs = sorted.filter(q => {
      if (q.section_id) return q.section_id === section.id
      return q.part_name === section.part_name
    })
    const pairs = new Map<string, ExamQuestion[]>()
    for (const q of qs) {
      if (q.or_pair_key) {
        const k = q.or_pair_key
        pairs.set(k, [...(pairs.get(k) ?? []), q])
      }
    }
    const used = new Set<string>()
    for (const q of qs) {
      if (used.has(q.id)) continue
      const members = q.or_pair_key ? pairs.get(q.or_pair_key) ?? [] : []
      if (members.length >= 2) {
        members.forEach(m => used.add(m.id))
        slots.push({ key: `${section.id}:${q.or_pair_key}`, sectionId: section.id, kind: 'written', alts: members })
      } else {
        used.add(q.id)
        slots.push({
          key: q.id,
          sectionId: section.id,
          kind: q.section_type === 'mcq' ? 'mcq' : 'written',
          alts: [q],
        })
      }
    }
  }
  return slots
}

export function slotMarks(slot: Slot): number {
  return marksOf(slot.alts[0])
}

export function isAttempted(slot: Slot, a: SlotAnswer | undefined): boolean {
  if (!a) return false
  return slot.kind === 'mcq' ? a.option !== undefined : a.choice !== undefined
}

export function isMarkableMcq(slot: Slot): boolean {
  return slot.kind === 'mcq' && correctLetter(slot.alts[0].answer) !== null
}

export function chosenQuestion(slot: Slot, a: SlotAnswer | undefined): ExamQuestion | null {
  if (!a) return null
  if (slot.kind === 'mcq') return slot.alts[0]
  if (a.choice === undefined) return null
  return slot.alts[a.choice] ?? null
}

// Marks earned on one slot.
export function awardedFor(slot: Slot, a: SlotAnswer | undefined, awards: Awards): number {
  if (!isAttempted(slot, a)) return 0
  if (slot.kind === 'mcq') {
    const right = correctLetter(slot.alts[0].answer)
    if (!right) return 0
    return letterOf(a!.option!) === right ? marksOf(slot.alts[0]) : 0
  }
  const q = chosenQuestion(slot, a)
  if (!q) return 0
  const v = awards[q.id] ?? 0
  return Math.min(Math.max(v, 0), marksOf(q))
}

export type SectionPlan = {
  limit: number | null // "attempt any N": only N count
  total: number // marks the section is worth
}

export function sectionPlan(section: ExamSection, slots: Slot[]): SectionPlan {
  const mine = slots.filter(s => s.sectionId === section.id)
  const n = section.attempt_count
  if (n !== null && n > 0 && n < mine.length) {
    const top = mine.map(slotMarks).sort((a, b) => b - a).slice(0, n)
    return { limit: n, total: top.reduce((x, y) => x + y, 0) }
  }
  return { limit: null, total: mine.reduce((x, s) => x + slotMarks(s), 0) }
}

// The slots that count towards the score: all of them, or the best N attempted.
export function countedSlots(
  section: ExamSection, slots: Slot[], answers: Record<string, SlotAnswer>, awards: Awards,
): Slot[] {
  const mine = slots.filter(s => s.sectionId === section.id)
  const plan = sectionPlan(section, slots)
  if (plan.limit === null) return mine
  return mine
    .filter(s => isAttempted(s, answers[s.key]))
    .sort((a, b) => awardedFor(b, answers[b.key], awards) - awardedFor(a, answers[a.key], awards))
    .slice(0, plan.limit)
}

export type SectionResult = {
  section: ExamSection
  total: number
  obtained: number
  unmarkableMarks: number // MCQ marks that could not be marked (no stored correct option)
}

export type ExamResult = {
  sections: SectionResult[]
  total: number
  obtained: number
  unmarkableCount: number
  unmarkableMarks: number
}

export function computeResult(
  sections: ExamSection[], slots: Slot[], answers: Record<string, SlotAnswer>, awards: Awards,
): ExamResult {
  const out: SectionResult[] = []
  let unmarkableCount = 0
  for (const section of sections) {
    const plan = sectionPlan(section, slots)
    const counted = countedSlots(section, slots, answers, awards)
    const obtained = counted.reduce((sum, s) => sum + awardedFor(s, answers[s.key], awards), 0)
    let unmarkableMarks = 0
    if (plan.limit === null) {
      for (const s of slots.filter(x => x.sectionId === section.id)) {
        if (s.kind === 'mcq' && !isMarkableMcq(s)) {
          unmarkableMarks += slotMarks(s)
          unmarkableCount += 1
        }
      }
    }
    out.push({ section, total: plan.total, obtained, unmarkableMarks })
  }
  return {
    sections: out,
    total: out.reduce((x, r) => x + r.total, 0),
    obtained: out.reduce((x, r) => x + r.obtained, 0),
    unmarkableCount,
    unmarkableMarks: out.reduce((x, r) => x + r.unmarkableMarks, 0),
  }
}

export type WeakChapter = { chapterId: string; lost: number }

// Chapters where the most marks were lost, worst first. Only marks that can be
// attributed to a chapter count (answered or required questions with a chapter tag).
export function weakChapters(
  sections: ExamSection[], slots: Slot[], answers: Record<string, SlotAnswer>, awards: Awards,
): WeakChapter[] {
  const lostBy = new Map<string, number>()
  for (const section of sections) {
    for (const s of countedSlots(section, slots, answers, awards)) {
      if (s.kind === 'mcq' && !isMarkableMcq(s)) continue
      const a = answers[s.key]
      const q = s.kind === 'mcq' ? s.alts[0] : chosenQuestion(s, a) ?? (s.alts.length === 1 ? s.alts[0] : null)
      if (!q || !q.chapter_id) continue
      const lost = marksOf(q) - awardedFor(s, a, awards)
      if (lost > 0) lostBy.set(q.chapter_id, (lostBy.get(q.chapter_id) ?? 0) + lost)
    }
  }
  return Array.from(lostBy.entries())
    .map(([chapterId, lost]) => ({ chapterId, lost }))
    .sort((a, b) => b.lost - a.lost)
}

export type RubricPoint = { points?: number; concept?: string; keywords?: string[] }

export function parseRubric(raw: unknown): RubricPoint[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(r => r && typeof r === 'object' && typeof (r as RubricPoint).concept === 'string') as RubricPoint[]
}

// Marks from a tick-list, capped at the question's marks.
export function marksFromTicks(rubric: RubricPoint[], ticked: number[], max: number): number {
  const sum = ticked.reduce((x, i) => x + Number(rubric[i]?.points ?? 1), 0)
  return Math.min(sum, max)
}
