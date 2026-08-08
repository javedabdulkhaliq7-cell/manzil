import { RawMcq } from './shuffleMcqOptions'

// book_exercises stores the correct answer as free text like "(c) Botany"
// — pull the leading letter out of it. Falls back to 'A' if the format
// doesn't match (better than crashing; worth spot-checking real data if
// this fallback ever fires for a genuine content row).
function parseCorrectLetter(answer: string): 'A' | 'B' | 'C' | 'D' {
  const match = (answer ?? '').match(/\(?\s*([A-Da-d])\s*\)?/)
  const letter = match?.[1]?.toUpperCase()
  return letter === 'A' || letter === 'B' || letter === 'C' || letter === 'D' ? letter : 'A'
}

/**
 * Normalizes an MCQ row from EITHER source table into the shape
 * shuffleMcqOptions expects (RawMcq: option_a/b/c/d + correct_option).
 *
 * `mcqs` table rows already match this shape directly.
 *
 * `book_exercises` MCQ rows (section_type = 'MCQ') store options as a
 * JSONB object {"A":"...","B":"...","C":"...","D":"..."} under `options`,
 * and the correct answer as free text like "(c) Botany" under `answer` —
 * this converts that into the same RawMcq shape so both sources render
 * identically once merged by the draw engine.
 */
export function normalizeMcqRow(row: any): RawMcq {
  // Already in `mcqs` table shape
  if (typeof row.option_a === 'string') {
    return row as RawMcq
  }

  // `book_exercises` shape
  const opts = row.options ?? {}
  return {
    id: row.id,
    question: row.question,
    option_a: opts.A ?? '',
    option_b: opts.B ?? '',
    option_c: opts.C ?? '',
    option_d: opts.D ?? '',
    correct_option: parseCorrectLetter(row.answer ?? ''),
    explanation: row.source_citation ?? '',
    difficulty: 'medium',
    mcq_type: 'book_exercise',
  }
}
