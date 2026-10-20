// Phase 10: builds a printable PDF that looks like the board's paper.
// Works on the same data the on-screen viewer uses (past papers and generated papers),
// and runs fully on the device (no network). Every page carries a faint IQRA logo behind the text.
// Generated papers (only) carry one small "IQRA Test Paper" line at the bottom of every page.
import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib'
import type { SourcePaper, SourceSection, SourceQuestion } from './paperSource'

export type PrintInput = {
  paper: SourcePaper
  sections: SourceSection[]
  questions: SourceQuestion[]
  subjectName: string
  classLevel: string
  // The IQRA logo as PNG or JPG bytes. Optional: without it the paper prints with no logo.
  logo?: Uint8Array | null
}

const PAGE_W = 595.28 // A4
const PAGE_H = 841.89
const MARGIN_X = 42
const MARGIN_TOP = 40
const MARGIN_BOTTOM = 50
const FOOTER_Y = 26
const FOOTER_TEXT = 'IQRA Test Paper'
const CONTENT_W = PAGE_W - MARGIN_X * 2
// Board papers are one page, so try these sizes in turn and keep the biggest that fits one page.
const FIT_SIZES = [10, 9.5, 9]
const DEFAULT_SIZE = 10
// Faint logo behind the text on every page: light enough to read through and to save ink.
const LOGO_OPACITY = 0.1
const LOGO_MAX = 300 // largest side of the logo on the page, in points

type Fonts = { reg: PDFFont; bold: PDFFont; ital: PDFFont }
type Seg = { text: string; bold?: boolean; italic?: boolean }
type Run = { text: string; font: PDFFont; size: number; rise: number; width: number }
type Token = { runs: Run[]; width: number; gap: number; glue: boolean; breakBefore: boolean }

type Op =
  | { k: 't'; x: number; dy: number; text: string; font: PDFFont; size: number }
  | { k: 'l'; x1: number; x2: number; dy: number; w: number }

type Block = { height: number; after: number; ops: Op[] }

// ---------------------------------------------------------------- text helpers

const SUB: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '₊': '+', '₋': '-' }
const SUP: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-' }
const REPLACE: Record<string, string> = {
  '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '≈': '~', '−': '-', '\u00A0': ' ', '\u2009': ' ', '\u200B': '',
}

function toRuns(word: string, font: PDFFont, size: number, allowed: Set<number>): Run[] {
  const runs: Run[] = []
  const push = (text: string, kind: 'n' | 'sub' | 'sup') => {
    if (!text) return
    const small = kind !== 'n'
    const s = small ? size * 0.65 : size
    const rise = kind === 'sub' ? -size * 0.2 : kind === 'sup' ? size * 0.35 : 0
    const last = runs[runs.length - 1]
    if (last && last.rise === rise && last.size === s) {
      last.text += text
      last.width = font.widthOfTextAtSize(last.text, s)
    } else {
      runs.push({ text, font, size: s, rise, width: font.widthOfTextAtSize(text, s) })
    }
  }
  for (const ch of Array.from(word)) {
    if (SUB[ch]) { push(SUB[ch], 'sub'); continue }
    if (allowed.has(ch.codePointAt(0)!)) { push(ch, 'n'); continue }
    if (SUP[ch]) { push(SUP[ch], 'sup'); continue }
    const r = REPLACE[ch]
    if (r !== undefined) { push(r, 'n'); continue }
    push('?', 'n') // never fail a print because of one odd character
  }
  return runs
}

function tokenize(segs: Seg[], size: number, fonts: Fonts, allowed: Set<number>): Token[] {
  const tokens: Token[] = []
  let pendingGap = false
  let pendingBreak = false
  for (const seg of segs) {
    const font = seg.bold ? fonts.bold : seg.italic ? fonts.ital : fonts.reg
    const spaceW = font.widthOfTextAtSize(' ', size)
    const re = /(\s+)|(\S+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(seg.text)) !== null) {
      if (m[1] !== undefined) {
        pendingGap = true
        if (m[1].includes('\n')) pendingBreak = true
      } else {
        const runs = toRuns(m[2], font, size, allowed)
        const width = runs.reduce((s, r) => s + r.width, 0)
        tokens.push({ runs, width, gap: pendingGap && tokens.length > 0 ? spaceW : 0, glue: false, breakBefore: pendingBreak })
        pendingGap = false
        pendingBreak = false
      }
    }
  }
  return tokens
}

type Line = { items: { t: Token; x: number }[]; width: number }

// Greedy line breaking. firstWidth/otherWidth are the available widths.
function wrap(tokens: Token[], firstWidth: number, otherWidth: number): Line[] {
  const lines: Line[] = []
  let cur: Line = { items: [], width: 0 }
  const limit = () => (lines.length === 0 ? firstWidth : otherWidth)
  tokens.forEach((t, i) => {
    const prev = i > 0 ? tokens[i - 1] : null
    const startsGroup = !(prev && prev.glue)
    // A glued group (such as one MCQ option) is measured whole, so it moves to the next line together.
    let need = t.width
    if (startsGroup && t.glue) {
      let k = i
      while (tokens[k].glue && k + 1 < tokens.length) { k++; need += tokens[k].gap + tokens[k].width }
    }
    const gap = cur.items.length === 0 ? 0 : t.gap
    const fits = cur.width + gap + need <= limit()
    if (cur.items.length > 0 && (t.breakBefore || (!fits && startsGroup))) {
      lines.push(cur)
      cur = { items: [], width: 0 }
    }
    const g = cur.items.length === 0 ? 0 : t.gap
    cur.items.push({ t, x: cur.width + g })
    cur.width += g + t.width
  })
  if (cur.items.length > 0) lines.push(cur)
  return lines
}

// ---------------------------------------------------------------- block builders

type Ctx = { fonts: Fonts; allowed: Set<number>; size: number; scale: number }

function lineH(c: Ctx, size = c.size): number { return size * 1.2 }

function textOps(lines: Line[], x0: number, width: number, align: 'left' | 'center', c: Ctx, size: number, top: number): Op[] {
  const ops: Op[] = []
  lines.forEach((ln, i) => {
    const shift = align === 'center' ? Math.max(0, (width - ln.width) / 2) : 0
    const dy = top + i * lineH(c, size) + size * 0.92
    for (const it of ln.items) {
      let x = x0 + shift + it.x
      for (const r of it.t.runs) {
        ops.push({ k: 't', x, dy: dy - r.rise, text: r.text, font: r.font, size: r.size })
        x += r.width
      }
    }
  })
  return ops
}

// A paragraph with an optional hanging label (like "1.") and an optional marks tag on the right.
function paragraph(
  c: Ctx, segs: Seg[], opts: {
    label?: string; labelW?: number; marks?: string; align?: 'left' | 'center'
    size?: number; after?: number; options?: { letter: string; text: string }[]
  } = {},
): Block {
  const size = opts.size ?? c.size
  const labelW = opts.label !== undefined ? (opts.labelW ?? 0) : opts.labelW ?? 0
  const marksW = opts.marks ? c.fonts.reg.widthOfTextAtSize(opts.marks, size) + 8 : 0
  const width = CONTENT_W - labelW - marksW
  let tokens = tokenize(segs, size, c.fonts, c.allowed)
  if (opts.options) {
    const optGap = c.fonts.reg.widthOfTextAtSize('    ', size)
    opts.options.forEach((o, idx) => {
      const ot = tokenize([{ text: `${o.letter}. ${o.text}` }], size, c.fonts, c.allowed)
      if (ot.length === 0) return
      ot[0].gap = tokens.length === 0 && idx === 0 ? 0 : optGap
      ot[0].breakBefore = false
      // Keep each option whole on one line when it fits (the board never splits an option).
      const optW = ot.reduce((sum, t, k) => sum + (k === 0 ? 0 : t.gap) + t.width, 0)
      if (optW <= width) for (let k = 0; k < ot.length - 1; k++) ot[k].glue = true
      else if (ot.length > 1) ot[0].glue = true // otherwise at least keep "a." with its first word
      tokens = tokens.concat(ot)
    })
  }
  const lines = wrap(tokens, width, width)
  const n = Math.max(lines.length, 1)
  const ops = textOps(lines, MARGIN_X + labelW, width, opts.align ?? 'left', c, size, 0)
  if (opts.label) {
    const rs = toRuns(opts.label, c.fonts.bold, size, c.allowed)
    let x = MARGIN_X
    for (const r of rs) { ops.push({ k: 't', x, dy: size * 0.92 - r.rise, text: r.text, font: r.font, size: r.size }); x += r.width }
  }
  if (opts.marks) {
    ops.push({ k: 't', x: MARGIN_X + CONTENT_W - (marksW - 8), dy: size * 0.92, text: opts.marks, font: c.fonts.reg, size })
  }
  return { height: n * lineH(c, size), after: opts.after ?? 2.5 * c.scale, ops }
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return ''
  const v = Number(n)
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

function timeLabel(minutes: number | null): string {
  if (!minutes) return ''
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const hp = h > 0 ? `${h} ${h === 1 ? 'Hour' : 'Hours'}` : ''
  const mp = m > 0 ? `${m} Minutes` : ''
  return [hp, mp].filter(Boolean).join(' ')
}

function classOrdinal(level: string): string {
  const m = level.match(/(\d+)/)
  return m ? `${m[1]}TH` : ''
}

function fitSize(font: PDFFont, text: string, size: number, maxW: number, allowed: Set<number>): number {
  const clean = toRuns(text, font, size, allowed).map(r => r.text).join('')
  const w = font.widthOfTextAtSize(clean, size)
  return w > maxW ? Math.max(6, size * (maxW / w)) : size
}

function safe(text: string, font: PDFFont, allowed: Set<number>): string {
  // Plain text for header rows: swap any character the font cannot draw.
  return toRuns(text, font, 10, allowed).map(r => r.text).join('')
}

function headerBlock(c: Ctx, input: PrintInput): Block {
  const { paper, subjectName, classLevel } = input
  const { fonts, allowed, scale } = c
  const ops: Op[] = []
  let y = 0

  const board = safe('BALOCHISTAN BOARD OF INTERMEDIATE & SECONDARY EDUCATION QUETTA', fonts.bold, allowed)
  const bs = fitSize(fonts.bold, board, 10.5 * scale, CONTENT_W, allowed)
  ops.push({ k: 't', x: MARGIN_X + (CONTENT_W - fonts.bold.widthOfTextAtSize(board, bs)) / 2, dy: y + bs * 0.92, text: board, font: fonts.bold, size: bs })
  y += bs * 1.35

  const row = (left: string, mid: string, right: string, midBold: boolean, size: number) => {
    const L = safe(left, fonts.bold, allowed)
    const R = safe(right, fonts.bold, allowed)
    const midFont = midBold ? fonts.bold : fonts.reg
    const M = safe(mid, midFont, allowed)
    const lw = L ? fonts.bold.widthOfTextAtSize(L, size) : 0
    const rw = R ? fonts.bold.widthOfTextAtSize(R, size) : 0
    const room = CONTENT_W - lw - rw - 16
    const ms = M ? fitSize(midFont, M, size + (midBold ? 1.5 : 0), room, allowed) : size
    const base = y + Math.max(size, ms) * 0.92
    if (L) ops.push({ k: 't', x: MARGIN_X, dy: base, text: L, font: fonts.bold, size })
    if (R) ops.push({ k: 't', x: MARGIN_X + CONTENT_W - rw, dy: base, text: R, font: fonts.bold, size })
    if (M) {
      const mw = midFont.widthOfTextAtSize(M, ms)
      ops.push({ k: 't', x: MARGIN_X + lw + 8 + (room - mw) / 2, dy: base, text: M, font: midFont, size: ms })
    }
    y += Math.max(size, ms) * 1.35
  }

  const subject = `SUBJECT: ${subjectName.toUpperCase()}${classOrdinal(classLevel) ? ` – ${classOrdinal(classLevel)}` : ''}`
  const examLine = paper.exam_title?.trim() || paper.title
  const time = timeLabel(paper.time_minutes)
  row(time ? `TIME: ${time}` : '', examLine, paper.total_marks !== null ? `MARKS: ${fmt(paper.total_marks)}` : '', false, 9.5 * scale)
  if (paper.pattern === 'legacy') {
    row(
      paper.group_label?.trim() ?? '', subject,
      paper.passing_marks !== null ? `PASSING MARKS: ${fmt(paper.passing_marks)}` : '', true, 9.5 * scale,
    )
  } else {
    row('', subject, '', true, 9.5 * scale)
  }
  const note = paper.paper_note?.trim()
  // Only board-style (legacy) papers carry a printed note. The model paper's note is an import remark, not the board's text.
  if (note && note !== FOOTER_TEXT && paper.pattern === 'legacy') {
    const N = safe(note, fonts.ital, allowed)
    const ns = fitSize(fonts.ital, N, 9 * scale, CONTENT_W, allowed)
    ops.push({ k: 't', x: MARGIN_X + (CONTENT_W - fonts.ital.widthOfTextAtSize(N, ns)) / 2, dy: y + ns * 0.92, text: N, font: fonts.ital, size: ns })
    y += ns * 1.35
  }
  ops.push({ k: 'l', x1: MARGIN_X, x2: MARGIN_X + CONTENT_W, dy: y + 1, w: 0.6 })
  y += 4
  return { height: y, after: 6 * scale, ops }
}

function headingBlock(c: Ctx, text: string): Block {
  const size = c.size + 1
  const clean = safe(text, c.fonts.bold, c.allowed)
  const w = c.fonts.bold.widthOfTextAtSize(clean, size)
  const x = MARGIN_X + (CONTENT_W - w) / 2
  const base = size * 0.92
  const pad = 5 * c.scale // space above the heading, so parts do not run together
  return {
    height: pad + size * 1.25, after: 3 * c.scale,
    ops: [
      { k: 't', x, dy: pad + base, text: clean, font: c.fonts.bold, size },
      { k: 'l', x1: x, x2: x + w, dy: pad + base + 1.6, w: 0.7 },
    ],
  }
}

// "Q.1: ... (10 x 1 = 10)": the question number and the marks weighting are bold.
function instructionSegs(line: string): Seg[] {
  const segs: Seg[] = []
  let rest = line.trim()
  const pre = rest.match(/^(Q\.?\s*\d+\s*[:.]?)/i)
  if (pre) { segs.push({ text: pre[1], bold: true }); rest = rest.slice(pre[1].length) }
  const wt = rest.match(/(\([^()]*=[^()]*\)\s*)$/)
  if (wt) {
    segs.push({ text: rest.slice(0, rest.length - wt[1].length) })
    segs.push({ text: ' ' + wt[1].trim(), bold: true })
  } else {
    segs.push({ text: rest })
  }
  return segs
}

// ---------------------------------------------------------------- ordering (same rules as the viewer)

function sortQuestions(a: SourceQuestion, b: SourceQuestion): number {
  if (a.question_number !== b.question_number) return a.question_number - b.question_number
  const altA = a.is_alternate ? 1 : 0
  const altB = b.is_alternate ? 1 : 0
  if (altA !== altB) return altA - altB
  return (a.sub_part ?? '').localeCompare(b.sub_part ?? '', undefined, { numeric: true })
}

function subPartNumber(sub: string | null): string | null {
  if (!sub) return null
  const m = sub.match(/(\d+)\s*$/)
  return m ? String(parseInt(m[1], 10)) : null
}

// ---------------------------------------------------------------- document

type Unit = Block[]

function buildUnits(c: Ctx, input: PrintInput): Unit[] {
  const units: Unit[] = []
  units.push([headerBlock(c, input)])

  const sorted = input.questions.slice().sort(sortQuestions)
  const sections = input.sections.slice().sort((a, b) => a.position - b.position)
  const labelW = c.fonts.bold.widthOfTextAtSize('Q10.', c.size) + 4

  const used = new Set<string>()
  const questionUnits = (qs: SourceQuestion[]): Unit[] => {
    const out: Unit[] = []
    for (const q of qs) {
      used.add(q.id)
      const isAlt = !!q.or_pair_key && !!q.is_alternate
      const n = subPartNumber(q.sub_part)
      const label = isAlt ? '' : n ? `${n}.` : `Q${q.question_number}.`
      const isMcq = q.section_type === 'mcq'
      const opts = Array.isArray(q.options) ? q.options.map((o, i) => ({ letter: 'abcdef'[i] ?? String(i + 1), text: String(o) })) : undefined
      const block = paragraph(c, [{ text: q.question }], {
        label, labelW,
        marks: !isMcq && q.marks !== null ? `[${fmt(q.marks)}]` : undefined,
        options: isMcq ? opts : undefined,
      })
      const unit: Unit = []
      if (isAlt) {
        const orBlock: Block = (() => {
          const w = c.fonts.bold.widthOfTextAtSize('-OR-', c.size)
          return {
            height: lineH(c) * 1.05, after: 1 * c.scale,
            ops: [{ k: 't', x: MARGIN_X + (CONTENT_W - w) / 2, dy: c.size * 0.92, text: '-OR-', font: c.fonts.bold, size: c.size }],
          } as Block
        })()
        unit.push(orBlock)
      }
      unit.push(block)
      out.push(unit)
    }
    return out
  }

  for (const s of sections) {
    const qs = sorted.filter(q => (q.section_id ? q.section_id === s.id : q.part_name === s.part_name))
    if (qs.length === 0) continue
    const lead: Block[] = [headingBlock(c, s.part_name)]
    if (s.instruction && s.instruction.trim()) {
      for (const line of s.instruction.split('\n')) {
        if (line.trim()) lead.push(paragraph(c, instructionSegs(line), { after: 2 * c.scale }))
      }
    }
    const qu = questionUnits(qs)
    // Keep the heading and instruction together with the first question (no orphaned headings).
    units.push([...lead, ...qu[0]])
    for (let i = 1; i < qu.length; i++) units.push(qu[i])
  }
  const rest = sorted.filter(q => !used.has(q.id))
  if (rest.length > 0) questionUnits(rest).forEach(u => units.push(u))

  if (input.paper.pattern === 'legacy') {
    const w = c.fonts.bold.widthOfTextAtSize('The End', c.size)
    units.push([{
      height: lineH(c) * 1.4, after: 0,
      ops: [{ k: 't', x: MARGIN_X + (CONTENT_W - w) / 2, dy: lineH(c) * 0.6 + c.size * 0.92, text: 'The End', font: c.fonts.bold, size: c.size }],
    }])
  }
  return units
}

type PlacedPage = { blocks: { block: Block; top: number }[] }

function place(units: Unit[]): PlacedPage[] {
  const limit = PAGE_H - MARGIN_BOTTOM
  const pages: PlacedPage[] = [{ blocks: [] }]
  let y = MARGIN_TOP
  const unitHeight = (u: Unit) => u.reduce((s, b) => s + b.height + b.after, 0)
  for (const u of units) {
    const total = unitHeight(u)
    if (y + total > limit && y > MARGIN_TOP && total <= limit - MARGIN_TOP) {
      pages.push({ blocks: [] })
      y = MARGIN_TOP
    }
    for (const b of u) {
      if (y + b.height > limit && y > MARGIN_TOP) {
        pages.push({ blocks: [] })
        y = MARGIN_TOP
      }
      pages[pages.length - 1].blocks.push({ block: b, top: y })
      y += b.height + b.after
    }
  }
  return pages
}

export async function buildPaperPdf(input: PrintInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const fonts: Fonts = {
    reg: await doc.embedFont(StandardFonts.TimesRoman),
    bold: await doc.embedFont(StandardFonts.TimesRomanBold),
    ital: await doc.embedFont(StandardFonts.TimesRomanItalic),
  }
  const allowed = new Set<number>(fonts.reg.getCharacterSet())

  // One page if possible (as the board prints it); otherwise flow onto more pages at the normal size.
  let chosen: PlacedPage[] | null = null
  for (const size of FIT_SIZES) {
    const c: Ctx = { fonts, allowed, size, scale: size / DEFAULT_SIZE }
    const pages = place(buildUnits(c, input))
    if (pages.length === 1) { chosen = pages; break }
  }
  if (!chosen) {
    const c: Ctx = { fonts, allowed, size: DEFAULT_SIZE, scale: 1 }
    chosen = place(buildUnits(c, input))
  }

  // The logo is optional: if it cannot be read, the paper still prints without it.
  let logo: Awaited<ReturnType<typeof doc.embedPng>> | null = null
  if (input.logo && input.logo.length > 8) {
    try {
      const b = input.logo
      const isPng = b[0] === 0x89 && b[1] === 0x50
      const isJpg = b[0] === 0xff && b[1] === 0xd8
      if (isPng) logo = await doc.embedPng(b)
      else if (isJpg) logo = await doc.embedJpg(b)
    } catch { logo = null }
  }

  const black = rgb(0, 0, 0)
  for (const pg of chosen) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    // Drawn first, so the text and lines sit on top of it.
    if (logo) {
      const k = Math.min(LOGO_MAX / logo.width, LOGO_MAX / logo.height)
      const w = logo.width * k
      const h = logo.height * k
      page.drawImage(logo, { x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2, width: w, height: h, opacity: LOGO_OPACITY })
    }
    for (const { block, top } of pg.blocks) {
      for (const op of block.ops) {
        if (op.k === 't') {
          page.drawText(op.text, { x: op.x, y: PAGE_H - top - op.dy, size: op.size, font: op.font, color: black })
        } else {
          const y = PAGE_H - top - op.dy
          page.drawLine({ start: { x: op.x1, y }, end: { x: op.x2, y }, thickness: op.w, color: black })
        }
      }
    }
    // Only papers IQRA generated carry the small "IQRA Test Paper" line. Real board papers print as the board printed them.
    if (input.paper.is_generated) {
      const fs = 8.5
      const fw = fonts.reg.widthOfTextAtSize(FOOTER_TEXT, fs)
      page.drawText(FOOTER_TEXT, { x: (PAGE_W - fw) / 2, y: FOOTER_Y, size: fs, font: fonts.reg, color: black })
    }
  }
  doc.setTitle(input.paper.title)
  doc.setCreator('IQRA')
  return doc.save()
}
