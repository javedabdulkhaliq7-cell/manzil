// One place that loads a paper for the viewer and the exam, whether it is a real board
// past paper or a saved generated paper, online or from a copy saved on the phone.
import { supabase } from './supabase'
import { kvGet, kvSet, jsonBytes, keys, getUserId } from './offlineStore'
import { validityStatus } from './offlineValidity'

export type PaperKind = 'past' | 'generated'

export function kindFromPath(pathname: string): PaperKind {
  return pathname.startsWith('/generated-papers') ? 'generated' : 'past'
}

export function paperBase(kind: PaperKind): string {
  return kind === 'generated' ? '/generated-papers' : '/past-papers'
}

export type SourcePaper = {
  id: string
  subject_id: string
  title: string
  year: number
  board: string
  exam_title: string | null
  group_label: string | null
  paper_note: string | null
  total_marks: number | null
  passing_marks: number | null
  time_minutes: number | null
  is_model_paper: boolean
  pattern: string | null
  is_generated: boolean
}

export type SourceSection = {
  id: string
  part_name: string
  position: number
  instruction: string | null
  attempt_count: number | null
  choose_from: number | null
}

export type SourceQuestion = {
  id: string
  section_id: string | null
  part_name: string | null
  section_type: string
  question_number: number
  sub_part: string | null
  question: string
  options: string[] | null
  answer: string | null
  marks: number | null
  or_pair_key: string | null
  is_alternate: boolean | null
  rubric: unknown
  group_id: string | null
  chapter_id: string | null
}

export type SourceGroup = { id: string; repeat_count: number; years: number[] | null }
export type SourceSubject = { name: string; class_level: string }
export type SourceChapter = { id: string; number: number; title: string }

export type PaperBundle = {
  paper: SourcePaper
  sections: SourceSection[]
  questions: SourceQuestion[]
  groups: Record<string, SourceGroup>
  subject: SourceSubject | null
  chapters: SourceChapter[]
  version: number | null // past papers only: the server's version when this copy was made
}

export type LoadResult =
  | { status: 'ok'; bundle: PaperBundle; fromLocal: boolean }
  | { status: 'notfound' }
  | { status: 'error' }
  | { status: 'reconnect' } // the saved copy needs one online check (a year has passed, or the phone clock moved back)

// What is stored on the phone for one paper.
export type PaperEntry = {
  kind: PaperKind
  title: string
  subjectId: string
  savedAt: number
  bytes: number
  version: number | null
  pendingSync?: boolean // generated offline and not uploaded yet
  gen?: { scope: 'full' | 'chapters'; chapter_ids: string[] | null; snapshot: unknown } // what to upload
  data: PaperBundle
}

type Snapshot = {
  header: {
    title: string; exam_title: string; board: string; total_marks: number
    time_minutes: number; pattern: string; paper_note: string; year: number
  }
  sections: SourceSection[]
  questions: SourceQuestion[]
}

async function subjectAndChapters(subjectId: string, questions: SourceQuestion[]) {
  const subjRes = await supabase.from('subjects').select('name, class_level').eq('id', subjectId).maybeSingle()
  if (subjRes.error) throw subjRes.error
  const chapterIds = Array.from(new Set(questions.map(q => q.chapter_id).filter((c): c is string => !!c)))
  let chapters: SourceChapter[] = []
  if (chapterIds.length > 0) {
    const cRes = await supabase.from('chapters').select('id, number, title').in('id', chapterIds)
    if (cRes.error) throw cRes.error
    chapters = (cRes.data ?? []) as SourceChapter[]
  }
  return { subject: (subjRes.data as SourceSubject | null) ?? null, chapters }
}

type NetResult = { status: 'ok'; bundle: PaperBundle } | { status: 'notfound' } | { status: 'error'; reason?: string }

async function loadGenerated(id: string): Promise<NetResult> {
  const res = await supabase.from('generated_papers').select('id, subject_id, paper').eq('id', id).maybeSingle()
  if (res.error) return { status: 'error', reason: res.error.message }
  if (!res.data) return { status: 'notfound' }
  const snap = res.data.paper as Snapshot
  if (!snap || !snap.header || !Array.isArray(snap.sections) || !Array.isArray(snap.questions)) return { status: 'error' }
  const extra = await subjectAndChapters(res.data.subject_id, snap.questions)
  return {
    status: 'ok',
    bundle: {
      paper: {
        id: res.data.id, subject_id: res.data.subject_id, title: snap.header.title, year: snap.header.year,
        board: snap.header.board, exam_title: snap.header.exam_title, group_label: null, paper_note: snap.header.paper_note,
        total_marks: snap.header.total_marks, passing_marks: null, time_minutes: snap.header.time_minutes,
        is_model_paper: false, pattern: snap.header.pattern, is_generated: true,
      },
      sections: snap.sections,
      questions: snap.questions,
      groups: {},
      subject: extra.subject,
      chapters: extra.chapters,
      version: null,
    },
  }
}

async function loadPast(id: string): Promise<NetResult> {
  const paperRes = await supabase.from('past_papers').select('*').eq('id', id).maybeSingle()
  if (paperRes.error) return { status: 'error', reason: paperRes.error.message }
  if (!paperRes.data) return { status: 'notfound' }
  const raw = paperRes.data as Omit<SourcePaper, 'is_generated'> & { version?: number | null }
  const p = { ...raw, is_generated: false } as SourcePaper

  const [secRes, qRes] = await Promise.all([
    supabase
      .from('past_paper_sections')
      .select('id, part_name, position, instruction, attempt_count, choose_from')
      .eq('past_paper_id', p.id)
      .order('position', { ascending: true }),
    // Only the columns the screens need. Internal review notes are not requested.
    supabase
      .from('past_paper_questions')
      .select('id, section_id, part_name, section_type, question_number, sub_part, question, options, answer, marks, or_pair_key, is_alternate, rubric, group_id, chapter_id')
      .eq('past_paper_id', p.id),
  ])
  if (secRes.error || qRes.error) return { status: 'error', reason: (secRes.error ?? qRes.error)?.message }
  const questions = (qRes.data ?? []) as SourceQuestion[]

  // Repeat tags: fetch the groups these questions belong to
  const groupIds = Array.from(new Set(questions.map(q => q.group_id).filter((g): g is string => !!g)))
  const groups: Record<string, SourceGroup> = {}
  if (groupIds.length > 0) {
    const gRes = await supabase.from('question_groups').select('id, repeat_count, years').in('id', groupIds)
    if (gRes.error) return { status: 'error' }
    for (const g of (gRes.data ?? []) as SourceGroup[]) groups[g.id] = g
  }
  const extra = await subjectAndChapters(p.subject_id, questions)
  return {
    status: 'ok',
    bundle: {
      paper: p, sections: (secRes.data ?? []) as SourceSection[], questions, groups,
      subject: extra.subject, chapters: extra.chapters, version: raw.version ?? null,
    },
  }
}

// Straight from the server. Used for downloading.
export async function loadPaperFromNetwork(kind: PaperKind, id: string): Promise<NetResult> {
  try {
    return kind === 'generated' ? await loadGenerated(id) : await loadPast(id)
  } catch (e) {
    return { status: 'error', reason: e instanceof Error ? e.message : String(e) }
  }
}

// Write a copy of a paper into the phone's private storage.
export async function savePaperLocally(
  uid: string, kind: PaperKind, bundle: PaperBundle,
  opts: { pendingSync?: boolean; gen?: PaperEntry['gen'] } = {},
): Promise<PaperEntry | null> {
  const entry: PaperEntry = {
    kind, title: bundle.paper.title, subjectId: bundle.paper.subject_id, savedAt: Date.now(),
    bytes: jsonBytes(bundle), version: bundle.version, pendingSync: opts.pendingSync, gen: opts.gen, data: bundle,
  }
  const ok = await kvSet(keys.paper(uid, kind, bundle.paper.id), entry)
  return ok ? entry : null
}

// Online: always the server's copy, and a saved copy that is out of date is replaced quietly.
// Offline (or the server cannot be reached): the saved copy, if the one-year check allows it.
export async function loadPaperBundle(kind: PaperKind, id: string): Promise<LoadResult> {
  const uid = await getUserId()
  const online = typeof navigator === 'undefined' || navigator.onLine !== false

  if (online) {
    const net = await loadPaperFromNetwork(kind, id)
    if (net.status === 'ok') {
      if (uid && kind === 'past') {
        const local = await kvGet<PaperEntry>(keys.paper(uid, kind, id))
        if (local && local.version !== net.bundle.version) void savePaperLocally(uid, kind, net.bundle)
      }
      return { status: 'ok', bundle: net.bundle, fromLocal: false }
    }
    if (net.status === 'notfound') {
      // A paper made offline may not have reached the server yet.
      if (kind === 'generated' && uid) {
        const local = await kvGet<PaperEntry>(keys.paper(uid, kind, id))
        if (local && local.pendingSync) return { status: 'ok', bundle: local.data, fromLocal: true }
      }
      return { status: 'notfound' }
    }
    // network error: fall through to the saved copy
  }

  if (!uid) return { status: 'error' }
  const local = await kvGet<PaperEntry>(keys.paper(uid, kind, id))
  if (!local) return { status: 'error' }
  const v = await validityStatus(uid)
  if (v.status !== 'valid') return { status: 'reconnect' }
  return { status: 'ok', bundle: local.data, fromLocal: true }
}
