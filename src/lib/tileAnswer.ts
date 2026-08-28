// tileAnswer.ts
//
// Splits a stored answer/step string into "tiles" for the tap-to-arrange
// input, replacing free-text typing for math answers on mobile.
//
// RULE (confirmed against real stored content):
//   - Every OPERATOR (+ × * ÷ =) is its own standalone tile.
//   - Every TERM (a number, or a run of digits/letters/exponents/
//     fraction-slash/superscripts with no operator inside it) is ONE
//     tile — never split into individual characters/digits.
//   - A parenthesized group ("(ad+bc)/bd", "(−3)") is always ONE tile,
//     whole — operators inside parens are never split out. Same for a
//     [[numerator|denominator]]-markup fraction group (the FractionText
//     stacked-fraction syntax used elsewhere, e.g. "[[104 - 32|1.8]]")
//     — its internal "-" is grouping, not a real operator to split.
//   - "/" is never an operator — fractions ("3/4", "a/b") always stay
//     attached to their term.
//   - "−"/"-" is context-dependent: at the very start of the answer, or
//     immediately after another operator/"=", it's a SIGN and stays
//     attached to the term ("−27", "(−3)"). Between two terms, it's
//     real subtraction and becomes its own tile ("10 − 15").
//   - Whitespace between/around operators is not meaningful to tile
//     boundaries and gets trimmed there — but whitespace WITHIN a term
//     (e.g. a multi-word phrase with no operators at all) is preserved,
//     so a prose answer stays readable as one tile instead of becoming
//     a run-together word-blob.

const OPERATORS = new Set(['+', '×', '*', '÷', '='])
const MINUS = new Set(['-', '−'])

export function tokenizeAnswer(text: string): string[] {
  const tokens: string[] = []
  let current = ''
  let depth = 0
  let atTermStart = true

  const s = text.trim()
  let i = 0
  while (i < s.length) {
    const two = s.slice(i, i + 2)
    if (two === '[[') { depth++; current += two; atTermStart = false; i += 2; continue }
    if (two === ']]') { depth = Math.max(0, depth - 1); current += two; i += 2; continue }

    const ch = s[i]
    if (ch === '(') {
      depth++
      current += ch
      atTermStart = false
      i++
      continue
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1)
      current += ch
      i++
      continue
    }
    if (depth > 0) {
      // Inside a group — never split, accumulate everything verbatim.
      current += ch
      i++
      continue
    }
    if (ch === ' ' || ch === '\t') {
      // Space doesn't create a tile boundary by itself, and it doesn't
      // affect whether the next real character counts as a "term
      // start" — but it IS preserved as real content, since a prose
      // answer with no operators at all becomes one multi-word term,
      // and that term needs its internal spacing intact to be
      // readable ("A depends on B" not "AdependsonB").
      current += ch
      i++
      continue
    }

    if (OPERATORS.has(ch)) {
      if (current.trim()) { tokens.push(current.trim()); current = '' } else { current = '' }
      tokens.push(ch)
      atTermStart = true
      i++
      continue
    }
    if (MINUS.has(ch)) {
      if (atTermStart) {
        current += ch // leading/unary sign — part of the term
        atTermStart = false
      } else {
        if (current.trim()) { tokens.push(current.trim()); current = '' } else { current = '' }
        tokens.push(ch) // binary subtraction — its own tile
        atTermStart = true
      }
      i++
      continue
    }
    current += ch
    atTermStart = false
    i++
  }
  if (current.trim()) tokens.push(current.trim())
  const result = tokens.filter(t => t.length > 0)

  // Fallback: if nothing split at all (no operator anywhere — a prose
  // answer like "30 students study only Urdu."), the whole thing is one
  // multi-word tile, which isn't a real arrangeable puzzle. Split it
  // into individual words instead — {...}/(...)/[[...]] groups still
  // stay atomic (a set like "{1,2,3}" is one word-tile, not fragments).
  if (result.length === 1 && /\s/.test(result[0])) {
    const words = splitIntoWords(result[0])
    if (words.length > 1) return words
  }
  return result
}

/** Splits plain text into individual words on whitespace, keeping any
 *  (...), {...}, or [[...]] group atomic — used only as a fallback for
 *  prose answers with no math operator to split on at all. */
function splitIntoWords(text: string): string[] {
  const words: string[] = []
  let current = ''
  let depth = 0
  const s = text.trim()
  let i = 0
  while (i < s.length) {
    const two = s.slice(i, i + 2)
    if (two === '[[') { depth++; current += two; i += 2; continue }
    if (two === ']]') { depth = Math.max(0, depth - 1); current += two; i += 2; continue }
    const ch = s[i]
    if (ch === '(' || ch === '{') { depth++; current += ch; i++; continue }
    if (ch === ')' || ch === '}') { depth = Math.max(0, depth - 1); current += ch; i++; continue }
    if (depth > 0) { current += ch; i++; continue }
    if (ch === ' ' || ch === '\t') {
      if (current.trim()) words.push(current.trim())
      current = ''
      i++
      continue
    }
    current += ch
    i++
  }
  if (current.trim()) words.push(current.trim())
  return words.filter(w => w.length > 0)
}

/** Normalizes solution_steps into plain step-text strings, regardless
 *  of which real shape the source table uses — the standalone
 *  `numericals` table stores plain strings (with [[a|b]] fraction
 *  markup baked in), while `book_exercises` stores step OBJECTS
 *  ({ step_text, ... }). Both are real, live shapes — this is not a
 *  bug in either table, just two schemas that evolved separately. */
export function getStepTexts(solutionSteps: (string | { step_text: string })[] | null | undefined): string[] {
  if (!solutionSteps) return []
  return solutionSteps.map(s => typeof s === 'string' ? s : s.step_text)
}

export function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** Picks a handful of plausible-wrong TERM tiles (never operators — a
 *  stray extra "+" isn't a meaningful decoy) for test-mode difficulty,
 *  sourced from this question's OWN other solution steps rather than
 *  invented — so every decoy is real math language from the same
 *  problem, just from the wrong step. Falls back to [] if there's
 *  nothing else to draw from (e.g. a one-line answer).
 *
 *  Accepts solution_steps in its REAL stored shape — an array of step
 *  objects ({ step_text, ... }), not plain strings — normalizing
 *  internally. Also accepts a plain string[] for convenience if a
 *  caller has already extracted step_text itself. */
export function pickDecoyTiles(
  correctTiles: string[],
  solutionSteps: (string | { step_text: string })[] | null | undefined,
  count: number
): string[] {
  const stepTexts = getStepTexts(solutionSteps)
  if (stepTexts.length === 0) return []
  const correctSet = new Set(correctTiles.map(t => t.trim()))
  const candidates = new Set<string>()
  for (const step of stepTexts) {
    for (const tok of tokenizeAnswer(step)) {
      if (OPERATORS.has(tok) || MINUS.has(tok)) continue // terms only
      if (!correctSet.has(tok)) candidates.add(tok)
    }
  }
  return shuffle([...candidates]).slice(0, count)
}
