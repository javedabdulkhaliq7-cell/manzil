// FractionText.tsx
//
// Renders stored text containing the [[numerator|denominator]] fraction
// markup convention as real stacked fractions. Correctly handles NESTED
// fractions (a fraction inside a numerator or denominator) by walking
// bracket depth explicitly instead of using a single regex pass.
//
// Real example from stored data (Momentum, Chapter 5) that a naive regex
// gets wrong:
//   V = -[[(0.025 kg)(200 [[m|s]])|5 kg]]
// A regex like /\[\[([^|]+)\|([^\]]+)\]\]/ stops its numerator group at
// the FIRST `|` it sees — which is the inner one inside `[[m|s]]` — so
// the outer bracket never matches as a single unit. This component parses
// recursively instead, so the outer fraction's numerator correctly
// contains a nested m/s fraction rendered inside it.
//
// USAGE (same prop API as before — nothing else needs to change):
//   <FractionText text={mcq.question} />
//   <td><FractionText text={row.cellValue} /></td>

import React, { useMemo } from 'react'

type Segment =
  | { type: 'text'; value: string }
  | { type: 'fraction'; numerator: Segment[]; denominator: Segment[] }

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

/** Finds the `|` that separates numerator/denominator at the TOP level
 *  of `content` — not one belonging to a nested fraction. -1 if none. */
function findTopLevelPipe(content: string): number {
  let depth = 0
  let i = 0
  while (i < content.length) {
    if (content.slice(i, i + 2) === '[[') { depth++; i += 2; continue }
    if (content.slice(i, i + 2) === ']]') { depth--; i += 2; continue }
    if (content[i] === '|' && depth === 0) return i
    i++
  }
  return -1
}

/** Recursively parses a string into plain-text and fraction segments. */
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
      const pipeIdx = findTopLevelPipe(content)

      if (pipeIdx === -1) {
        buffer += str.slice(i, closeIdx + 2)
        i = closeIdx + 2
        continue
      }

      if (buffer) {
        result.push({ type: 'text', value: buffer })
        buffer = ''
      }

      result.push({
        type: 'fraction',
        numerator: parseSegments(content.slice(0, pipeIdx)),
        denominator: parseSegments(content.slice(pipeIdx + 1)),
      })

      i = closeIdx + 2
      continue
    }

    buffer += str[i]
    i++
  }

  if (buffer) result.push({ type: 'text', value: buffer })
  return result
}

function renderSegments(segments: Segment[]): React.ReactNode[] {
  return segments.map((seg, idx) => {
    if (seg.type === 'text') {
      return <React.Fragment key={idx}>{seg.value}</React.Fragment>
    }

    // Simple case: a fraction whose numerator and denominator are each a
    // single plain-text token with no spaces/parentheses/nesting — e.g.
    // "m|s", "kg·m|s", "N|m", "F|x". Real textbooks write these units
    // inline with a slash ("m/s") rather than stacked, so match that
    // instead of boxing every single unit fraction.
    const simpleNum = flattenIfSimple(seg.numerator)
    const simpleDen = flattenIfSimple(seg.denominator)
    if (simpleNum !== null && simpleDen !== null) {
      return (
        <React.Fragment key={idx}>
          {simpleNum}/{simpleDen}
        </React.Fragment>
      )
    }

    // Otherwise: a genuine calculation fraction (has spaces, parentheses,
    // or a nested fraction inside it) — keep the stacked num/den box so
    // multi-term expressions stay readable.
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
  })
}

/** Returns the flattened text if `segments` is exactly one plain-text
 *  token with no whitespace, parentheses, or nested fraction — i.e.
 *  "simple" enough to write inline as num/den. Returns null otherwise. */
function flattenIfSimple(segments: Segment[]): string | null {
  if (segments.length !== 1) return null
  const only = segments[0]
  if (only.type !== 'text') return null
  if (/[\s()]/.test(only.value)) return null
  return only.value
}

export default function FractionText({ text }: { text: string | null | undefined }) {
  const segments = useMemo(() => parseSegments(text ?? ''), [text])
  if (!text) return null
  return <>{renderSegments(segments)}</>
}
