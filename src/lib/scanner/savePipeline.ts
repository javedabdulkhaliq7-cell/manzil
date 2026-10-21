// IQRA Scanner — S2 save pipeline (plan section 6).
// Put this file at src/lib/scanner/savePipeline.ts
//
// Order: stamp each page and write it into the private folder -> build the PDF
// ourselves -> thumbnail -> recompress if the PDF is too big -> insert the DB
// row LAST. Any failure deletes the partial folder; nothing shows in the
// library until every step succeeds.
import { Filesystem, Directory } from '@capacitor/filesystem'
import { PDFDocument } from 'pdf-lib'
import { scanDb, type ScanRow, type ScanQuality } from './scanDb'
import { stampPage, makeThumbnail } from './stampPage'
import { checkCopies } from './iqraDownloads'
import type { ScanMode } from './enhancePage'

const LARGE_SCAN_NOTE_BYTES = 25 * 1024 * 1024 // only a heads-up; pages are never shrunk automatically
const A4_WIDTH_PT = 595

const pad = (n: number) => String(n).padStart(3, '0')
const base64Bytes = (b64: string) => Math.floor((b64.length * 3) / 4)

export interface SaveScanInput {
  userId: string
  name: string
  classId: string
  subjectId: string | null
  subjectLabel: string
  chapterId: string | null
  uris: string[]                 // file:// page URIs from the scanner
  quality?: ScanQuality          // default 'high' (shown as "Clear")
  mode?: ScanMode                // default 'text'
  onProgress?: (done: number, total: number, stage: string) => void
}

export type SaveScanResult =
  | { ok: true; row: ScanRow; note?: string }
  | { ok: false; message: string }

export async function buildPdf(folder: string, pageCount: number, sub = 'pages'): Promise<string> {
  const pdf = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) {
    const { data } = await Filesystem.readFile({ path: `${folder}/${sub}/page_${pad(i + 1)}.jpg`, directory: Directory.Data })
    const jpg = await pdf.embedJpg(data as string)
    const scale = A4_WIDTH_PT / jpg.width
    const page = pdf.addPage([jpg.width * scale, jpg.height * scale])
    page.drawImage(jpg, { x: 0, y: 0, width: jpg.width * scale, height: jpg.height * scale })
  }
  return pdf.saveAsBase64()
}

export async function saveScan(input: SaveScanInput): Promise<SaveScanResult> {
  const { userId, uris, onProgress } = input
  if (uris.length === 0) return { ok: false, message: 'No pages to save' }

  const id = crypto.randomUUID()
  const folder = `scans/${userId}/${id}`
  const quality: ScanQuality = input.quality ?? 'high'
  const mode: ScanMode = input.mode ?? 'text'

  try {
    // 1 + 2: stamp each page and write it into the private folder (one page at a time = low memory)
    let firstPage = ''
    for (let i = 0; i < uris.length; i++) {
      onProgress?.(i, uris.length, 'Cleaning page')
      const stamped = await stampPage(uris[i], quality, mode)
      if (i === 0) firstPage = stamped.base64
      await Filesystem.writeFile({
        path: `${folder}/pages/page_${pad(i + 1)}.jpg`,
        data: stamped.base64,
        directory: Directory.Data,
        recursive: true,
      })
    }

    // 3: build the PDF ourselves from the stamped pages
    onProgress?.(uris.length, uris.length, 'Building PDF')
    const pdfB64 = await buildPdf(folder, uris.length)

    await Filesystem.writeFile({ path: `${folder}/document.pdf`, data: pdfB64, directory: Directory.Data })

    // 4: thumbnail from page 1
    const thumb = await makeThumbnail(firstPage)
    await Filesystem.writeFile({ path: `${folder}/thumb.jpg`, data: thumb, directory: Directory.Data })

    // annotations layer starts empty (S6 fills it)
    await Filesystem.writeFile({ path: `${folder}/annotations.json`, data: btoa('{}'), directory: Directory.Data })

    // 6: database row — only now does the scan become visible
    const now = Date.now()
    const row: ScanRow = {
      id, userId,
      name: input.name.trim() || 'Scan',
      classId: input.classId,
      subjectId: input.subjectId,
      subjectLabel: input.subjectLabel,
      chapterId: input.chapterId,
      pageCount: uris.length,
      sizeBytes: base64Bytes(pdfB64),
      createdAt: now, updatedAt: now,
      folderPath: folder,
      pdfPath: `${folder}/document.pdf`,
      thumbPath: `${folder}/thumb.jpg`,
      quality,
      mode,
      ocrStatus: 'pending',
      localCopyUri: null,
      lastViewedPage: 1,
    }
    await scanDb.scans.add(row)
    const note = row.sizeBytes > LARGE_SCAN_NOTE_BYTES ? 'This scan is large. It may take longer to share. You can make it smaller later with Compress.' : undefined
    return { ok: true, row, note }
  } catch (e: any) {
    // 7: any failure -> remove the partial folder, show a clear message
    await Filesystem.rmdir({ path: folder, directory: Directory.Data, recursive: true }).catch(() => {})
    const msg = String(e?.message ?? e ?? '')
    if (/space|enospc|quota/i.test(msg)) {
      return { ok: false, message: 'Not enough space on this phone. Free some storage and try again.' }
    }
    return { ok: false, message: "Couldn't save this scan. Nothing was changed — please try again." }
  }
}

/**
 * Startup cleanup (plan section 6 step 8 + section 8).
 * - folders on disk with no database row (app killed mid-save) are deleted
 * - rows whose file is gone (deleted outside the app) are removed quietly
 */
export async function reconcileScans(userId: string): Promise<void> {
  try {
    const rows = await scanDb.scans.where('userId').equals(userId).toArray()
    const known = new Set(rows.map((r) => r.id))

    for (const r of rows) {
      try {
        await Filesystem.stat({ path: r.pdfPath, directory: Directory.Data })
      } catch {
        await scanDb.scans.delete(r.id)
        await Filesystem.rmdir({ path: r.folderPath, directory: Directory.Data, recursive: true }).catch(() => {})
      }
    }

    await checkCopies(await scanDb.scans.where('userId').equals(userId).toArray())

    const { files } = await Filesystem.readdir({ path: `scans/${userId}`, directory: Directory.Data }).catch(() => ({ files: [] as any[] }))
    for (const f of files) {
      const name = typeof f === 'string' ? f : f.name
      if (!known.has(name)) {
        await Filesystem.rmdir({ path: `scans/${userId}/${name}`, directory: Directory.Data, recursive: true }).catch(() => {})
      }
    }
  } catch {
    // reconciliation is best-effort; never block the screen
  }
}
