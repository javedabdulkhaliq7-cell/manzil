// FractionText.tsx
//
// Renders stored text containing bracket-markup notation as real math:
//   [[numerator|denominator]]   — LEGACY untagged fraction (unchanged,
//                                  still works exactly as before — this
//                                  is what every Bio/Chem/Physics chapter
//                                  already has stored, don't break it)
//   [[frac|a|b]]                — same as above, explicit tag (Math's
//                                  chosen spelling going forward)
//   [[sqrt|x+1]]                — square root
//   [[pow|base|exponent]]       — superscript / exponent
//   [[sub|base|subscript]]      — subscript
//
// Correctly handles NESTED brackets (a fraction/sqrt/etc inside another)
// by walking bracket depth explicitly instead of using a single regex
// pass. Real example from stored data (Momentum, Chapter 5):
//   V = -[[(0.025 kg)(200 [[m|s]])|5 kg]]
// A naive regex stops its first group at the FIRST `|` it sees — the
// inner one inside `[[m|s]]` — so the outer bracket never matches as one
// unit. This component parses recursively instead.
//
// USAGE (same prop API as before — nothing else needs to change):
//   <FractionText text={mcq.question} />
//   <td><FractionText text={row.cellValue} /></td>

import React, { useMemo } from 'react'

type Segment =
  | { type: 'text'; value: string }
  | { type: 'fraction'; numerator: Segment[]; denominator: Segment[] }
  | { type: 'sqrt'; radicand: Segment[] }
  | { type: 'pow'; base: Segment[]; exponent: Segment[] }
  | { type: 'sub'; base: Segment[]; subscript: Segment[] }

const KNOWN_TAGS = new Set(['frac', 'sqrt', 'pow', 'sub'])

/** Finds the index of the closing `]]` matching the `[[` at openIndex,
 *  skipping over nested `[[...]]` pairs correctly. -1 if unmatched. */
function findMatchingClose(str: string, openIndex: number): number {
  let depth = 0
  let i = openIndex
  while (i < str.length) {
    if (str.slice(i, i + 2) === '[[') { depth++; i += 2; continue }
    if (str.slice(i, i + 2) === ']]') {
      depth--; i += 2
      if (depth === 0) return i - 2
      continue
    }
    i++
  }
  return -1
}

/** Splits `content` on every TOP-LEVEL `|` (not one belonging to a
 *  nested bracket pair) into an array of parts. A plain fraction like
 *  "a|b" splits into 2 parts; a tagged node like "pow|x|2" splits into 3
 *  (tag + 2 args). Generalizes the old single-pipe-finder to support
 *  tags that take more than one argument. */
function splitTopLevelPipes(content: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let i = 0
  while (i < content.length) {
    if (content.slice(i, i + 2) === '[[') { depth++; i += 2; continue }
    if (content.slice(i, i + 2) === ']]') { depth--; i += 2; continue }
    if (content[i] === '|' && depth === 0) {
      parts.push(content.slice(start, i))
      i++
      start = i
      continue
    }
    i++
  }
  parts.push(content.slice(start))
  return parts
}

/** Recursively parses a string into plain-text and notation segments. */
function parseSegments(str: string): Segment[] {
  const result: Segment[] = []
  let buffer = ''
  let i = 0

  while (i < str.length) {
    if (str.slice(i, i + 2) === '[[') {
      const closeIdx = findMatchingClose(str, i)

      if (closeIdx === -1) {
        buffer += str.slice(i)
        i = str.length
        break
      }

      const content = str.slice(i + 2, closeIdx)
      const parts = splitTopLevelPipes(content)
      const maybeTag = parts[0].trim()

      let node: Segment | null = null

      if (parts.length >= 2 && KNOWN_TAGS.has(maybeTag)) {
        // Tagged node — arity depends on which tag.
        if (maybeTag === 'frac' && parts.length === 3) {
          node = { type: 'fraction', numerator: parseSegments(parts[1]), denominator: parseSegments(parts[2]) }
        } else if (maybeTag === 'sqrt' && parts.length === 2) {
          node = { type: 'sqrt', radicand: parseSegments(parts[1]) }
        } else if (maybeTag === 'pow' && parts.length === 3) {
          node = { type: 'pow', base: parseSegments(parts[1]), exponent: parseSegments(parts[2]) }
        } else if (maybeTag === 'sub' && parts.length === 3) {
          node = { type: 'sub', base: parseSegments(parts[1]), subscript: parseSegments(parts[2]) }
        }
        // Wrong arg count for a recognized tag (e.g. "[[sqrt|a|b]]") —
        // node stays null, falls through to the literal-text fallback
        // below rather than guessing at malformed content.
      } else if (parts.length === 2) {
        // LEGACY untagged fraction — exactly the original behavior,
        // untouched. This is what all existing stored content uses.
        node = { type: 'fraction', numerator: parseSegments(parts[0]), denominator: parseSegments(parts[1]) }
      }

      if (node === null) {
        // No top-level pipe at all, or a malformed/unrecognized tag —
        // render the brackets literally rather than crash or guess.
        buffer += str.slice(i, closeIdx + 2)
        i = closeIdx + 2
        continue
      }

      if (buffer) {
        result.push(...splitBareFractions(buffer))
        buffer = ''
      }
      result.push(node)
      i = closeIdx + 2
      continue
    }

    buffer += str[i]
    i++
  }

  if (buffer) result.push(...splitBareFractions(buffer))
  return result
}

/** Returns the flattened text if `segments` is exactly one plain-text
 *  token with no whitespace, parentheses, or nested notation — i.e.
 *  "simple" enough to write inline as num/den. Returns null otherwise.
 *  Purely numeric tokens ("3", "0.5") are NEVER flattened — real
 *  arithmetic fractions like 3/4 should always stack, even though a
 *  unit like [[m|s]] should stay inline. Only letter-based tokens
 *  (units, variables) get the inline shortcut. */
function flattenIfSimple(segments: Segment[]): string | null {
  if (segments.length !== 1) return null
  const only = segments[0]
  if (only.type !== 'text') return null
  if (/[\s()]/.test(only.value)) return null
  if (/^\d+(\.\d+)?$/.test(only.value)) return null
  return only.value
}

// Matches a bare "3/4" or "0.5/1.2" style numeric fraction sitting in
// plain, unmarked-up text — so stored content that never used [[frac|]]
// markup at all (e.g. Math's "3/4−1/2=1/4") still renders stacked.
// Lookaround guards avoid grabbing a piece of a longer digit/slash run
// (e.g. a dd/mm/yyyy date) — only a clean, standalone digit/digit pair
// matches.
const BARE_FRACTION_RE = /(?<![\d/.])(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)(?![\d/.])/g

/** Splits a plain-text chunk (guaranteed to contain no [[...]] markup —
 *  this only ever runs on already-extracted buffer text) into text and
 *  auto-detected bare-fraction segments. */
function splitBareFractions(text: string): Segment[] {
  const segments: Segment[] = []
  let lastIndex = 0
  for (const m of text.matchAll(BARE_FRACTION_RE)) {
    const idx = m.index!
    if (idx > lastIndex) segments.push({ type: 'text', value: text.slice(lastIndex, idx) })
    segments.push({
      type: 'fraction',
      numerator: [{ type: 'text', value: m[1] }],
      denominator: [{ type: 'text', value: m[2] }],
    })
    lastIndex = idx + m[0].length
  }
  if (lastIndex < text.length) segments.push({ type: 'text', value: text.slice(lastIndex) })
  return segments.length > 0 ? segments : [{ type: 'text', value: text }]
}

function renderSegments(segments: Segment[]): React.ReactNode[] {
  return segments.map((seg, idx) => {
    if (seg.type === 'text') {
      return <React.Fragment key={idx}>{seg.value}</React.Fragment>
    }

    if (seg.type === 'fraction') {
      // Simple case: a fraction whose numerator and denominator are each
      // a single plain-text token with no spaces/parentheses/nesting —
      // e.g. "m|s", "kg·m|s", "N|m", "F|x". Real textbooks write these
      // units inline with a slash ("m/s") rather than stacked.
      const simpleNum = flattenIfSimple(seg.numerator)
      const simpleDen = flattenIfSimple(seg.denominator)
      if (simpleNum !== null && simpleDen !== null) {
        return (
          <React.Fragment key={idx}>
            {simpleNum}/{simpleDen}
          </React.Fragment>
        )
      }
      // Otherwise: a genuine calculation fraction — keep the stacked
      // num/den box so multi-term expressions stay readable.
      return (
        <span
          key={idx}
          className="inline-flex flex-col items-center align-middle text-center leading-none mx-0.5 text-[0.82em]"
        >
          <span className="px-0.5">{renderSegments(seg.numerator)}</span>
          <span className="w-full border-t border-current my-[1px]" />
          <span className="px-0.5">{renderSegments(seg.denominator)}</span>
        </span>
      )
    }

    if (seg.type === 'sqrt') {
      return (
        <span key={idx} className="inline-flex items-start mx-0.5">
          <span className="mr-px">√</span>
          <span className="border-t border-current px-0.5">{renderSegments(seg.radicand)}</span>
        </span>
      )
    }

    if (seg.type === 'pow') {
      return (
        <React.Fragment key={idx}>
          {renderSegments(seg.base)}
          <sup className="text-[0.72em]">{renderSegments(seg.exponent)}</sup>
        </React.Fragment>
      )
    }

    // seg.type === 'sub'
    return (
      <React.Fragment key={idx}>
        {renderSegments(seg.base)}
        <sub className="text-[0.72em]">{renderSegments(seg.subscript)}</sub>
      </React.Fragment>
    )
  })
}

export default function FractionText({ text }: { text: string | null | undefined }) {
  const segments = useMemo(() => parseSegments(text ?? ''), [text])
  if (!text) return null
  return <>{renderSegments(segments)}</>
}
