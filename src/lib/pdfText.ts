// pdfText.ts  (Phase 1 print-engine proof, File 1 Section 6)
//
// Text layout for pdf-lib that handles: Urdu/Arabic joining (via fontkit shaping),
// right-to-left lines, English words/numbers inside Urdu lines (and the reverse),
// mirrored brackets, per-glyph font fallback (Latin -> maths symbols -> Naskh),
// and word wrapping. Pure functions + one font loader, so the same code runs in the
// Android app, the web build and a Node script.
import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import bidiFactory from 'bidi-js'

const bidi = bidiFactory()

export type FontBytes = {
  latin: Uint8Array
  latinBold: Uint8Array
  math: Uint8Array
  /** Only needed when the test contains Urdu/Arabic. Load it lazily. */
  naskh?: Uint8Array
}

export type Fonts = {
  latin: PDFFont
  latinBold: PDFFont
  math: PDFFont
  naskh?: PDFFont
  has: { latin: Set<number>; math: Set<number>; naskh: Set<number> }
}

// Code points a font can draw, read from the font itself (fontkit exposes it on the embedded font).
function cmapSet(f: PDFFont | undefined): Set<number> {
  const s = new Set<number>()
  if (!f) return s
  // pdf-lib keeps the fontkit font here; it is not in the public types.
  const fk = (f as unknown as { embedder?: { font?: { characterSet: number[] } } }).embedder?.font
  if (fk?.characterSet) for (const c of fk.characterSet) s.add(c)
  return s
}

export async function embedFonts(pdf: PDFDocument, bytes: FontBytes): Promise<Fonts> {
  pdf.registerFontkit(fontkit)
  const latin = await pdf.embedFont(bytes.latin, { subset: true })
  const latinBold = await pdf.embedFont(bytes.latinBold, { subset: true })
  // Whole (already small, curated) symbol font: pdf-lib's own re-subsetting blanks these glyphs.
  const math = await pdf.embedFont(bytes.math, { subset: false })
  const naskh = bytes.naskh ? await pdf.embedFont(bytes.naskh, { subset: true }) : undefined
  return { latin, latinBold, math, naskh, has: { latin: cmapSet(latin), math: cmapSet(math), naskh: cmapSet(naskh) } }
}

export const isArabicScript = (cp: number) =>
  (cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f) || (cp >= 0x08a0 && cp <= 0x08ff) ||
  (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)

export const containsArabic = (s: string) => { for (const ch of s) if (isArabicScript(ch.codePointAt(0)!)) return true; return false }

type FontKey = 'latin' | 'math' | 'naskh'
type Seg = { text: string; key: FontKey; odd: boolean; orig: string[]; mir: string[] }

function pickFont(cp: number, odd: boolean, fonts: Fonts): FontKey {
  if (isArabicScript(cp)) return fonts.naskh ? 'naskh' : 'latin'
  if (fonts.has.latin.has(cp)) return 'latin'
  if (fonts.has.math.has(cp)) return 'math'
  if (fonts.has.naskh.has(cp)) return 'naskh'
  return 'latin'
}

/** Split one line into visual-order segments, each in one font, ready to draw left to right. */
const LRI = '\u2066', PDI = '\u2069'
const isControl = (ch: string) => ch >= '\u2066' && ch <= '\u2069'

/** In a right-to-left line, keep every run of English words / numbers / simple maths together as ONE
 *  left-to-right block, so "20 Oct 2026" or "10 x 1 = 10" is not split by the bidi rules. */
export function isolateLtrRuns(line: string): string {
  return line.replace(/[A-Za-z0-9](?:[A-Za-z0-9\u00C0-\u024F.,:;'%+\-\u2212\u00D7\u00F7=<>\u00B2\u00B3\u00B0\/ ]*[A-Za-z0-9%])?/g, m => LRI + m + PDI)
}

export function visualSegments(line: string, rtlBase: boolean, fonts: Fonts): Seg[] {
  if (!line) return []
  if (rtlBase) line = isolateLtrRuns(line)
  const chars = Array.from(line)
  const text = chars.join('')
  const lv = bidi.getEmbeddingLevels(text, rtlBase ? 'rtl' : 'ltr')
  const levels = lv.levels
  const order: number[] = bidi.getReorderedIndices(text, lv)
  const mirror = bidi.getMirroredCharactersMap(text, levels)
  // Note: indices from bidi-js are UTF-16 indices; our content is BMP, so they match chars[] indices.
  const vis = order.filter(i => !isControl(chars[i])).map(i => {
    const odd = (levels[i] & 1) === 1
    const orig = chars[i]
    const mir = odd ? (mirror.get(i) ?? orig) : orig
    return { orig, mir, odd, cp: orig.codePointAt(0)! }
  })
  const segs: Seg[] = []
  let prevKey: FontKey = 'latin'
  for (const v of vis) {
    const isSpace = /\s/.test(v.orig)
    // spaces/neutrals take the font of the previous character so words do not split needlessly
    // the symbol font has no space glyph, so a space after a symbol falls back to the text font
    const key: FontKey = isSpace && segs.length ? (prevKey === 'math' ? 'latin' : prevKey) : pickFont(v.cp, v.odd, fonts)
    const last = segs[segs.length - 1]
    if (last && last.key === key && last.odd === v.odd) { last.orig.push(v.orig); last.mir.push(v.mir) }
    else segs.push({ text: '', key, odd: v.odd, orig: [v.orig], mir: [v.mir] })
    prevKey = key
  }
  // A right-to-left Naskh segment that contains Arabic letters is handed to fontkit, which does its own
  // shaping, reversal AND bracket mirroring (rtlm). It must get the ORIGINAL characters in logical order.
  // Every other segment is drawn left to right exactly as bidi laid it out, with our own mirroring.
  for (const sg of segs) {
    const viaFontkit = sg.odd && sg.key === 'naskh' && containsArabic(sg.orig.join(''))
    sg.text = viaFontkit ? [...sg.orig].reverse().join('') : sg.mir.join('')
  }
  return segs
}

export type LineLayout = { segs: Seg[]; width: number }

export function measure(line: string, size: number, rtlBase: boolean, fonts: Fonts, bold = false): LineLayout {
  const segs = visualSegments(line, rtlBase, fonts)
  let width = 0
  for (const s of segs) width += fontOf(s.key, fonts, bold).widthOfTextAtSize(s.text, size * (s.key === 'naskh' ? NASKH_SCALE : 1))
  return { segs, width }
}

/** Naskh draws visually smaller than Latin at the same point size. */
export const NASKH_SCALE = 1.12

function fontOf(k: FontKey, f: Fonts, bold: boolean): PDFFont {
  if (k === 'naskh') return f.naskh ?? f.latin
  if (k === 'math') return f.math
  return bold ? f.latinBold : f.latin
}

/** Draw one line. For right-to-left, `x` is the RIGHT edge; otherwise the LEFT edge. Returns the width. */
export function drawLine(page: PDFPage, line: string, x: number, y: number, size: number, rtlBase: boolean, fonts: Fonts,
  opts: { bold?: boolean; color?: [number, number, number] } = {}): number {
  const { segs, width } = measure(line, size, rtlBase, fonts, !!opts.bold)
  let cx = rtlBase ? x - width : x
  const c = opts.color ?? [0, 0, 0]
  for (const s of segs) {
    const sz = size * (s.key === 'naskh' ? NASKH_SCALE : 1)
    const font = fontOf(s.key, fonts, !!opts.bold)
    page.drawText(s.text, { x: cx, y, size: sz, font, color: rgb(c[0], c[1], c[2]) })
    cx += font.widthOfTextAtSize(s.text, sz)
  }
  return width
}

/** Greedy word wrap in logical order. Each resulting line is laid out by bidi on its own. */
export function wrapText(text: string, maxWidth: number, size: number, rtlBase: boolean, fonts: Fonts, bold = false): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    let cur = ''
    for (const w of words) {
      const cand = cur ? cur + ' ' + w : w
      if (cur && measure(cand, size, rtlBase, fonts, bold).width > maxWidth) { out.push(cur); cur = w } else cur = cand
    }
    out.push(cur)
  }
  return out
}
