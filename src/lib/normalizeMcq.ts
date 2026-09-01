import { RawMcq } from './shuffleMcqOptions'
// ASSUMPTION: adjust this import path to wherever ChapterExerciseTestScreen.tsx
// actually lives relative to this file (e.g. '../screens/ChapterExerciseTestScreen').
// Reusing the SAME extractCorrectLetter as ChapterExerciseTestScreen.tsx /
// ExerciseTestPrintView.tsx deliberately — this file used to have its own
// separate regex here (`parseCorrectLetter`) that was unanchored and would
// grab any stray A/B/C/D letter anywhere in the answer string. Confirmed on
// production data: a book_exercises row with answer="Physics" (options
// A=Mechanics/B=Optics/C=Heat/D=Physics, real correct option D) was silently
// returning 'C' — matching the incidental lowercase 'c' inside "Physi_c_s" —
// so this MCQ would show the WRONG option marked correct wherever it got
// merged into a Mock Test draw. extractCorrectLetter fixes this (anchored
// regex + falls back to matching the answer against the option text itself
// when there's no letter marker at all) and is now the one shared
// implementation instead of two that can silently drift apart again.
import { extractCorrectLetter } from '../screens/ChapterExerciseTestScreen'

/**
 * Normalizes an MCQ row from EITHER source table into the shape
 * shuffleMcqOptions expects (RawMcq: option_a/b/c/d + correct_option).
 *
 * `mcqs` table rows already match this shape directly.
 *
 * `book_exercises` MCQ rows (section_type = 'MCQ') store options as a
 * JSONB object {"A":"...","B":"...","C":"...","D":"..."} under `options`,
 * and the correct answer as free text under `answer` (formats vary in
 * production — "(c) Botany", bare "C", "D) some text", or occasionally
 * just the option's own text with no letter marker at all) — this
 * converts that into the same RawMcq shape so both sources render
 * identically once merged by the draw engine.
 */
export function normalizeMcqRow(row: any): RawMcq {
  // Already in `mcqs` table shape
  if (typeof row.option_a === 'string') {
    return row as RawMcq
  }

  // `book_exercises` shape
  const opts = row.options ?? {}
  // extractCorrectLetter can return null on a genuinely unrecognized
  // format (logs its own warning when that happens) — RawMcq.correct_option
  // doesn't allow null, so default to 'A' only in that rare fallback case,
  // same spirit as the original code but now only reached for content that
  // actually needs a manual look, not for every marker-less answer.
  const correctLetter = extractCorrectLetter(row.answer ?? '', opts) ?? 'A'

  return {
    id: row.id,
    question: row.question,
    option_a: opts.A ?? '',
    option_b: opts.B ?? '',
    option_c: opts.C ?? '',
    option_d: opts.D ?? '',
    correct_option: correctLetter as 'A' | 'B' | 'C' | 'D',
    explanation: row.source_citation ?? '',
    difficulty: 'medium',
    mcq_type: 'book_exercise',
  }
}
