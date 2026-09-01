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
  LONG_OFFERED: 3,      LONG_ATTEMPT: 2,  LONG_MARKS: 8,  // Section C — not every subject has long_questions content (e.g. English: 0 across all 13 chapters) — always check longQs.length > 0 before showing this section, same as Numericals
  NUMERICAL_OFFERED: 2, NUMERICAL_ATTEMPT: 2, NUMERICAL_MARKS: 4, // Section D — Physics ONLY, fixed at 2, both count
  TF_OFFERED: 5,         TF_ATTEMPT: 5,        TF_MARKS: 1,  // English True/False — all 5 required, no selection (JK-confirmed count)
  TRANSLATION_OFFERED: 5, TRANSLATION_ATTEMPT: 5, TRANSLATION_MARKS: 1, // English Word Meaning/Translation — all 5 required, no selection (JK-confirmed count)
  TIME_MINUTES: 90,
}

/**
 * Marks are NOT a fixed constant — several sections only apply to some
 * subjects (Numericals: Physics/Math only; Long Questions: not present in
 * English's 13 chapters; True/False and Translation: English only). Pass
 * which optional sections actually have content for THIS chapter (i.e.
 * the relevant array's .length > 0 after drawing) to get the correct
 * denominator for scoring/results/print.
 */
export function getMaxMarks(opts: {
  includeLong?: boolean
  includeNumerical?: boolean
  includeTF?: boolean
  includeTranslation?: boolean
}): number {
  return (
    CONFIG.NUM_MCQS * CONFIG.MCQ_MARKS +
    CONFIG.FIB_ATTEMPT * CONFIG.FIB_MARKS +
    CONFIG.SHORT_ATTEMPT * CONFIG.SHORT_MARKS +
    (opts.includeLong ? CONFIG.LONG_ATTEMPT * CONFIG.LONG_MARKS : 0) +
    (opts.includeNumerical ? CONFIG.NUMERICAL_ATTEMPT * CONFIG.NUMERICAL_MARKS : 0) +
    (opts.includeTF ? CONFIG.TF_ATTEMPT * CONFIG.TF_MARKS : 0) +
    (opts.includeTranslation ? CONFIG.TRANSLATION_ATTEMPT * CONFIG.TRANSLATION_MARKS : 0)
  )
}
