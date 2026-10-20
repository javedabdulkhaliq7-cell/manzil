// Data for the paper generator (Phase 9), online or from the subject pack saved on the phone,
// and saving a generated paper to the server, or to the phone when there is no internet.
import { supabase } from './supabase'
import { newId } from './attemptQueue'
import type { GenerateResult } from './paperGenerator'
import { savePaperLocally, PaperBundle, SourceQuestion } from './paperSource'
import { validityStatus } from './offlineValidity'
import {
  fetchSubjectPack, fetchUsedEntries, loadPack, savePack, getUsedLogLocal, setUsedLogLocal,
  SubjectPack,
} from './subjectPack'

export class OfflineDataError extends Error {
  code: 'no-data' | 'reconnect'
  constructor(code: 'no-data' | 'reconnect') {
    super(code)
    this.name = 'OfflineDataError'
    this.code = code
  }
}

export type GeneratorData = { pack: SubjectPack; used: Record<string, number>; fromLocal: boolean }

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

export async function loadGeneratorData(uid: string, subjectId: string): Promise<GeneratorData> {
  if (isOnline()) {
    try {
      const pack = await fetchSubjectPack(subjectId)
      const server = await fetchUsedEntries(subjectId, pack.chapters.map(c => c.id))
      const local = await getUsedLogLocal(uid, subjectId)
      const used = { ...server }
      for (const [k, ms] of Object.entries(local.entries)) if (used[k] === undefined || ms > used[k]) used[k] = ms
      if (await loadPack(uid, subjectId)) void savePack(uid, pack) // keep a saved pack fresh
      return { pack, used, fromLocal: false }
    } catch { /* could not reach the server: use the saved pack */ }
  }
  const pack = await loadPack(uid, subjectId)
  if (!pack) throw new OfflineDataError('no-data')
  const v = await validityStatus(uid)
  if (v.status !== 'valid') throw new OfflineDataError('reconnect')
  const log = await getUsedLogLocal(uid, subjectId)
  return { pack, used: log.entries, fromLocal: true }
}

export type SaveOutcome = { id: string; where: 'server' | 'device' }

export async function saveGeneratedPaper(
  uid: string, pack: SubjectPack, scope: 'full' | 'chapters', pickedChapterIds: string[], result: GenerateResult,
): Promise<SaveOutcome> {
  const id = newId()
  const snap = result.paper
  const subjectId = pack.subject.id
  const chapterIds = scope === 'chapters' ? pickedChapterIds : null
  const bundle: PaperBundle = {
    paper: {
      id, subject_id: subjectId, title: snap.header.title, year: snap.header.year, board: snap.header.board,
      exam_title: snap.header.exam_title, group_label: null, paper_note: snap.header.paper_note,
      total_marks: snap.header.total_marks, passing_marks: null, time_minutes: snap.header.time_minutes,
      is_model_paper: false, pattern: snap.header.pattern, is_generated: true,
    },
    sections: snap.sections,
    questions: snap.questions as unknown as SourceQuestion[],
    groups: {},
    subject: { name: pack.subject.name, class_level: pack.subject.class_level },
    chapters: pack.chapters.filter(c => result.chapterIds.includes(c.id)),
    version: null,
  }

  const rows = result.picks.map(p => ({ source_table: p.table as string, question_id: p.id }))
  const now = Date.now()
  const log = await getUsedLogLocal(uid, subjectId)
  for (const r of rows) log.entries[`${r.source_table}:${r.question_id}`] = now

  if (isOnline()) {
    try {
      const saved = await supabase.from('generated_papers').upsert(
        { id, subject_id: subjectId, scope, chapter_ids: chapterIds, paper: snap }, { onConflict: 'id' })
      if (saved.error) throw saved.error
      let logged = true
      try {
        const res = await supabase.from('used_questions_log').upsert(
          rows.map(r => ({ user_id: uid, scope: 'subject', scope_id: subjectId, source_table: r.source_table, section_type: '', question_id: r.question_id })),
          { onConflict: 'user_id,scope,scope_id,source_table,section_type,question_id', ignoreDuplicates: true })
        if (res.error) logged = false
      } catch { logged = false }
      if (!logged) log.pending.push(...rows)
      await setUsedLogLocal(uid, subjectId, log)
      return { id, where: 'server' }
    } catch { /* connection dropped: keep it on the phone and upload later */ }
  }

  const local = await savePaperLocally(uid, 'generated', bundle, {
    pendingSync: true, gen: { scope, chapter_ids: chapterIds, snapshot: snap },
  })
  if (!local) throw new Error('Could not save the paper on this phone')
  log.pending.push(...rows)
  await setUsedLogLocal(uid, subjectId, log)
  return { id, where: 'device' }
}
