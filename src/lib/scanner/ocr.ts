// IQRA Scanner — S10 OCR (plan section 12): on-phone text reading with ML Kit (bundled model),
// stored locally and searchable. English only; Urdu / Islamiat / Arabic subjects are skipped.
// Put this file at src/lib/scanner/ocr.ts
import { useSyncExternalStore } from 'react'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { TextRecognition } from '@capacitor-mlkit/text-recognition'
import { scanDb, type ScanRow } from './scanDb'
import { pagePath } from './editScan'
import { FOOTER_BAND_RATIO, loadImage } from './stampPage'

// ---------- which scans are read ----------
const SKIPPED_SUBJECTS = /urdu|اردو|islamiat|islamic|اسلام|arabic|عربی|quran|قرآن|pashto|پشتو|persian|farsi/i
export const isSkippedSubject = (label: string) => SKIPPED_SUBJECTS.test(label)

// ---------- progress (for the "Reading text… 3/12" indicator) ----------
export interface OcrProgress { scanId: string; done: number; total: number }
let snapshot: OcrProgress | null = null
const listeners = new Set<() => void>()
function setProgress(p: OcrProgress | null) { snapshot = p; listeners.forEach((l) => l()) }
export function useOcrProgress(): OcrProgress | null {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb) } }, () => snapshot)
}

// ---------- reading one page ----------
async function recognizePage(row: ScanRow, index: number): Promise<string> {
  const { uri } = await Filesystem.getUri({ path: pagePath(row, index), directory: Directory.Data })
  const img = await loadImage(Capacitor.convertFileSrc(uri))
  const bandTop = img.naturalHeight - Math.round(img.naturalWidth * FOOTER_BAND_RATIO)

  const res: any = await TextRecognition.processImage({ path: uri })
  const top = (o: any) => o?.boundingBox?.top ?? o?.cornerPoints?.[0]?.[1] ?? 0
  const lines: string[] = []
  for (const block of res?.blocks ?? []) {
    const parts: any[] = block.lines?.length ? block.lines : [block]
    for (const part of parts) {
      if (top(part) >= bandTop * 0.98) continue // the "Scanned with Iqra" footer is not page text
      if (part.text) lines.push(String(part.text))
    }
  }
  return lines.join('\n')
}

const tokenize = (t: string): string[] => [...new Set(t.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])]

// ---------- background queue ----------
const queue: string[] = []
let running = false

export function enqueueOcr(scanId: string) {
  if (!Capacitor.isNativePlatform() || queue.includes(scanId)) return
  queue.push(scanId)
  void run()
}

async function run() {
  if (running) return
  running = true
  try {
    while (queue.length) {
      const id = queue.shift()!
      const row = await scanDb.scans.get(id)
      if (!row) continue
      await scanDb.ocrPages.where('scanId').equals(id).delete()

      if (isSkippedSubject(row.subjectLabel)) {
        await scanDb.scans.update(id, { ocrStatus: 'skipped' })
        continue
      }

      for (let i = 0; i < row.pageCount; i++) {
        setProgress({ scanId: id, done: i, total: row.pageCount })
        let text = ''
        try { text = await recognizePage(row, i) } catch { /* unreadable page: store empty */ }
        await scanDb.ocrPages.put({ id: `${id}:${i}`, scanId: id, userId: row.userId, pageIndex: i, text, words: tokenize(text) })
        await new Promise((r) => setTimeout(r, 0)) // let the UI breathe between pages
      }
      await scanDb.scans.update(id, { ocrStatus: 'done' })
    }
  } finally {
    setProgress(null)
    running = false
  }
}

/** Call when the library opens: picks up scans whose text was never read (app closed mid-way, edited, older scans). */
export async function resumePendingOcr(userId: string) {
  if (!Capacitor.isNativePlatform()) return
  const rows = await scanDb.scans.where('userId').equals(userId).toArray()
  const ids = new Set(rows.map((r) => r.id))
  // drop text of scans that no longer exist
  const orphanIds = new Set<string>()
  await scanDb.ocrPages.where('userId').equals(userId).each((p) => { if (!ids.has(p.scanId)) orphanIds.add(p.scanId) })
  for (const sid of orphanIds) await scanDb.ocrPages.where('scanId').equals(sid).delete()
  for (const r of rows) if (r.ocrStatus === 'pending') enqueueOcr(r.id)
}

// ---------- search ----------
export interface TextHit { scanId: string; pageIndex: number; snippet: string }

function snippetOf(text: string, term: string): string {
  const flat = text.replace(/\s+/g, ' ')
  const at = flat.toLowerCase().indexOf(term)
  if (at < 0) return flat.slice(0, 80)
  const from = Math.max(0, at - 35)
  return `${from > 0 ? '…' : ''}${flat.slice(from, at + term.length + 55)}${at + term.length + 55 < flat.length ? '…' : ''}`
}

/** Finds pages containing every word of the query (the last word may be partly typed). */
export async function searchContent(userId: string, query: string, scanId?: string, limit = 60): Promise<TextHit[]> {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const first = terms[0]
  if (!first || first.length < 2) return []
  const rows = await scanDb.ocrPages
    .where('words').startsWith(first).distinct()
    .filter((p) => p.userId === userId && (!scanId || p.scanId === scanId) && terms.every((t) => p.text.toLowerCase().includes(t)))
    .toArray()
  rows.sort((a, b) => (a.scanId === b.scanId ? a.pageIndex - b.pageIndex : a.scanId.localeCompare(b.scanId)))
  return rows.slice(0, limit).map((p) => ({ scanId: p.scanId, pageIndex: p.pageIndex, snippet: snippetOf(p.text, first) }))
}

// ---------- copy / export ----------
export async function getPageText(scanId: string, pageIndex: number): Promise<string> {
  return (await scanDb.ocrPages.get(`${scanId}:${pageIndex}`))?.text ?? ''
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { /* fall back below */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch { return false }
}

/** Writes the scan's full text to a .txt file and opens the share sheet. */
export async function exportTextFile(row: ScanRow): Promise<boolean> {
  const pages = await scanDb.ocrPages.where('scanId').equals(row.id).toArray()
  pages.sort((a, b) => a.pageIndex - b.pageIndex)
  const body = pages.map((p) => `--- Page ${p.pageIndex + 1} ---\n${p.text}`).join('\n\n')
  if (!body.replace(/--- Page \d+ ---/g, '').trim()) return false
  const file = `export/${row.name.replace(/[^\p{L}\p{N}_ -]+/gu, '_').trim() || 'scan'}.txt`
  await Filesystem.writeFile({ path: file, data: body, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true })
  const { uri } = await Filesystem.getUri({ path: file, directory: Directory.Cache })
  await Share.share({ title: row.name, files: [uri] }).catch(() => {})
  return true
}
