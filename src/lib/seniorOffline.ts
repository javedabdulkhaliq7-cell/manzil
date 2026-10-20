// Class 11/12 notes — everything that happens WITHOUT internet (S5).
//
//  * A chapter downloaded while online carries its checkpoint pack (the questions with answers).
//    Offline, a student can still read the notes and answer the topic questions.
//  * The offline engine follows the SAME rules as the server (same shapes the screen already
//    understands): typed answers, one question at a time, a wrong answer stays on the same
//    question and keeps all progress, strict spelling (the shared matcher in answerMatch.ts).
//  * A passed topic is only PROVISIONAL: it is queued, and when the phone is back online the
//    server re-checks every answer (sync_offline_checkpoint_attempts). Accepted = a real pass.
//    Rejected = the topic returns to "current", with a friendly notice.
//  * Honest limits (plan section 6.4): someone holding the downloaded pack can read its answers.
import { supabase } from './supabase'
import {
  offlineDb,
  type CheckpointLocalState,
  type CheckpointNotice,
  type CheckpointOpenAttempt,
  type CheckpointPackQuestion,
  type CheckpointQueueEntry,
  type DownloadedChapter,
} from './offlineDb'
import { answerMatches } from './answerMatch'
import { isOffline } from './connectivity'
import type { CheckpointEngine, CheckpointQuestion, StartResult, SubmitResult, TopicProgress } from './seniorNotesApi'

/* ------------------------------------------------------------------ helpers */

const stateId = (userId: string, chapterId: string) => `${userId}:${chapterId}`

function newId(): string {
  const c: any = (globalThis as any).crypto
  if (c?.randomUUID) return c.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function shuffled<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const toQuestion = (q: CheckpointPackQuestion): CheckpointQuestion => ({ id: q.id, question: q.question, blanks: q.blanks })

export async function getDownloadedBundle(chapterId: string): Promise<DownloadedChapter | undefined> {
  return offlineDb.downloaded_chapters.get(chapterId)
}

async function loadState(userId: string, chapterId: string): Promise<CheckpointLocalState> {
  return (
    (await offlineDb.checkpoint_local.get(stateId(userId, chapterId))) ?? {
      id: stateId(userId, chapterId),
      userId,
      chapterId,
      open: {},
    }
  )
}

/* ------------------------------------------------------------------ progress */

/** Same unlock rule as the server's get_topic_progress, worked out from the downloaded data:
 *  the first topic is open; a topic with no questions never blocks; otherwise the previous topic
 *  must be passed. "Passed" = passed on the server when last online, plus provisional offline passes. */
export async function loadOfflineProgress(userId: string, chapterId: string): Promise<TopicProgress & { hasPack: boolean }> {
  const blob = await getDownloadedBundle(chapterId)
  const topics = [...((blob?.chapterMeta?.topics as { key: string; position: number }[] | undefined) ?? [])].sort(
    (a, b) => a.position - b.position,
  )
  const passed = new Set<string>(blob?.passedSnapshot ?? [])
  const queued = await offlineDb.checkpoint_queue.where('chapterId').equals(chapterId).toArray()
  queued.filter((q) => q.userId === userId).forEach((q) => passed.add(q.topicKey))

  const pack = blob?.checkpointPack ?? null
  const hasQuestions = (key: string) => (pack?.topics.find((t) => t.topic_key === key)?.questions.length ?? 0) > 0

  const unlocked: string[] = []
  topics.forEach((t, i) => {
    if (i === 0) return unlocked.push(t.key)
    const prev = topics[i - 1].key
    if (pack && !hasQuestions(prev)) return unlocked.push(t.key) // a topic with no questions never blocks
    if (passed.has(prev)) unlocked.push(t.key)
  })
  return { passed: [...passed].sort(), unlocked, hasPack: !!pack }
}

/** Keeps the downloaded copy's list of passed topics up to date whenever the server's answer is known. */
export async function refreshPassedSnapshot(chapterId: string, passedOnServer: string[]): Promise<void> {
  const blob = await offlineDb.downloaded_chapters.get(chapterId)
  if (!blob) return
  const merged = [...new Set([...(blob.passedSnapshot ?? []), ...passedOnServer])].sort()
  await offlineDb.downloaded_chapters.update(chapterId, { passedSnapshot: merged })
}

/* -------------------------------------------------------------------- engine */

/** The question panel's engine while offline. Mirrors the server's start/resume/submit. */
export function createOfflineEngine(userId: string, chapterId: string): CheckpointEngine {
  async function start(topicKey: string): Promise<StartResult> {
    const blob = await getDownloadedBundle(chapterId)
    const pack = blob?.checkpointPack
    if (!blob || !pack) return { status: 'no_pack' }

    const topics = (blob.chapterMeta?.topics as { key: string }[] | undefined) ?? []
    if (!topics.some((t) => t.key === topicKey)) return { status: 'unknown_topic' }

    const progress = await loadOfflineProgress(userId, chapterId)
    if (progress.passed.includes(topicKey)) return { status: 'already_passed' }
    if (!progress.unlocked.includes(topicKey)) return { status: 'locked' }

    const packTopic = pack.topics.find((t) => t.topic_key === topicKey)
    if (!packTopic || packTopic.questions.length === 0) return { status: 'no_questions' }

    const state = await loadState(userId, chapterId)
    const byId = new Map(packTopic.questions.map((q) => [q.id, q]))

    // An unfinished attempt is picked up exactly where it stopped
    const open = state.open[topicKey]
    if (open && open.questionIds.every((id) => byId.has(id))) {
      return {
        status: 'resumed',
        attempt_id: open.attemptId,
        total: open.questionIds.length,
        index: open.index,
        question: toQuestion(byId.get(open.questionIds[open.index])!),
      }
    }

    const size = Math.min(packTopic.size, packTopic.questions.length)
    const questionIds = shuffled(packTopic.questions).slice(0, size).map((q) => q.id)
    const fresh: CheckpointOpenAttempt = { attemptId: newId(), topicKey, questionIds, index: 0, typed: [], wrongTries: 0 }
    state.open[topicKey] = fresh
    await offlineDb.checkpoint_local.put(state)
    return {
      status: 'started',
      attempt_id: fresh.attemptId,
      total: size,
      index: 0,
      question: toQuestion(byId.get(questionIds[0])!),
    }
  }

  async function submit(attemptId: string, questionId: string, typed: string): Promise<SubmitResult> {
    const blob = await getDownloadedBundle(chapterId)
    const pack = blob?.checkpointPack
    const state = await loadState(userId, chapterId)
    const open = Object.values(state.open).find((o) => o.attemptId === attemptId)
    if (!blob || !pack || !open) return { status: 'invalid_attempt' }

    const packTopic = pack.topics.find((t) => t.topic_key === open.topicKey)
    const byId = new Map((packTopic?.questions ?? []).map((q) => [q.id, q]))
    if (questionId !== open.questionIds[open.index]) return { status: 'wrong_question' }
    if (typed.trim() === '' || typed.length > 200) return { status: 'invalid_answer' }
    const q = byId.get(questionId)
    if (!q) return { status: 'attempt_closed' }

    if (!answerMatches(typed, q.answer, q.accepted_answers)) {
      // wrong: same question, everything answered so far is kept; the answer is not shown
      open.wrongTries += 1
      await offlineDb.checkpoint_local.put(state)
      return { status: 'wrong', correct: false, index: open.index, total: open.questionIds.length, tries: open.wrongTries, explanation: q.explanation }
    }

    open.typed[open.index] = typed
    if (open.index + 1 >= open.questionIds.length) {
      // passed: provisional until the server re-checks it
      const entry: CheckpointQueueEntry = {
        localId: newId(),
        userId,
        chapterId,
        topicKey: open.topicKey,
        packVersion: pack.pack_version,
        answers: open.questionIds.map((id, i) => ({ question_id: id, typed: open.typed[i] })),
        finishedAt: new Date().toISOString(),
      }
      const old = await offlineDb.checkpoint_queue.where('chapterId').equals(chapterId).toArray()
      await Promise.all(old.filter((o) => o.userId === userId && o.topicKey === open.topicKey).map((o) => offlineDb.checkpoint_queue.delete(o.localId)))
      await offlineDb.checkpoint_queue.put(entry)
      delete state.open[open.topicKey]
      await offlineDb.checkpoint_local.put(state)
      // The server adds the real points when it confirms the pass; this is what the student is told now.
      const points = open.questionIds.reduce((sum, id) => sum + (byId.get(id)?.points ?? 1), 0)
      return { status: 'passed', correct: true, topic_key: open.topicKey, points, pending: true }
    }

    open.index += 1
    await offlineDb.checkpoint_local.put(state)
    return {
      status: 'continue',
      correct: true,
      index: open.index,
      total: open.questionIds.length,
      question: toQuestion(byId.get(open.questionIds[open.index])!),
    }
  }

  return { start, submit }
}

/* ----------------------------------------------------------------- reconnect */

let checkpointSyncInFlight = false

/** Sends every provisional pass to the server for re-checking. Accepted -> a real pass.
 *  Rejected -> the topic goes back to "current" and a notice is left for the student.
 *  Safe to call any time: it does nothing when offline, when the queue is empty, or while already running. */
export async function runCheckpointSync(userId: string): Promise<void> {
  if (checkpointSyncInFlight) return
  if (await isOffline()) return
  checkpointSyncInFlight = true
  try {
    const all = (await offlineDb.checkpoint_queue.where('userId').equals(userId).toArray()).sort((a, b) =>
      a.finishedAt.localeCompare(b.finishedAt),
    )
    for (let from = 0; from < all.length; from += 50) {
      const rows = all.slice(from, from + 50)
      const payload = rows.map((r) => ({
        chapter_id: r.chapterId,
        topic_key: r.topicKey,
        pack_version: r.packVersion,
        answers: r.answers,
        finished_at: r.finishedAt,
      }))
      const { data, error } = await supabase.rpc('sync_offline_checkpoint_attempts', { p_attempts: payload })
      if (error || !Array.isArray(data)) return // no answer from the server: keep the queue, try again later

      for (const res of data as { index: number; status: string; reason: string | null }[]) {
        const row = rows[res.index]
        if (!row) continue
        if (res.status === 'accepted') {
          await refreshPassedSnapshot(row.chapterId, [row.topicKey])
        } else {
          await offlineDb.checkpoint_notices.add({
            userId,
            chapterId: row.chapterId,
            topicKey: row.topicKey,
            reason: res.reason ?? 'bad_questions',
            createdAt: new Date().toISOString(),
          })
        }
        await offlineDb.checkpoint_queue.delete(row.localId)
      }
    }
  } catch (err) {
    console.error('Checkpoint sync failed', err)
  } finally {
    checkpointSyncInFlight = false
  }
}

export async function pendingCheckpointCount(): Promise<number> {
  return offlineDb.checkpoint_queue.count()
}

/* ------------------------------------------------------------------- notices */

export async function loadNotices(userId: string, chapterId: string): Promise<CheckpointNotice[]> {
  const rows = await offlineDb.checkpoint_notices.where('chapterId').equals(chapterId).toArray()
  return rows.filter((n) => n.userId === userId)
}

export async function dismissNotice(id: number): Promise<void> {
  await offlineDb.checkpoint_notices.delete(id)
}

export function noticeMessage(n: CheckpointNotice): string {
  const topic = `Topic ${n.topicKey}`
  if (n.reason === 'stale_pack') {
    return `${topic}: the questions were updated after you downloaded this chapter, so your offline pass couldn't be confirmed. Please answer them again online.`
  }
  return `${topic}: your offline pass couldn't be confirmed. Please answer its questions again.`
}

/** Called when a downloaded chapter is removed: unfinished offline attempts go with it
 *  (finished-but-unsynced passes stay in the queue so nothing a student earned is lost). */
export async function clearLocalCheckpointState(chapterId: string): Promise<void> {
  await offlineDb.checkpoint_local.where('chapterId').equals(chapterId).delete()
}
