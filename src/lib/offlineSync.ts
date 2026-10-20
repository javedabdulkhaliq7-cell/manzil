// Uploads whatever was made offline, keeps saved copies up to date, and removes an account's
// saved copies when that account leaves the device (Phase 11).
import { supabase } from './supabase'
import { kvEntries, kvGet, kvKeys, kvSet, keys, purgeUser } from './offlineStore'
import { recordOnlineCheck } from './offlineValidity'
import { flushAttemptQueue } from './attemptQueue'
import { PaperEntry, savePaperLocally } from './paperSource'
import { cacheLogos } from './logoStore'
import { downloadPaper } from './downloadManager'
import { fetchSubjectPack, savePack, refreshUsedLog, getUsedLogLocal, setUsedLogLocal, SubjectPack } from './subjectPack'

const PACK_REFRESH_MS = 24 * 60 * 60 * 1000

export type SyncSummary = { generated: number; attempts: number; updated: number }

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

let running = false

// Order matters: generated papers first, then the "already given" list, then attempts.
export async function syncAll(uid: string): Promise<SyncSummary> {
  const summary: SyncSummary = { generated: 0, attempts: 0, updated: 0 }
  if (!isOnline() || running) return summary
  running = true
  try {
    // 1. generated papers made offline
    for (const { key, value } of await kvEntries<PaperEntry>(keys.papers(uid))) {
      if (value.kind !== 'generated' || !value.pendingSync || !value.gen) continue
      try {
        const res = await supabase.from('generated_papers').upsert({
          id: value.data.paper.id, subject_id: value.subjectId, scope: value.gen.scope,
          chapter_ids: value.gen.chapter_ids, paper: value.gen.snapshot,
        }, { onConflict: 'id' })
        if (res.error) throw res.error
        await kvSet(key, { ...value, pendingSync: false })
        summary.generated += 1
      } catch { /* try again next time */ }
    }

    // 2. the "already given" list
    for (const key of await kvKeys(`u:${uid}:usedlog:`)) {
      const subjectId = key.slice(`u:${uid}:usedlog:`.length)
      const log = await getUsedLogLocal(uid, subjectId)
      if (log.pending.length === 0) continue
      try {
        const res = await supabase.from('used_questions_log').upsert(
          log.pending.map(r => ({ user_id: uid, scope: 'subject', scope_id: subjectId, source_table: r.source_table, section_type: '', question_id: r.question_id })),
          { onConflict: 'user_id,scope,scope_id,source_table,section_type,question_id', ignoreDuplicates: true })
        if (res.error) throw res.error
        await setUsedLogLocal(uid, subjectId, { ...log, pending: [] })
      } catch { /* try again next time */ }
    }

    // 3. finished attempts
    summary.attempts = await flushAttemptQueue(uid)

    // 4. renew the one-year check, then bring saved papers up to date
    await recordOnlineCheck(uid)
    summary.updated = await refreshDownloads(uid)
  } finally {
    running = false
  }
  return summary
}

// Replace saved copies whose version on the server has changed, and refresh old subject packs.
export async function refreshDownloads(uid: string): Promise<number> {
  let updated = 0
  const saved = (await kvEntries<PaperEntry>(keys.papers(uid))).filter(e => e.value.kind === 'past')
  const ids = saved.map(e => e.value.data.paper.id)
  if (ids.length > 0) {
    const res = await supabase.from('past_papers').select('id, version, status').in('id', ids)
    if (!res.error) {
      type ServerRow = { id: string; version: number | null; status: string }
      const server = new Map<string, ServerRow>()
      for (const r of (res.data ?? []) as ServerRow[]) server.set(r.id, r)
      for (const e of saved) {
        const s = server.get(e.value.data.paper.id)
        if (s && s.status === 'published' && s.version !== e.value.version) {
          if ((await downloadPaper(uid, 'past', e.value.data.paper.id)) === 'ok') updated += 1
        }
      }
    }
  }
  for (const { value } of await kvEntries<SubjectPack>(`u:${uid}:pack:`)) {
    if (Date.now() - value.savedAt < PACK_REFRESH_MS) continue
    try {
      const pack = await fetchSubjectPack(value.subject.id)
      if (await savePack(uid, pack)) {
        await refreshUsedLog(uid, pack.subject.id, pack.chapters.map(c => c.id))
        updated += 1
      }
    } catch { /* keep the old pack */ }
  }
  return updated
}

// Start syncing when the user is signed in, and again whenever the phone comes back online.
export function startOfflineSync(uid: string): () => void {
  // Ask the phone not to clear the saved papers when it is short of space.
  try { void navigator.storage?.persist?.() } catch { /* not supported: fine */ }
  const run = () => { void syncAll(uid); void cacheLogos() }
  run()
  window.addEventListener('online', run)
  return () => window.removeEventListener('online', run)
}

// Saved copies belong to one account. When the account signs out or another one signs in,
// the previous account's copies are removed (anything not yet uploaded is kept for that account).
export function installAccountGuard(): () => void {
  const { data } = supabase.auth.onAuthStateChange((event: string, session: { user?: { id?: string } } | null) => {
    void (async () => {
      const last = await kvGet<string>(keys.lastUser)
      if (event === 'SIGNED_OUT') {
        if (last) await purgeUser(last)
        await kvSet(keys.lastUser, '')
        return
      }
      const uid = session?.user?.id
      if (!uid) return
      if (last && last !== uid) await purgeUser(last)
      if (last !== uid) await kvSet(keys.lastUser, uid)
    })()
  })
  return () => data.subscription.unsubscribe()
}

export { savePaperLocally }
