// IQRA Scanner — pdf.js setup (plan section 9). The worker is bundled by Vite
// (?url import), never loaded from a CDN, so the viewer works offline.
// Put this file at src/lib/pdfjs.ts
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Filesystem, Directory } from '@capacitor/filesystem'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Opens a PDF stored in the app's private folder (Directory.Data). */
export async function loadPdfFromPrivatePath(path: string): Promise<PDFDocumentProxy> {
  const { data } = await Filesystem.readFile({ path, directory: Directory.Data })
  const bytes = typeof data === 'string' ? base64ToBytes(data) : new Uint8Array(await (data as Blob).arrayBuffer())
  return pdfjsLib.getDocument({ data: bytes }).promise
}
