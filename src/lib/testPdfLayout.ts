// testPdfLayout.ts  (Phase 1 proof of the File 1 Section 6 fitting rule)
// Exact A4 (595 x 842 pt). Try 10pt, 9.5pt, 9pt on ONE page; otherwise 2 pages at 10pt.
// Questions never split across pages; a heading is never left alone at the bottom of a page.
import { PDFDocument, PDFImage, PDFPage, rgb } from 'pdf-lib'
import { Fonts, drawLine, measure, wrapText, NASKH_SCALE } from './pdfText'

export type Q = { num: string; text: string; options?: string[]; image?: { png: Uint8Array; w: number; h: number } }
export type Section = { heading: string; instruction?: string; items: Q[] }
export type TestDoc = {
  title: string; subtitle: string; meta: string; rtl: boolean; sections: Section[]
}

const W = 595, H = 842, MX = 42, MTOP = 40, MBOTTOM = 44
const OPT_LABELS_EN = ['a', 'b', 'c', 'd']
const OPT_LABELS_UR = ['الف', 'ب', 'ج', 'د']

type Block = { h: number; draw: (page: PDFPage, y: number) => void; keepWithNext?: boolean }

function lineH(size: number, rtl: boolean) { return size * (rtl ? 1.75 : 1.42) }

function buildBlocks(doc: TestDoc, size: number, fonts: Fonts, images: Map<Q, PDFImage>): { header: Block; blocks: Block[] } {
  const rtl = doc.rtl
  const maxW = W - 2 * MX
  const edge = rtl ? W - MX : MX
  const LH = lineH(size, rtl)

  const header: Block = {
    h: 62,
    draw: (page, y) => {
      drawLine(page, doc.title, W / 2 - measure(doc.title, 15, false, fonts, true).width / 2, y - 16, 15, false, fonts, { bold: true })
      const sub = measure(doc.subtitle, size + 0.5, rtl, fonts)
      drawLine(page, doc.subtitle, rtl ? W / 2 + sub.width / 2 : W / 2 - sub.width / 2, y - 33, size + 0.5, rtl, fonts)
      drawLine(page, doc.meta, edge, y - 50, size, rtl, fonts)
      page.drawLine({ start: { x: MX, y: y - 56 }, end: { x: W - MX, y: y - 56 }, thickness: 0.6, color: rgb(0.4, 0.4, 0.4) })
    },
  }

  const blocks: Block[] = []
  for (const sec of doc.sections) {
    const headLines = [sec.heading, ...(sec.instruction ? [sec.instruction] : [])]
    blocks.push({
      h: LH * headLines.length + 4, keepWithNext: true,
      draw: (page, y) => {
        drawLine(page, sec.heading, edge, y - size, size + 0.5, rtl, fonts, { bold: true })
        if (sec.instruction) drawLine(page, sec.instruction, edge, y - size - LH, size - 0.5, rtl, fonts, { color: [0.3, 0.3, 0.3] })
      },
    })
    for (const q of sec.items) {
      const numW = measure('00.', size, rtl, fonts, true).width + 6   // fixed number column so all text lines up
      const textW = maxW - numW
      const lines = wrapText(q.text, textW, size, rtl, fonts)
      let optRows: string[][] = []
      if (q.options) {
        const labels = rtl ? OPT_LABELS_UR : OPT_LABELS_EN
        const opts = q.options.map((o, i) => `(${labels[i]}) ${o}`)
        const fits = (cols: number) => opts.every(o => measure(o, size, rtl, fonts).width <= (textW / cols) - 8)
        const cols = fits(4) ? 4 : fits(2) ? 2 : 1
        for (let i = 0; i < opts.length; i += cols) optRows.push(opts.slice(i, i + cols))
        ;(q as any)._cols = cols
      }
      const img = images.get(q)
      const imgH = q.image ? q.image.h : 0
      const h = LH * lines.length + LH * optRows.length + (imgH ? imgH + 4 : 0) + 3
      blocks.push({
        h,
        draw: (page, y) => {
          let cy = y - size
          drawLine(page, q.num + '.', edge, cy, size, rtl, fonts, { bold: true })
          const tx = rtl ? edge - numW : edge + numW
          for (const ln of lines) { drawLine(page, ln, tx, cy, size, rtl, fonts); cy -= LH }
          if (img && q.image) {
            const ix = rtl ? tx - q.image.w : tx
            page.drawImage(img, { x: ix, y: cy - q.image.h + size * 0.6, width: q.image.w, height: q.image.h })
            cy -= q.image.h + 4
          }
          const cols = (q as any)._cols as number
          for (const row of optRows) {
            const colW = textW / cols
            row.forEach((o, i) => {
              const ox = rtl ? tx - i * colW : tx + i * colW
              drawLine(page, o, ox, cy, size, rtl, fonts)
            })
            cy -= LH
          }
        },
      })
    }
  }
  return { header, blocks }
}

type Plan = { size: number; pages: Block[][]; ok: boolean }

function paginate(doc: TestDoc, size: number, fonts: Fonts, images: Map<Q, PDFImage>): Plan {
  const { header, blocks } = buildBlocks(doc, size, fonts, images)
  const usable = H - MTOP - MBOTTOM
  const pages: Block[][] = [[header]]
  let used = header.h
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    // a heading must travel with the next question
    const need = b.keepWithNext && blocks[i + 1] ? b.h + blocks[i + 1].h : b.h
    if (used + need > usable && pages[pages.length - 1].length > 0) { pages.push([]); used = 0 }
    pages[pages.length - 1].push(b); used += b.h
  }
  return { size, pages, ok: pages.length === 1 }
}

export type FitResult = { size: number; pages: number }

export async function buildTestPdf(pdf: PDFDocument, doc: TestDoc, fonts: Fonts): Promise<FitResult> {
  const images = new Map<Q, PDFImage>()
  for (const s of doc.sections) for (const q of s.items) if (q.image) images.set(q, await pdf.embedPng(q.image.png))
  let plan: Plan | null = null
  for (const sz of [10, 9.5, 9]) { const p = paginate(doc, sz, fonts, images); if (p.ok) { plan = p; break } }
  if (!plan) plan = paginate(doc, 10, fonts, images)   // last choice: two (or more) pages at 10pt
  const n = plan.pages.length
  plan.pages.forEach((blocks, pi) => {
    const page = pdf.addPage([W, H])
    let y = H - MTOP
    for (const b of blocks) { b.draw(page, y); y -= b.h }
    if (n > 1) {
      const t = `Page ${pi + 1} of ${n}`
      const w = measure(t, 8, false, fonts).width
      drawLine(page, t, W / 2 - w / 2, 24, 8, false, fonts, { color: [0.4, 0.4, 0.4] })
    }
  })
  return { size: plan.size, pages: n }
}
export { NASKH_SCALE }
