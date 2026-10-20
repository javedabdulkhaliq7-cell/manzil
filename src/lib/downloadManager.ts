// Download, update and delete papers saved on the phone (Phase 11).
import { supabase } from './supabase'
import {
  kvDel, kvEntries, kvGet, kvKeys, keys, purgeUser,
} from './offlineStore'
import { recordOnlineCheck } from './offlineValidity'
import { cacheLogos } from './logoStore'
import {
  loadPaperFromNetwork, savePaperLocally, PaperEntry, PaperKind,
} from './paperSource'
import { fetchSubjectPack, savePack, loadPack, refreshUsedLog, SubjectPack } from './subjectPack'

export type PaperLocalState = { state: 'none' | 'saved' | 'update'; bytes: number }

// Sizes measured on the real Biology data (bytes per row). Used only to show the size before downloading.
const BYTES = { paper: 25000, mcq: 650, short: 1050, long: 2600, overhead: 15000 }

export function estimateBytes(papers: number, mcqs: number, shorts: number, longs: number): number {
  return papers * BYTES.paper + mcqs * BYTES.mcq + shorts * BYTES.short + longs * BYTES.long + BYTES.overhead
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

// ---------------------------------------------------------------- one paper

export type DownloadOutcome = 'ok' | 'notfound' | 'error' | 'offline' | 'storage'

let lastReason = ''
// Why the last download failed, in plain words, for the error message.
export function lastDownloadReason(): string { return lastReason || 'unknown reason' }

export async function downloadPaper(uid: string, kind: PaperKind, id: string): Promise<DownloadOutcome> {
  if (!isOnline()) return 'offline'
  const net = await loadPaperFromNetwork(kind, id)
  if (net.status === 'notfound') { lastReason = 'this paper is not available'; return 'notfound' }
  if (net.status !== 'ok') { lastReason = net.reason || 'could not reach the server'; return 'error' }
  const saved = await savePaperLocally(uid, kind, net.bundle)
  return saved ? 'ok' : 'storage'
}

export async function paperLocalState(
  uid: string, kind: PaperKind, id: string, serverVersion: number | null | undefined,
): Promise<PaperLocalState> {
  const local = await kvGet<PaperEntry>(keys.paper(uid, kind, id))
  if (!local) return { state: 'none', bytes: 0 }
  const stale = kind === 'past' && serverVersion !== undefined && serverVersion !== null && local.version !== serverVersion
  return { state: stale ? 'update' : 'saved', bytes: local.bytes }
}

export async function deletePaper(uid: string, kind: PaperKind, id: string): Promise<void> {
  await kvDel(keys.paper(uid, kind, id))
}

// ---------------------------------------------------------------- one subject

export type SubjectEstimate = {
  papersToGet: number
  papersTotal: number
  bytes: number
}

export async function estimateSubject(uid: string, subjectId: string): Promise<SubjectEstimate> {
  const [list, mcq, short, long] = await Promise.all([
    supabase.from('past_papers').select('id, version').eq('subject_id', subjectId).eq('status', 'published'),
    supabase.from('answer_ready_mcqs').select('id', { count: 'exact', head: true }).eq('subject_id', subjectId),
    supabase.from('answer_ready_short_questions').select('id', { count: 'exact', head: true }).eq('subject_id', subjectId),
    supabase.from('answer_ready_long_questions').select('id', { count: 'exact', head: true }).eq('subject_id', subjectId),
  ])
  if (list.error) throw list.error
  const rows = (list.data ?? []) as { id: string; version: number | null }[]
  let toGet = 0
  for (const r of rows) {
    const local = await kvGet<PaperEntry>(keys.paper(uid, 'past', r.id))
    if (!local || local.version !== r.version) toGet += 1
  }
  return {
    papersToGet: toGet,
    papersTotal: rows.length,
    bytes: estimateBytes(toGet, mcq.count ?? 0, short.count ?? 0, long.count ?? 0),
  }
}

export type Progress = { done: number; total: number }
export type SubjectResult = { cancelled: boolean; failed: number; papers: number; error?: 'offline' | 'storage' }

// Saves the subject's published papers and the question bank the generator needs.
// Papers already saved at the current version are skipped, so an interrupted download simply resumes.
export async function downloadSubject(
  uid: string, subjectId: string,
  opts: { onProgress?: (p: Progress) => void; signal?: AbortSignal } = {},
): Promise<SubjectResult> {
  const { onProgress, signal } = opts
  if (!isOnline()) return { cancelled: false, failed: 0, papers: 0, error: 'offline' }

  await cacheLogos() // so the logo is there on the saved papers when offline
  const list = await supabase.from('past_papers').select('id, version').eq('subject_id', subjectId).eq('status', 'published')
  if (list.error) throw list.error
  const rows = (list.data ?? []) as { id: string; version: number | null }[]
  const todo: string[] = []
  for (const r of rows) {
    const local = await kvGet<PaperEntry>(keys.paper(uid, 'past', r.id))
    if (!local || local.version !== r.version) todo.push(r.id)
  }

  const total = todo.length + 1
  let done = 0
  let failed = 0
  onProgress?.({ done, total })

  for (const id of todo) {
    if (signal?.aborted) return { cancelled: true, failed, papers: done }
    const out = await downloadPaper(uid, 'past', id)
    if (out === 'offline') return { cancelled: false, failed, papers: done, error: 'offline' }
    if (out === 'storage') return { cancelled: false, failed, papers: done, error: 'storage' }
    if (out !== 'ok') failed += 1
    done += 1
    onProgress?.({ done, total })
  }

  if (signal?.aborted) return { cancelled: true, failed, papers: done }
  try {
    const pack = await fetchSubjectPack(subjectId, signal)
    if (signal?.aborted) return { cancelled: true, failed, papers: done }
    const ok = await savePack(uid, pack)
    if (!ok) return { cancelled: false, failed, papers: done, error: 'storage' }
    await refreshUsedLog(uid, subjectId, pack.chapters.map(c => c.id), signal)
  } catch {
    if (signal?.aborted) return { cancelled: true, failed, papers: done }
    failed += 1
  }
  done += 1
  onProgress?.({ done, total })
  await recordOnlineCheck(uid)
  return { cancelled: false, failed, papers: todo.length }
}

// ---------------------------------------------------------------- what is saved

export type DownloadItem = {
  key: string
  type: 'past' | 'generated' | 'pack'
  id: string
  subjectId: string
  subjectName: string
  title: string
  bytes: number
  savedAt: number
  pendingSync: boolean
}

export async function listDownloads(uid: string): Promise<DownloadItem[]> {
  const out: DownloadItem[] = []
  for (const { key, value } of await kvEntries<PaperEntry>(keys.papers(uid))) {
    out.push({
      key, type: value.kind, id: value.data.paper.id, subjectId: value.subjectId,
      subjectName: value.data.subject?.name ?? 'Subject', title: value.title,
      bytes: value.bytes, savedAt: value.savedAt, pendingSync: !!value.pendingSync,
    })
  }
  for (const { key, value } of await kvEntries<SubjectPack>(`u:${uid}:pack:`)) {
    const bytes = new TextEncoder().encode(JSON.stringify(value)).length
    out.push({
      key, type: 'pack', id: value.subject.id, subjectId: value.subject.id, subjectName: value.subject.name,
      title: `${value.subject.name}: question bank and chapter data`, bytes, savedAt: value.savedAt, pendingSync: false,
    })
  }
  return out.sort((a, b) => b.savedAt - a.savedAt)
}

export async function deleteItem(item: DownloadItem): Promise<void> {
  await kvDel(item.key)
}

export async function deleteSubjectDownloads(uid: string, subjectId: string): Promise<void> {
  for (const key of await kvKeys(keys.papers(uid))) {
    const v = await kvGet<PaperEntry>(key)
    if (v && v.subjectId === subjectId && !v.pendingSync) await kvDel(key)
  }
  await kvDel(keys.pack(uid, subjectId))
}

export async function deleteAllDownloads(uid: string): Promise<void> {
  await purgeUser(uid)
}

// Pack lookup for screens
export { loadPack }
