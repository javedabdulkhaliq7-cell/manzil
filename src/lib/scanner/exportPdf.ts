// IQRA Scanner — S6 "share with highlights": flattens strokes into a NEW pdf.
// The stored document.pdf and stamped pages are never modified.
// Put this file at src/lib/scanner/exportPdf.ts
import { Filesystem, Directory } from '@capacitor/filesystem'
import { PDFDocument, rgb, BlendMode, LineCapStyle } from 'pdf-lib'
import type { ScanRow } from './scanDb'
import type { AnnotationData } from './annotations'

const A4_WIDTH_PT = 595
const pad = (n: number) => String(n).padStart(3, '0')

function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255)
}

/** Builds a flattened PDF (base64) from the scan's stamped pages plus its strokes. */
export async function buildHighlightedPdf(row: ScanRow, ann: AnnotationData): Promise<string> {
  const pdf = await PDFDocument.create()
  for (let i = 0; i < row.pageCount; i++) {
    const { data } = await Filesystem.readFile({ path: `${row.folderPath}/pages/page_${pad(i + 1)}.jpg`, directory: Directory.Data })
    const img = await pdf.embedJpg(data as string)
    const k = A4_WIDTH_PT / img.width
    const w = img.width * k
    const h = img.height * k
    const page = pdf.addPage([w, h])
    page.drawImage(img, { x: 0, y: 0, width: w, height: h })

    for (const s of ann.pages[String(i)] ?? []) {
      if (s.points.length === 0) continue
      const pts = s.points.length === 1 ? [s.points[0], [s.points[0][0] + 0.0001, s.points[0][1]]] : s.points
      const path = pts.map(([x, y], j) => `${j === 0 ? 'M' : 'L'} ${(x * w).toFixed(2)} ${(y * h).toFixed(2)}`).join(' ')
      page.drawSvgPath(path, {
        x: 0, y: h,                       // svg y runs downward from the top edge
        borderColor: hexToRgb(s.color),
        borderWidth: Math.max(0.5, s.width * w),
        borderOpacity: s.tool === 'highlighter' ? 0.45 : 1,
        borderLineCap: LineCapStyle.Round,
        blendMode: s.tool === 'highlighter' ? BlendMode.Multiply : BlendMode.Normal,
      })
    }
  }
  return pdf.saveAsBase64()
}
