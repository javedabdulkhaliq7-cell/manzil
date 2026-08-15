// multiPartQuestion.ts
//
// Shared by ChapterExerciseTab.tsx and ExerciseTestPrintView.tsx.
// Both files show LISTS of book_exercises rows where siblings (same
// question_number, different sub_part) may share one instructional
// stem baked into every part's `question` text — e.g. "Simplify the
// following: (i) ..." / "Simplify the following: (ii) ...". This
// repetition is intentional at the DATA layer (a part must read fine
// standalone if drawn alone in Custom Test), but when a view shows all
// siblings together, the shared stem should print once, not per line.
//
// Deliberately generic — a set of rows with NO real shared stem (e.g.
// distinct MCQ questions that happen to share a question_number) just
// yields an empty/near-empty extracted intro and falls back to normal
// per-item display. Nothing here assumes every group has a real intro.

export interface MultiPartRow {
  id: string
  question_number: number
  sub_part?: string | null
  question: string
  /** Real multiple-choice options, when this row is an MCQ. A genuine
   *  multi-part question (e.g. "Verify: (i)... (ii)...") never has
   *  per-part MCQ options — if ANY sibling in a would-be group has
   *  options, they're actually independent MCQs that happen to share
   *  a prefix and consecutive sub_part values (seen in Chapter 2's
   *  Review MCQs, all starting "Choose the correct answer:"), not real
   *  parts of one question. Never group in that case. */
  options?: unknown
  [key: string]: any
}

const ROMAN_ORDER: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12,
}

export function romanToInt(sub_part?: string | null): number {
  if (!sub_part) return 0
  return ROMAN_ORDER[sub_part.toLowerCase()] ?? 999
}

/** Sorts by question_number, then by sub_part in real roman-numeral
 *  order (not alphabetical — "ii" must come before "iv", not after). */
export function sortByQuestionAndPart<T extends MultiPartRow>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.question_number !== b.question_number) return a.question_number - b.question_number
    return romanToInt(a.sub_part) - romanToInt(b.sub_part)
  })
}

export interface PartGroup<T> {
  question_number: number
  /** Shared leading text across every sibling part, trimmed to a full
   *  word boundary. Empty string if the siblings have no real common
   *  stem (e.g. distinct MCQ stems) — callers should just show each
   *  part's full text in that case. */
  intro: string
  parts: { item: T; label: string; text: string }[]
}

export type GroupedItem<T> = PartGroup<T> | { question_number: number; single: T }

/** Groups consecutive rows sharing a question_number + having a
 *  sub_part into one PartGroup, extracting their longest common
 *  leading text as the shared intro. Rows with no sub_part (or the
 *  only row for that question_number) pass through ungrouped. */
export function groupMultiPartQuestions<T extends MultiPartRow>(items: T[]): GroupedItem<T>[] {
  const sorted = sortByQuestionAndPart(items)
  const groups: GroupedItem<T>[] = []
  let i = 0
  while (i < sorted.length) {
    const qn = sorted[i].question_number
    const bucket: T[] = []
    while (i < sorted.length && sorted[i].question_number === qn) {
      bucket.push(sorted[i])
      i++
    }
    if (bucket.length === 1 || !bucket[0].sub_part || bucket.some(b => b.options != null)) {
      for (const b of bucket) groups.push({ question_number: qn, single: b })
      continue
    }

    let intro = bucket[0].question
    for (const b of bucket.slice(1)) {
      let j = 0
      while (j < intro.length && j < b.question.length && intro[j] === b.question[j]) j++
      intro = intro.slice(0, j)
    }
    const lastSpace = intro.lastIndexOf(' ')
    intro = (lastSpace > 0 ? intro.slice(0, lastSpace) : '').trim().replace(/[:,-]$/, '')

    const parts = bucket.map(item => ({
      item,
      label: item.sub_part ?? '',
      text: item.question.slice(intro.length).trim().replace(/^\(([ivx]+)\)\s*/i, ''),
    }))
    groups.push({ question_number: qn, intro, parts })
  }
  return groups
}
