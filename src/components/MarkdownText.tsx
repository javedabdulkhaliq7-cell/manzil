// src/components/MarkdownText.tsx
//
// Renders a limited, predictable subset of markdown from the AI's replies:
// # / ## / ### headings, **bold**, - bullet lists, 1. numbered lists, paragraphs.
// No external dependency — small enough to reason about and matches exactly
// what we instruct the AI to produce in the ai-tutor Edge Function's system prompt.
// Reuses the existing FractionText component so [[num|denom]] math still renders.

import { ReactNode } from 'react'
import FractionText from './FractionText'

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== '')
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-b${i}`}>{part.slice(2, -2)}</strong>
    }
    return <FractionText key={`${keyPrefix}-t${i}`} text={part} />
  })
}

export default function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let listBuffer: string[] = []
  let listType: 'ul' | 'ol' | null = null

  function flushList(key: string) {
    if (listBuffer.length === 0) return
    if (listType === 'ol') {
      blocks.push(
        <ol key={key} className="list-decimal pl-5 space-y-1 my-1.5">
          {listBuffer.map((item, i) => (
            <li key={i}>{renderInline(item, `${key}-${i}`)}</li>
          ))}
        </ol>
      )
    } else {
      blocks.push(
        <ul key={key} className="list-disc pl-5 space-y-1 my-1.5">
          {listBuffer.map((item, i) => (
            <li key={i}>{renderInline(item, `${key}-${i}`)}</li>
          ))}
        </ul>
      )
    }
    listBuffer = []
    listType = null
  }

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim()
    const key = `line-${idx}`

    if (!line) {
      flushList(`list-${idx}`)
      return
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)/)
    if (headingMatch) {
      flushList(`list-${idx}`)
      const level = headingMatch[1].length
      const content = headingMatch[2]
      const sizeClass =
        level === 1
          ? 'text-sm font-black mt-3 mb-1 first:mt-0'
          : level === 2
          ? 'text-sm font-bold mt-3 mb-1 first:mt-0'
          : 'text-xs font-bold mt-2 mb-1 first:mt-0'
      blocks.push(
        <div key={key} className={`${sizeClass} text-brand-800 dark:text-brand-300`}>
          {renderInline(content, key)}
        </div>
      )
      return
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)/)
    if (bulletMatch) {
      if (listType !== 'ul') flushList(`list-${idx}`)
      listType = 'ul'
      listBuffer.push(bulletMatch[1])
      return
    }

    const numberedMatch = line.match(/^\d+[.)]\s+(.*)/)
    if (numberedMatch) {
      if (listType !== 'ol') flushList(`list-${idx}`)
      listType = 'ol'
      listBuffer.push(numberedMatch[1])
      return
    }

    flushList(`list-${idx}`)
    blocks.push(
      <p key={key} className="mb-1.5 last:mb-0 leading-relaxed">
        {renderInline(line, key)}
      </p>
    )
  })

  flushList('list-end')

  return <div>{blocks}</div>
}
