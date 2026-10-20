// IQRA Scanner — S6 annotation layer storage (plan section 10).
// Strokes live in annotations.json beside the scan, in normalised coordinates
// (0-1 across the page), never drawn into the PDF or the stamped pages.
// Put this file at src/lib/scanner/annotations.ts
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'

export type Tool = 'none' | 'highlighter' | 'pen' | 'eraser'

export interface Stroke {
  id: string
  tool: 'highlighter' | 'pen'
  color: string                 // hex
  width: number                 // fraction of page width
  points: [number, number][]    // x = fraction of page width, y = fraction of page height
}

export interface AnnotationData {
  v: 1
  pages: Record<string, Stroke[]>   // key = zero-based page index
}

export const COLORS = ['#FFE600', '#4ADE80', '#F472B6', '#60A5FA', '#EF4444'] // yellow, green, pink, blue, red
export const BASE_WIDTH = { highlighter: 0.03, pen: 0.004 }

export const emptyAnnotations = (): AnnotationData => ({ v: 1, pages: {} })

export function countStrokes(d: AnnotationData): number {
  return Object.values(d.pages).reduce((n, list) => n + list.length, 0)
}

export async function loadAnnotations(folder: string): Promise<AnnotationData> {
  try {
    const { data } = await Filesystem.readFile({ path: `${folder}/annotations.json`, directory: Directory.Data, encoding: Encoding.UTF8 })
    const parsed = JSON.parse(typeof data === 'string' ? data : '{}')
    if (parsed && typeof parsed === 'object' && parsed.pages && typeof parsed.pages === 'object') return { v: 1, pages: parsed.pages }
  } catch { /* missing or unreadable: start empty */ }
  return emptyAnnotations()
}

export async function saveAnnotations(folder: string, d: AnnotationData): Promise<void> {
  await Filesystem.writeFile({
    path: `${folder}/annotations.json`,
    data: JSON.stringify(d),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
  })
}

/** Distance from point p to segment a-b, measured in page-width units (y scaled by aspect). */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Does the eraser at (x, y) touch this stroke? */
export function strokeHit(s: Stroke, x: number, y: number, aspect: number, radius = 0.03): boolean {
  const pts = s.points
  if (pts.length === 0) return false
  const r = radius + s.width / 2
  if (pts.length === 1) return Math.hypot(x - pts[0][0], (y - pts[0][1]) * aspect) <= r
  for (let i = 1; i < pts.length; i++) {
    if (segDist(x, y * aspect, pts[i - 1][0], pts[i - 1][1] * aspect, pts[i][0], pts[i][1] * aspect) <= r) return true
  }
  return false
}
