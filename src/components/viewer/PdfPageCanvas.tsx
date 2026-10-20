// IQRA Scanner — renders one PDF page to a canvas (plan section 9).
// Put this file at src/components/viewer/PdfPageCanvas.tsx
import { useEffect, useRef } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

/**
 * The page is drawn offscreen first and then copied over, so re-rendering sharper
 * after a zoom never flashes blank. Unmounting frees the canvas (only visible
 * pages are mounted by the viewer).
 */
export default function PdfPageCanvas({ doc, pageNum, pixelWidth }: { doc: PDFDocumentProxy; pageNum: number; pixelWidth: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    let task: { promise: Promise<unknown>; cancel: () => void } | null = null
    ;(async () => {
      const page = await doc.getPage(pageNum)
      if (cancelled) return
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: pixelWidth / base.width })
      const off = document.createElement('canvas')
      off.width = Math.max(1, Math.floor(viewport.width))
      off.height = Math.max(1, Math.floor(viewport.height))
      const ctx = off.getContext('2d')!
      task = page.render({ canvas: off, canvasContext: ctx, viewport } as any)
      await task!.promise
      if (cancelled || !ref.current) return
      const target = ref.current
      target.width = off.width
      target.height = off.height
      target.getContext('2d')!.drawImage(off, 0, 0)
    })().catch(() => { /* cancelled or unreadable page: leave the page blank */ })
    return () => { cancelled = true; task?.cancel() }
  }, [doc, pageNum, pixelWidth])

  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}
