// Saves a finished attempt. If the phone is offline (or the save fails), the attempt is
// kept on the device and uploaded later. Ids are made on the phone, so a retry can never
// create a duplicate. Attempt marks are for practice only: nothing here touches
// profiles.correct_mcqs or the leaderboard.
import { supabase } from './supabase'

export type AttemptRow = {
  id: string
  user_id?: string // who made the attempt. A saved attempt only uploads for this same account.
  paper_kind: 'past' | 'generated' | 'mock'
  paper_id: string
  mode: 'exam'
  started_at: string
  submitted_at: string
  total_marks: number
  obtained_marks: number
}

export type AnswerRow = {
  id: string
  attempt_id: string
  question_ref: string
  or_choice: string | null
  selected_option: string | null
  ticked_points: number[] | null
  marks_awarded: number | null
}

export type AttemptPayload = { attempt: AttemptRow; answers: AnswerRow[] }

const QUEUE_KEY = 'iqra_attempt_queue'

function readQueue(): AttemptPayload[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function writeQueue(q: AttemptPayload[]) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)) } catch { /* storage full or blocked */ }
}

async function upload(p: AttemptPayload): Promise<void> {
  const a = await supabase.from('paper_attempts').upsert(p.attempt, { onConflict: 'id' })
  if (a.error) throw a.error
  if (p.answers.length > 0) {
    const r = await supabase.from('attempt_answers').upsert(p.answers, { onConflict: 'id' })
    if (r.error) throw r.error
  }
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// 'saved' = on the server. 'queued' = kept on this phone, will upload when possible.
export async function saveAttempt(p: AttemptPayload): Promise<'saved' | 'queued'> {
  try {
    await upload(p)
    return 'saved'
  } catch {
    const q = readQueue().filter(x => x.attempt.id !== p.attempt.id)
    q.push(p)
    writeQueue(q)
    return 'queued'
  }
}

let flushing = false

export async function flushAttemptQueue(userId?: string): Promise<number> {
  if (flushing) return 0
  const q = readQueue()
  if (q.length === 0) return 0
  flushing = true
  let sent = 0
  try {
    const remaining: AttemptPayload[] = []
    for (const p of q) {
      // Another account's finished attempt stays queued until that account signs in again.
      if (userId && p.attempt.user_id && p.attempt.user_id !== userId) { remaining.push(p); continue }
      try { await upload(p); sent += 1 } catch { remaining.push(p) }
    }
    writeQueue(remaining)
  } finally {
    flushing = false
  }
  return sent
}
