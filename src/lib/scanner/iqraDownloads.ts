// IQRA Scanner — S9 "Download to phone" (plan section 8).
// A visible copy goes to Downloads/Iqra; the scan itself stays in Iqra's private folder.
// Put this file at src/lib/scanner/iqraDownloads.ts
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { scanDb, type ScanRow } from './scanDb'
import { buildHighlightedPdf } from './exportPdf'
import type { AnnotationData } from './annotations'
import { Native } from './nativeBridge'



export type CopyResult = { ok: true; row: ScanRow; folder: string } | { ok: false; message: string }

const safeName = (s: string) => s.replace(/[^\p{L}\p{N}_ -]+/gu, '_').trim() || 'scan'

/** Copies the scan's PDF (original, or flattened with highlights) into Downloads/Iqra. */
export async function downloadCopy(row: ScanRow, withHighlights: boolean, ann: AnnotationData | null): Promise<CopyResult> {
  if (!Capacitor.isNativePlatform()) return { ok: false, message: 'Downloading is available in the IQRA Android app.' }
  try {
    let sourcePath: string
    let fileName = `${safeName(row.name)}.pdf`
    if (withHighlights && ann) {
      const b64 = await buildHighlightedPdf(row, ann)
      const tmp = `export/${safeName(row.name)}_highlighted.pdf`
      await Filesystem.writeFile({ path: tmp, data: b64, directory: Directory.Cache, recursive: true })
      sourcePath = (await Filesystem.getUri({ path: tmp, directory: Directory.Cache })).uri
      fileName = `${safeName(row.name)}_highlighted.pdf`
    } else {
      sourcePath = (await Filesystem.getUri({ path: row.pdfPath, directory: Directory.Data })).uri
    }

    // one tracked copy per scan: replace the previous one instead of piling up duplicates
    if (row.localCopyUri) await Native.deleteCopy({ uri: row.localCopyUri }).catch(() => {})

    const { uri, folder } = await Native.savePdf({ sourcePath, fileName })
    const updated: ScanRow = { ...row, localCopyUri: uri, updatedAt: Date.now() }
    await scanDb.scans.put(updated)
    return { ok: true, row: updated, folder }
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? '')
    if (/PERMISSION_DENIED/.test(msg)) return { ok: false, message: 'Allow storage access to save a copy to your phone.' }
    return { ok: false, message: "Couldn't save a copy to your phone. Please try again." }
  }
}

/** Removes only the copy in Downloads/Iqra; the scan stays in the library. */
export async function deleteCopy(row: ScanRow): Promise<ScanRow> {
  if (row.localCopyUri) await Native.deleteCopy({ uri: row.localCopyUri }).catch(() => {})
  const updated: ScanRow = { ...row, localCopyUri: null, updatedAt: Date.now() }
  await scanDb.scans.put(updated)
  return updated
}

/** If the student removed a copy with a file manager, quietly drop its badge. */
export async function checkCopies(rows: ScanRow[]): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  for (const r of rows) {
    if (!r.localCopyUri) continue
    try {
      const { exists } = await Native.exists({ uri: r.localCopyUri })
      if (!exists) await scanDb.scans.update(r.id, { localCopyUri: null })
    } catch { /* leave the badge if we can't tell */ }
  }
}
