// Class 11/12 Notes — data access for the Notes tab (S4).
//
// Everything the student's phone needs from the server for the stepwise notes:
//   * the checkpoint functions (progress / start / resume / submit) — the server is the
//     only place that knows the answers and decides what is correct;
//   * the per-chapter content tables (definitions, misconceptions, comparisons, figures);
//   * the student's reading position, topic bookmarks, and the "notes read" flag.
//
// Functions that call the server throw an Error on a network/database failure so the
// screen can show "Couldn't reach the server — try again" and keep what the student typed.
import { supabase } from './supabase'

/* ------------------------------------------------------------------ checkpoints */

export type TopicProgress = { passed: string[]; unlocked: string[] }
export type CheckpointQuestion = { id: string; question: string; blanks: number[] }

export type StartResult =
  | { status: 'started' | 'resumed'; attempt_id: string; total: number; index: number; question: CheckpointQuestion }
  | { status: 'locked' | 'already_passed' | 'no_questions' | 'unknown_topic' | 'none' | 'no_pack' }

export type SubmitResult =
  | { status: 'continue'; correct: true; index: number; total: number; question: CheckpointQuestion }
  | { status: 'passed'; correct: true; topic_key: string; points?: number; pending?: boolean }
  | { status: 'wrong'; correct: false; index: number; total: number; tries: number; explanation: string | null }
  | { status: 'wrong_question' | 'attempt_closed' | 'invalid_attempt' | 'invalid_answer' }

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const getTopicProgress = (chapterId: string) =>
  rpc<TopicProgress>('get_topic_progress', { p_chapter_id: chapterId })

export const startAttempt = (chapterId: string, topicKey: string) =>
  rpc<StartResult>('start_checkpoint_attempt', { p_chapter_id: chapterId, p_topic_key: topicKey })

export const resumeAttempt = (chapterId: string, topicKey: string) =>
  rpc<StartResult>('resume_checkpoint_attempt', { p_chapter_id: chapterId, p_topic_key: topicKey })

export const submitAnswer = (attemptId: string, questionId: string, answer: string) =>
  rpc<SubmitResult>('submit_checkpoint_answer', {
    p_attempt_id: attemptId,
    p_question_id: questionId,
    p_answer: answer,
  })

/** What the question panel talks to: the server when online, the downloaded pack when offline
 *  (see seniorOffline.ts). Both give identical answers in identical shapes. */
export type CheckpointEngine = {
  start: (topicKey: string) => Promise<StartResult>
  submit: (attemptId: string, questionId: string, typed: string) => Promise<SubmitResult>
}

export const makeServerEngine = (chapterId: string): CheckpointEngine => ({
  start: (topicKey) => startAttempt(chapterId, topicKey),
  submit: submitAnswer,
})

/* --------------------------------------------------------------- chapter content */

/** A block of chapters.detailed_notes. Legacy types: bullets, table, diagram, timeline, image_needed.
 *  New types: paragraph {text}, key_fact {text}, figure {figure_id}. Every block may carry topic_key. */
export type SeniorNoteBlock = { type: string; title?: string; topic_key?: string; [k: string]: any }

export type DefinitionRow = { id: string; sub_unit: string | null; term: string; definition: string; clarification: string | null }
export type MisconceptionRow = { id: string; sub_unit: string | null; misconception: string; correction: string; why: string | null }
export type DifferentiationRow = { id: string; sub_unit: string | null; title: string | null; question: string; entities: string[]; points: unknown }
export type FigureRow = {
  id: string
  sub_unit: string | null
  figure_no: string | null
  caption: string | null
  notice: string | null
  image_url: string | null
  diagram_type: string | null
  diagram_data: any
}

export type ChapterExtras = {
  definitions: DefinitionRow[]
  misconceptions: MisconceptionRow[]
  differentiations: DifferentiationRow[]
  figures: FigureRow[]
}

export const EMPTY_EXTRAS: ChapterExtras = { definitions: [], misconceptions: [], differentiations: [], figures: [] }

/** One load per chapter (four small read-only tables). A failure of any of them just means "none". */
export async function loadChapterExtras(chapterId: string): Promise<ChapterExtras> {
  const [d, m, f, g] = await Promise.all([
    supabase.from('definitions').select('id, sub_unit, term, definition, clarification').eq('chapter_id', chapterId).order('created_at'),
    supabase.from('misconceptions').select('id, sub_unit, misconception, correction, why').eq('chapter_id', chapterId).order('created_at'),
    supabase.from('differentiations').select('id, sub_unit, title, question, entities, points').eq('chapter_id', chapterId).order('created_at'),
    supabase.from('figures').select('id, sub_unit, figure_no, caption, notice, image_url, diagram_type, diagram_data').eq('chapter_id', chapterId).order('created_at'),
  ])
  return {
    definitions: (d.data as DefinitionRow[] | null) ?? [],
    misconceptions: (m.data as MisconceptionRow[] | null) ?? [],
    differentiations: (f.data as DifferentiationRow[] | null) ?? [],
    figures: (g.data as FigureRow[] | null) ?? [],
  }
}

/* --------------------------------------------- reading position, bookmarks, completion */

export async function loadNotesPosition(userId: string, chapterId: string): Promise<string | null> {
  const { data } = await supabase
    .from('notes_progress')
    .select('last_topic_key')
    .eq('user_id', userId)
    .eq('chapter_id', chapterId)
    .maybeSingle()
  return (data as { last_topic_key: string | null } | null)?.last_topic_key ?? null
}

export async function saveNotesPosition(userId: string, chapterId: string, topicKey: string): Promise<void> {
  await supabase.from('notes_progress').upsert(
    { user_id: userId, chapter_id: chapterId, last_topic_key: topicKey, last_block_index: 0, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,chapter_id' },
  )
}

/** Sets user_progress.notes_read (the existing field) once every topic has been passed. */
export async function markNotesRead(userId: string, chapterId: string, subjectId: string): Promise<void> {
  await supabase.from('user_progress').upsert(
    { user_id: userId, chapter_id: chapterId, subject_id: subjectId, notes_read: true, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,chapter_id' },
  )
}

// Topic keys such as "1.1" repeat in every chapter, so a bookmark's object_key is "<chapter id>:<topic key>".
const bookmarkKey = (chapterId: string, topicKey: string) => `${chapterId}:${topicKey}`

export async function loadTopicBookmarks(userId: string, chapterId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('bookmarks')
    .select('object_key')
    .eq('user_id', userId)
    .eq('chapter_id', chapterId)
    .eq('object_type', 'note_topic')
  const prefix = `${chapterId}:`
  const keys = ((data as { object_key: string | null }[] | null) ?? [])
    .map((r) => r.object_key ?? '')
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
  return new Set(keys)
}

export async function setTopicBookmark(userId: string, chapterId: string, topicKey: string, on: boolean): Promise<void> {
  const object_key = bookmarkKey(chapterId, topicKey)
  if (on) {
    const { error } = await supabase
      .from('bookmarks')
      .insert({ user_id: userId, chapter_id: chapterId, object_type: 'note_topic', object_key })
    if (error && error.code !== '23505') throw new Error(error.message) // 23505 = already bookmarked
  } else {
    await supabase.from('bookmarks').delete().eq('user_id', userId).eq('object_type', 'note_topic').eq('object_key', object_key)
  }
}
