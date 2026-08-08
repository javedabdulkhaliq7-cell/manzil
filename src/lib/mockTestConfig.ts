// mockTestConfig.ts
//
// Single source of truth for Mock Test's paper structure (section sizes,
// marks, time limit). Both the in-app screen (ChapterMockTestScreen) and
// the printable screen (MockTestPrintView) import this — so changing the
// paper structure in one place updates both modes consistently.

export const CONFIG = {
  NUM_MCQS: 7,          MCQ_MARKS: 1,      // Section A (part 1)
  FIB_OFFERED: 5,       FIB_ATTEMPT: 5,   FIB_MARKS: 1,  // Section A (part 2) — all 5 required, no selection
  SHORT_OFFERED: 7,     SHORT_ATTEMPT: 6, SHORT_MARKS: 2, // Section B — ASSUMPTION: "5 to 6" read as 6, confirm if you meant 5
  LONG_OFFERED: 3,      LONG_ATTEMPT: 2,  LONG_MARKS: 8,  // Section C
  NUMERICAL_OFFERED: 2, NUMERICAL_ATTEMPT: 2, NUMERICAL_MARKS: 4, // Section D — Physics ONLY, fixed at 2, both count
  TIME_MINUTES: 90,
}

/**
 * Marks are NOT a fixed constant — Numericals only apply to Physics, so a
 * Biology/Chemistry/Math chapter's max marks must exclude Section D
 * entirely. Pass whether this chapter actually has a Numerical section
 * (i.e. subject === Physics AND numericals were drawn) to get the correct
 * denominator for scoring/results.
 */
export function getMaxMarks(includeNumerical: boolean): number {
  return (
    CONFIG.NUM_MCQS * CONFIG.MCQ_MARKS +
    CONFIG.FIB_ATTEMPT * CONFIG.FIB_MARKS +
    CONFIG.SHORT_ATTEMPT * CONFIG.SHORT_MARKS +
    CONFIG.LONG_ATTEMPT * CONFIG.LONG_MARKS +
    (includeNumerical ? CONFIG.NUMERICAL_ATTEMPT * CONFIG.NUMERICAL_MARKS : 0)
  )
}
