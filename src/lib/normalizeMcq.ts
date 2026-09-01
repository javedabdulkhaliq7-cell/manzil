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
/**
 * Normalizes `book_exercises.options` into a plain {A,B,C,D} object,
 * regardless of which real shape it was stored in. Confirmed on live
 * English content: ALL 99 English book_exercises MCQ rows use a shape
 * this code previously couldn't read at all — 83 rows store `options`
 * as a plain ARRAY (["First Muezzin", "Second Caliph", ...], no letter
 * keys whatsoever), and the remaining 16 use an object but with
 * LOWERCASE keys ({a:..., b:..., c:..., d:...}) instead of uppercase.
 * Every `opts.A`/`opts.B`/... lookup against either shape silently
 * returned undefined — every option rendered blank, and there was
 * nothing real for extractCorrectLetter's text-match fallback to
 * compare against either, so no answer was ever identified as correct.
 */
function normalizeOptionsShape(options: any): { A: string; B: string; C: string; D: string } {
  if (Array.isArray(options)) {
    return { A: options[0] ?? '', B: options[1] ?? '', C: options[2] ?? '', D: options[3] ?? '' }
  }
  if (options && typeof options === 'object') {
    return {
      A: options.A ?? options.a ?? '',
      B: options.B ?? options.b ?? '',
      C: options.C ?? options.c ?? '',
      D: options.D ?? options.d ?? '',
    }
  }
  return { A: '', B: '', C: '', D: '' }
}

export function normalizeMcqRow(row: any): RawMcq {
  // Already in `mcqs` table shape
  if (typeof row.option_a === 'string') {
    // `mcqs.correct_option` is NOT guaranteed to already be a clean
    // uppercase 'A'|'B'|'C'|'D' in production. Confirmed on live English
    // content: 319 of 819 rows store a lowercase letter ("a"/"b"/"c"),
    // and a handful store the literal correct-answer TEXT instead of a
    // letter at all (e.g. "but"). Returning the row unmodified meant
    // whatever compared correct_option directly against 'A'|'B'|'C'|'D'
    // (option-coloring, scoring) never matched for ~40% of English MCQs —
    // every option rendered as wrong and no explanation ever showed.
    // Reusing extractCorrectLetter here — same function, same robustness,
    // as the book_exercises path just below — so both sources are
    // normalized through one shared implementation instead of trusting
    // one of them blindly.
    const opts = { A: row.option_a, B: row.option_b, C: row.option_c, D: row.option_d }
    const correctLetter = extractCorrectLetter(row.correct_option ?? '', opts) ?? 'A'
    return { ...row, correct_option: correctLetter as 'A' | 'B' | 'C' | 'D' } as RawMcq
  }

  // `book_exercises` shape
  const opts = normalizeOptionsShape(row.options)
  // extractCorrectLetter can return null on a genuinely unrecognized
  // format (logs its own warning when that happens) — RawMcq.correct_option
  // doesn't allow null, so default to 'A' only in that rare fallback case,
  // same spirit as the original code but now only reached for content that
  // actually needs a manual look, not for every marker-less answer.
  const correctLetter = extractCorrectLetter(row.answer ?? '', opts) ?? 'A'

  return {
    id: row.id,
    question: row.question,
    option_a: opts.A,
    option_b: opts.B,
    option_c: opts.C,
    option_d: opts.D,
    correct_option: correctLetter as 'A' | 'B' | 'C' | 'D',
    explanation: row.source_citation ?? '',
    difficulty: 'medium',
    mcq_type: 'book_exercise',
  }
}
