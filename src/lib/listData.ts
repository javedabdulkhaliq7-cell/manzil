// Data for the Past Papers list screen: from the server when online, from the copies saved on
// the phone when not. No error screen just because the connection is gone.
import { supabase } from './supabase'
import type { Subject } from './supabase'
import { kvEntries, kvGet, kvSet, keys, getUserId } from './offlineStore'
import { validityStatus } from './offlineValidity'
import { loadPack, ListPaper, PackImportance } from './subjectPack'
import type { PaperEntry } from './paperSource'

export type MyGenerated = {
  id: string
  created_at: string
  scope: 'full' | 'chapters' | null
  chapter_ids: string[] | null
}

export type ListData = {
  papers: ListPaper[]
  importance: PackImportance[]
  my: MyGenerated[]
  source: 'server' | 'device'
  // 'ok' normal. 'not-downloaded': offline and this subject was never downloaded.
  // 'reconnect': saved copies need one online check. 'error': could not load papers.
  status: 'ok' | 'not-downloaded' | 'reconnect' | 'error'
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

export async function loadSubjects(classLevel: string): Promise<Subject[]> {
  const uid = await getUserId()
  if (isOnline()) {
    const { data, error } = await supabase.from('subjects').select('*').eq('class_level', classLevel).order('name')
    if (!error && data) {
      if (uid) void kvSet(keys.subjects(uid, classLevel), data)
      return data as Subject[]
    }
  }
  if (!uid) return []
  return (await kvGet<Subject[]>(keys.subjects(uid, classLevel))) ?? []
}

async function localGenerated(uid: string, subjectId: string): Promise<MyGenerated[]> {
  const out: MyGenerated[] = []
  for (const { value } of await kvEntries<PaperEntry>(keys.papers(uid))) {
    if (value.kind !== 'generated' || value.subjectId !== subjectId) continue
    out.push({
      id: value.data.paper.id,
      created_at: new Date(value.savedAt).toISOString(),
      scope: value.gen?.scope ?? null,
      chapter_ids: value.gen?.chapter_ids ?? null,
    })
  }
  return out
}

function byNewest(a: MyGenerated, b: MyGenerated): number {
  return a.created_at < b.created_at ? 1 : -1
}

export async function loadListData(subjectId: string): Promise<ListData> {
  const uid = await getUserId()
  const local = uid ? await localGenerated(uid, subjectId) : []

  if (isOnline()) {
    try {
      const [papersRes, impRes, myRes] = await Promise.all([
        supabase.from('past_papers').select('*').eq('subject_id', subjectId).eq('status', 'published')
          .order('is_model_paper', { ascending: false }).order('year', { ascending: false }),
        supabase.from('chapter_importance_ranked').select('chapter_id, chapter_number, title, percentage, rank')
          .eq('subject_id', subjectId).order('rank', { ascending: true }),
        supabase.from('generated_papers').select('id, created_at, scope, chapter_ids')
          .eq('subject_id', subjectId).order('created_at', { ascending: false }).limit(20),
      ])
      if (!papersRes.error) {
        const server = (myRes.error ? [] : (myRes.data ?? [])) as MyGenerated[]
        const known = new Set(server.map(s => s.id))
        // papers made offline that have not reached the server yet
        const pending = local.filter(l => !known.has(l.id) && !server.some(s => s.id === l.id))
        const importance = impRes.error ? [] : ((impRes.data ?? []) as PackImportance[]).filter(c => Number(c.percentage) > 0)
        return {
          papers: (papersRes.data ?? []) as ListPaper[],
          importance,
          my: [...pending, ...server].sort(byNewest),
          source: 'server',
          status: 'ok',
        }
      }
    } catch { /* fall through to the saved copy */ }
  }

  const my = local.sort(byNewest)
  if (!uid) return { papers: [], importance: [], my, source: 'device', status: isOnline() ? 'error' : 'not-downloaded' }
  const pack = await loadPack(uid, subjectId)
  if (!pack) return { papers: [], importance: [], my, source: 'device', status: isOnline() ? 'error' : 'not-downloaded' }
  const v = await validityStatus(uid)
  if (v.status !== 'valid') return { papers: [], importance: [], my, source: 'device', status: 'reconnect' }
  const papers = pack.papers.slice().sort((a, b) =>
    (a.is_model_paper === b.is_model_paper ? 0 : a.is_model_paper ? -1 : 1) || b.year - a.year)
  return {
    papers,
    importance: pack.importance.filter(c => Number(c.percentage) > 0),
    my,
    source: 'device',
    status: 'ok',
  }
}

// Which papers are saved on the phone (id -> version), for the "Saved" tags on the list.
export async function loadSavedVersions(): Promise<Record<string, number | null>> {
  const uid = await getUserId()
  if (!uid) return {}
  const out: Record<string, number | null> = {}
  for (const { value } of await kvEntries<PaperEntry>(keys.papers(uid))) {
    if (value.kind === 'past') out[value.data.paper.id] = value.version
  }
  return out
}
