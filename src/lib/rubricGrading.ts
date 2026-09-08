export interface RubricConcept {
  concept: string
  keywords: string[]
  points: number
}

export interface RubricHit {
  concept: string
  matched: boolean
  points: number
}

export interface RubricGradeResult {
  score: number
  max: number
  hits: RubricHit[]
  /** What the student actually typed, so review screens can show it
   *  verbatim instead of echoing the model answer back. */
  studentAnswer: string
}

// Character-difference check for typo tolerance on single-word keywords —
// not a spellchecker, just lets "Anopheless" match "anopheles" without
// needing exact spelling. Mirrors the tolerance already used for
// Fill-in-Blank grading in ChapterMockTestScreen.tsx.
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

// ============================================================
// Confirmed live shapes (Sep 2026 DB audit — see conversation notes).
// `rubric` is NOT consistently an array of {concept,keywords,points}
// across subjects/tables. Real shapes seen in production:
//   - the expected [{concept,keywords,points}] array (most rows)
//   - a plain human-readable grading note string (all of Math's
//     long_questions.rubric — meant for a human, not keyword-matchable)
//   - a {breakdown, total_marks} object (some Pakistan Studies rows)
//   - null (all of Urdu, all of stanza_questions, a few Physics rows)
// Never assume the shape — only auto-grade when it's genuinely the
// structured array; anything else must fall back cleanly rather than
// crash or silently under-grade.
// ============================================================
export function parseRubric(raw: unknown): RubricConcept[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const concepts: RubricConcept[] = []
  for (const row of raw) {
    if (
      row && typeof row === 'object' &&
      typeof (row as any).concept === 'string' &&
      Array.isArray((row as any).keywords) &&
      (row as any).keywords.length > 0 &&
      (row as any).keywords.every((k: unknown) => typeof k === 'string') &&
      typeof (row as any).points === 'number'
    ) {
      concepts.push(row as RubricConcept)
    } else {
      // One malformed concept anywhere in the array makes the whole rubric
      // untrustworthy for auto-grading — fall back cleanly rather than
      // silently skip just that concept.
      return null
    }
  }
  return concepts
}

// Grades free-text `studentAnswer` against a parsed rubric. A concept is
// "matched" if ANY of its keywords appears in the answer — exact substring
// match for multi-word phrases (most keywords), with typo tolerance via
// levenshtein for single-word keywords. Score is the matched concepts'
// point-share of the rubric's total points, scaled to `maxMarks` — rubric
// point totals don't reliably equal the question's real marks value (seen
// rubrics summing well above/below the section's mark value), so this
// scales proportionally rather than assuming they match.
export function gradeAgainstRubric(studentAnswer: string, concepts: RubricConcept[], maxMarks: number): RubricGradeResult {
  const answerNorm = normalize(studentAnswer)
  const answerWords = answerNorm.split(' ').filter(Boolean)

  const hits: RubricHit[] = concepts.map(c => {
    const matched = c.keywords.some(kw => {
      const kwNorm = normalize(kw)
      if (!kwNorm) return false
      if (answerNorm.includes(kwNorm)) return true
      if (!kwNorm.includes(' ')) {
        const tolerance = kwNorm.length > 6 ? 2 : kwNorm.length > 3 ? 1 : 0
        return answerWords.some(w => levenshtein(w, kwNorm) <= tolerance)
      }
      return false
    })
    return { concept: c.concept, matched, points: c.points }
  })

  const totalPoints = concepts.reduce((s, c) => s + c.points, 0)
  const matchedPoints = hits.reduce((s, h) => s + (h.matched ? h.points : 0), 0)
  const fraction = totalPoints > 0 ? matchedPoints / totalPoints : 0
  const score = studentAnswer.trim().length === 0 ? 0 : Math.round(maxMarks * fraction)

  return { score, max: maxMarks, hits, studentAnswer }
}
