// IQRA Scanner — S8 editing: add / delete / reorder pages, compress, single-page export.
// The stamped page images are the source of truth, so every edit rebuilds the PDF from them.
// Put this file at src/lib/scanner/editScan.ts
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { scanDb, type ScanRow, type ScanQuality } from './scanDb'
import { stampPage, recompressPage, makeThumbnail } from './stampPage'
import { buildPdf } from './savePipeline'
import { loadAnnotations, saveAnnotations, emptyAnnotations, type AnnotationData } from './annotations'

const D = Directory.Data
const pad = (n: number) => String(n).padStart(3, '0')
const base64Bytes = (b64: string) => Math.floor((b64.length * 3) / 4)
export const pagePath = (row: Pick<ScanRow, 'folderPath'>, index: number) => `${row.folderPath}/pages/page_${pad(index + 1)}.jpg`

/** One entry of the final page order: an existing page (old = zero-based index) or a fresh scan (newUri). */
export interface PageItem { key: string; old?: number; newUri?: string }

export type EditResult = { ok: true; row: ScanRow } | { ok: false; message: string }
type Progress = (done: number, total: number, stage: string) => void

/**
 * Applies a new page order/selection. Works in a side folder (pages_next) and only
 * swaps it in after the new PDF built successfully, so a failure leaves the scan untouched.
 * Highlights follow their pages; deleted pages lose theirs.
 */
export async function applyPageEdit(row: ScanRow, items: PageItem[], onProgress?: Progress): Promise<EditResult> {
  if (items.length === 0) return { ok: false, message: 'A scan needs at least one page.' }
  const folder = row.folderPath
  const next = `${folder}/pages_next`
  const old = `${folder}/pages_old`
  try {
    await Filesystem.rmdir({ path: next, directory: D, recursive: true }).catch(() => {})
    await Filesystem.rmdir({ path: old, directory: D, recursive: true }).catch(() => {})

    let first = ''
    for (let j = 0; j < items.length; j++) {
      onProgress?.(j, items.length, 'Updating pages')
      const it = items[j]
      let data: string
      if (it.old !== undefined) {
        data = (await Filesystem.readFile({ path: pagePath(row, it.old), directory: D })).data as string
      } else {
        data = (await stampPage(it.newUri!, row.quality, row.mode ?? 'colour')).base64
      }
      await Filesystem.writeFile({ path: `${next}/page_${pad(j + 1)}.jpg`, data, directory: D, recursive: true })
      if (j === 0) first = data
    }

    onProgress?.(items.length, items.length, 'Building PDF')
    const pdfB64 = await buildPdf(folder, items.length, 'pages_next')

    const oldAnn = await loadAnnotations(folder)
    const newAnn: AnnotationData = emptyAnnotations()
    items.forEach((it, j) => {
      const strokes = it.old !== undefined ? oldAnn.pages[String(it.old)] : undefined
      if (strokes && strokes.length) newAnn.pages[String(j)] = strokes
    })

    // swap folders, with a way back if the second rename fails
    await Filesystem.rename({ from: `${folder}/pages`, to: old, directory: D, toDirectory: D })
    try {
      await Filesystem.rename({ from: next, to: `${folder}/pages`, directory: D, toDirectory: D })
    } catch (e) {
      await Filesystem.rename({ from: old, to: `${folder}/pages`, directory: D, toDirectory: D }).catch(() => {})
      throw e
    }
    await Filesystem.rmdir({ path: old, directory: D, recursive: true }).catch(() => {})

    await Filesystem.writeFile({ path: row.pdfPath, data: pdfB64, directory: D })
    await saveAnnotations(folder, newAnn)
    await Filesystem.writeFile({ path: row.thumbPath, data: await makeThumbnail(first), directory: D })

    const updated: ScanRow = {
      ...row,
      pageCount: items.length,
      sizeBytes: base64Bytes(pdfB64),
      updatedAt: Date.now(),
      lastViewedPage: Math.min(row.lastViewedPage, items.length),
      ocrStatus: 'pending', // page text must be re-read (S10)
    }
    await scanDb.scans.put(updated)
    return { ok: true, row: updated }
  } catch {
    await Filesystem.rmdir({ path: next, directory: D, recursive: true }).catch(() => {})
    return { ok: false, message: "Couldn't update this scan. Nothing was changed — please try again." }
  }
}

const QUALITY_RANK: Record<ScanQuality, number> = { small: 0, normal: 1, high: 2 }
/** Pages can only get smaller, never sharper than they were saved. */
export const canCompressTo = (current: ScanQuality, target: ScanQuality) => QUALITY_RANK[target] < QUALITY_RANK[current]

export async function compressScan(row: ScanRow, quality: ScanQuality, onProgress?: Progress): Promise<EditResult> {
  if (!canCompressTo(row.quality, quality)) return { ok: false, message: 'This scan is already at that size or smaller.' }
  try {
    for (let i = 0; i < row.pageCount; i++) {
      onProgress?.(i, row.pageCount, 'Compressing')
      const path = pagePath(row, i)
      const { data } = await Filesystem.readFile({ path, directory: D })
      const re = await recompressPage(data as string, quality)
      await Filesystem.writeFile({ path, data: re.base64, directory: D })
    }
    onProgress?.(row.pageCount, row.pageCount, 'Building PDF')
    const pdfB64 = await buildPdf(row.folderPath, row.pageCount)
    await Filesystem.writeFile({ path: row.pdfPath, data: pdfB64, directory: D })
    const updated: ScanRow = { ...row, quality, sizeBytes: base64Bytes(pdfB64), updatedAt: Date.now() }
    await scanDb.scans.put(updated)
    return { ok: true, row: updated }
  } catch {
    return { ok: false, message: "Couldn't compress this scan. Please try again." }
  }
}

/** Shares one stamped page as an image. */
export async function sharePageImage(row: ScanRow, index: number): Promise<void> {
  const { uri } = await Filesystem.getUri({ path: pagePath(row, index), directory: D })
  await Share.share({ title: `${row.name} – page ${index + 1}`, files: [uri] })
}
