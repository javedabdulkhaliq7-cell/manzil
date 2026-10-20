// Everything one subject needs to work offline (besides the papers themselves):
// chapters, chapter importance, the answer-ready question bank the generator draws from,
// repeat counts, and the paper blueprint. Fetched from the server, saved on the phone.
import { supabase } from './supabase'
import { fetchAll } from './fetchAll'
import { kvGet, kvSet, keys } from './offlineStore'
import type { Blueprint, BankMcq, BankWritten, BankWriting } from './paperGenerator'

export type ListPaper = {
  id: string
  subject_id: string
  title: string
  year: number
  board: string
  is_free: boolean
  is_predicted: boolean
  mcq_count: number
  time_minutes: number | null
  total_marks: number | null
  is_model_paper: boolean
  status: string
  version?: number | null
}

export type PackChapter = { id: string; number: number; title: string }
export type PackImportance = { chapter_id: string; chapter_number: number; title: string; percentage: number; rank: number }

export type SubjectPack = {
  savedAt: number
  subject: { id: string; name: string; emoji?: string | null; class_level: string }
  papers: ListPaper[]
  chapters: PackChapter[]
  importance: PackImportance[]
  mcqs: BankMcq[]
  shorts: BankWritten[]
  longs: BankWritten[]
  writing?: BankWriting[] // letters, applications and essays for full papers (older saved copies do not have it)
  repeatCounts: Record<string, number>
  blueprint: Blueprint | null
}

// Questions already given to this student: "table:id" -> when (ms). `pending` = not yet uploaded.
export type UsedLogLocal = {
  entries: Record<string, number>
  pending: { source_table: string; question_id: string }[]
  cachedAt: number
}

type Abortable<T> = { abortSignal?: (s: AbortSignal) => T }
function withSignal<T>(q: T, signal?: AbortSignal): T {
  const a = q as unknown as Abortable<T>
  return signal && a.abortSignal ? a.abortSignal(signal) : q
}

export async function fetchSubjectPack(subjectId: string, signal?: AbortSignal): Promise<SubjectPack> {
  const subjRes = await withSignal(supabase.from('subjects').select('id, name, emoji, class_level').eq('id', subjectId).maybeSingle(), signal)
  if (subjRes.error || !subjRes.data) throw subjRes.error ?? new Error('subject not found')

  const [papersRes, chRes, impRes, bpRes, repRes, writingRes, mcqs, shorts, longs] = await Promise.all([
    withSignal(supabase.from('past_papers').select('*').eq('subject_id', subjectId).eq('status', 'published'), signal),
    withSignal(supabase.from('chapters').select('id, number, title').eq('subject_id', subjectId).order('number', { ascending: true }), signal),
    withSignal(supabase.from('chapter_importance_ranked').select('chapter_id, chapter_number, title, percentage, rank').eq('subject_id', subjectId).order('rank', { ascending: true }), signal),
    withSignal(supabase.from('paper_templates').select('structure').eq('subject_id', subjectId).order('created_at', { ascending: false }).limit(1), signal),
    supabase.rpc('bank_repeat_counts', { p_subject_id: subjectId }),
    supabase.rpc('writing_pool', { p_subject_id: subjectId }),
    fetchAll<BankMcq>((f, t) => withSignal(supabase
      .from('answer_ready_mcqs')
      .select('id, chapter_id, question, option_a, option_b, option_c, option_d, correct_option, image_url, diagram_type')
      .eq('subject_id', subjectId).range(f, t), signal)),
    fetchAll<BankWritten>((f, t) => withSignal(supabase
      .from('answer_ready_short_questions')
      .select('id, chapter_id, question, answer, rubric, marks, image_url, diagram_type')
      .eq('subject_id', subjectId).range(f, t), signal)),
    fetchAll<BankWritten>((f, t) => withSignal(supabase
      .from('answer_ready_long_questions')
      .select('id, chapter_id, question, answer, rubric, marks, image_url, diagram_type')
      .eq('subject_id', subjectId).range(f, t), signal)),
  ])
  for (const r of [papersRes, chRes, impRes, bpRes, repRes]) if (r.error) throw r.error

  const repeatCounts: Record<string, number> = {}
  for (const r of (repRes.data ?? []) as { bank_table: string; bank_question_id: string; repeat_count: number }[]) {
    repeatCounts[`${r.bank_table}:${r.bank_question_id}`] = r.repeat_count
  }
  // Letters, applications and essays. If this is not set up on the server yet, papers are built without them.
  const writing = writingRes.error ? [] : ((writingRes.data ?? []) as BankWriting[])
  const structure = bpRes.data && bpRes.data[0] ? (bpRes.data[0].structure as Blueprint) : null
  return {
    savedAt: Date.now(),
    subject: subjRes.data as SubjectPack['subject'],
    papers: (papersRes.data ?? []) as ListPaper[],
    chapters: (chRes.data ?? []) as PackChapter[],
    importance: (impRes.data ?? []) as PackImportance[],
    mcqs, shorts, longs, writing, repeatCounts,
    blueprint: structure && Array.isArray(structure.sections) ? structure : null,
  }
}

// Questions this student was already given (paper generator and mock tests share one list).
export async function fetchUsedEntries(subjectId: string, chapterIds: string[], signal?: AbortSignal): Promise<Record<string, number>> {
  const rows = await fetchAll<{ source_table: string; question_id: string; created_at: string }>((f, t) => withSignal(supabase
    .from('used_questions_log')
    .select('source_table, question_id, created_at')
    .in('scope_id', [subjectId, ...chapterIds])
    .in('source_table', ['mcqs', 'short_questions', 'long_questions'])
    .range(f, t), signal))
  const used: Record<string, number> = {}
  for (const r of rows) {
    const key = `${r.source_table}:${r.question_id}`
    const ms = new Date(r.created_at).getTime()
    if (used[key] === undefined || ms > used[key]) used[key] = ms
  }
  return used
}

export async function loadPack(uid: string, subjectId: string): Promise<SubjectPack | undefined> {
  return kvGet<SubjectPack>(keys.pack(uid, subjectId))
}

export async function savePack(uid: string, pack: SubjectPack): Promise<boolean> {
  return kvSet(keys.pack(uid, pack.subject.id), pack)
}

export async function getUsedLogLocal(uid: string, subjectId: string): Promise<UsedLogLocal> {
  return (await kvGet<UsedLogLocal>(keys.usedLog(uid, subjectId))) ?? { entries: {}, pending: [], cachedAt: 0 }
}

export async function setUsedLogLocal(uid: string, subjectId: string, v: UsedLogLocal): Promise<void> {
  await kvSet(keys.usedLog(uid, subjectId), v)
}

// Refresh the cached "already given" list from the server, keeping anything not uploaded yet.
export async function refreshUsedLog(uid: string, subjectId: string, chapterIds: string[], signal?: AbortSignal): Promise<UsedLogLocal> {
  const server = await fetchUsedEntries(subjectId, chapterIds, signal)
  const local = await getUsedLogLocal(uid, subjectId)
  const entries = { ...server }
  for (const [k, ms] of Object.entries(local.entries)) {
    if (entries[k] === undefined || ms > entries[k]) entries[k] = ms
  }
  const next: UsedLogLocal = { entries, pending: local.pending, cachedAt: Date.now() }
  await setUsedLogLocal(uid, subjectId, next)
  return next
}
