// lib/syncEngine.ts
//
// Phase 5.3 — the ordered sync processor (offline-mode spec, Section 7).
// Runs whenever the app has a connection, replaying every queued offline
// quiz attempt against the real server, so streak/XP/hearts/used-questions
// state ends up exactly where it would have if the student had been
// online the whole time.
//
// Correctness rules this file exists to guarantee (spec Sections 7-8):
// - Processed STRICTLY in completedAt order, one row at a time, never in
//   parallel — required for the streak day-by-day math (freeze/reset) to
//   compute correctly across a multi-day offline batch.
// - Each row is applied against a RUNNING local copy of the profile that
//   carries forward between iterations — so day 2 of a 3-day batch sees
//   day 1's already-updated streak/xp, not the stale pre-batch profile.
// - A future-dated completedAt (clock tampering) is rejected, not synced.
// - If one row fails (e.g. connection drops mid-batch), STOP — don't skip
//   ahead to later rows out of order. Retry from where it left off next
//   time this runs.
//
// NOT yet implemented here (deferred to Phase 7 per the spec's own
// phasing): the 7-day cap on backdated streak credit. Right now a long
// offline batch would credit the streak day-by-day with no cap — correct
// per Phase 5's own checkpoint, but Phase 7 adds the cap before this is
// considered done end-to-end.

import { supabase, Profile } from './supabase'
import { offlineDb, type PendingSyncEntry } from './offlineDb'
import { updateProfileAfterAttempt, updateChapterProgress, loseHeart } from './progress'
import { isOffline } from './connectivity'

let syncInFlight = false

/** True if `completedAt` is after the current real time — the anti-clock-spoofing guard. */
function isFutureTimestamp(completedAt: string): boolean {
  return new Date(completedAt).getTime() > Date.now()
}

/** Merges one attempt's drawn question IDs into the server's
 *  used_questions_log — same row shape randomDrawEngine.ts's internal
 *  logUsedIds() writes, so future ONLINE draws correctly treat these as
 *  already-used too (not just future offline draws on this device). */
async function mergeUsedQuestionsIntoServerLog(
  userId: string,
  chapterId: string,
  newlyUsedQuestionIds: Record<string, string[]>
): Promise<void> {
  const rows: any[] = []
  for (const [key, ids] of Object.entries(newlyUsedQuestionIds)) {
    const [sourceTable, sectionType] = key.split('::')
    for (const questionId of ids) {
      rows.push({
        user_id: userId,
        scope: 'chapter',
        scope_id: chapterId,
        source_table: sourceTable,
        section_type: sectionType ?? '',
        question_id: questionId,
      })
    }
  }
  if (rows.length === 0) return
  const { error } = await supabase.from('used_questions_log').upsert(rows, {
    onConflict: 'user_id,scope,scope_id,source_table,section_type,question_id',
    ignoreDuplicates: true,
  })
  if (error) throw error
}

/** Streak-cap bookkeeping for ONE sync batch (spec Section 8, item 3). */
const MAX_BACKDATED_STREAK_DAYS = 7
type BatchState = {
  /** How many streak-increasing days this batch has credited so far. */
  creditedStreakDays: number
  /** Once the cap is hit, the streak value we hold the student at for the rest of the batch. */
  cappedStreak: number | null
}

/**
 * Processes one pending_sync row against the given running profile state.
 * Returns the updated profile to carry forward into the next row.
 * Throws on any failure — the caller stops the whole batch when this throws,
 * per the "don't skip ahead" rule above.
 *
 * RETRY SAFETY: each server-side step records itself in the row's
 * `doneSteps` the moment it finishes. If a later step fails and this row is
 * retried, finished steps are skipped — otherwise a retry would save the
 * attempt twice or add the XP twice. (The attempt insert is additionally
 * idempotent on its own: it reuses the row's localId as the attempt id, so
 * even a repeat can't create a second copy.)
 */
async function processOneRow(
  row: PendingSyncEntry,
  runningProfile: Profile,
  batch: BatchState
): Promise<Profile> {
  if (isFutureTimestamp(row.completedAt)) {
    throw new Error(
      `Rejected future-dated attempt (${row.localId}) — this device's clock may be set incorrectly.`
    )
  }

  const payload = row.quizAttemptPayload
  const completedDate = row.completedAt.slice(0, 10) // YYYY-MM-DD
  const done = new Set<string>(row.doneSteps ?? [])

  async function markDone(step: string) {
    done.add(step)
    await offlineDb.pending_sync.update(row.localId, { doneSteps: [...done] })
  }

  // Step 1 — save the attempt with created_at set to the REAL completion
  // time (not now()), so streak/XP history and leaderboard activity reflect
  // the true study date. Uses localId as the attempt id + ignoreDuplicates,
  // so repeating this step can never create a second copy (and, because
  // nothing is inserted on a repeat, the correct_mcqs trigger can't fire
  // twice either).
  if (!done.has('attempt')) {
    const { error: insertErr } = await supabase.from('quiz_attempts').upsert(
      {
        id: row.localId,
        user_id: row.userId,
        chapter_id: row.chapterId,
        subject_id: row.subjectId,
        score: payload.score,
        total: payload.total,
        correct: payload.correct,
        wrong: payload.wrong,
        skipped: payload.skipped,
        time_taken: payload.time_taken,
        xp_earned: payload.xp_earned,
        answers: payload.answers,
        created_at: row.completedAt,
      },
      { onConflict: 'id', ignoreDuplicates: true }
    )
    if (insertErr) throw insertErr
    await markDone('attempt')
  }

  // Step 2 — XP / streak / daily-log update, then the Phase 7.2 cap.
  // Same logic as a live online submission, with "today" set to this
  // attempt's real date. `finalStreak` falls back to the server's current
  // value when this step was already done on an earlier try.
  let finalStreak = runningProfile.streak_days
  let xpAfter = runningProfile.xp
  if (!done.has('profile')) {
    const streakResult = await updateProfileAfterAttempt(
      row.userId,
      runningProfile,
      payload.xp_earned,
      payload.total,
      undefined,
      completedDate
    )
    xpAfter = runningProfile.xp + payload.xp_earned
    finalStreak = streakResult.newStreak

    // Phase 7.2 — cap on backdated streak credit per batch. This ONLY ever
    // throttles the streak_days number. XP, correct_mcqs and the per-day
    // streak_daily_log rows were already written in full above and are
    // deliberately left alone.
    if (streakResult.newStreak < streakResult.oldStreak) {
      // A real reset mid-batch (gap in study days) — start counting afresh.
      batch.creditedStreakDays = 0
      batch.cappedStreak = null
    } else if (streakResult.newStreak > streakResult.oldStreak) {
      if (batch.cappedStreak !== null) {
        finalStreak = batch.cappedStreak // cap reached earlier: hold there
      } else {
        batch.creditedStreakDays += 1
        if (batch.creditedStreakDays >= MAX_BACKDATED_STREAK_DAYS) {
          batch.cappedStreak = streakResult.newStreak
        }
      }
    }
    if (finalStreak !== streakResult.newStreak) {
      const { error: capErr } = await supabase
        .from('profiles')
        .update({ streak_days: finalStreak })
        .eq('id', row.userId)
      if (capErr) throw capErr
    }
    await markDone('profile')
  }

  // Step 3 — per-chapter progress + never-repeat log on the server.
  if (row.chapterId && !done.has('chapter')) {
    await updateChapterProgress(row.userId, row.chapterId, row.subjectId, payload.score, payload.total)
    await mergeUsedQuestionsIntoServerLog(row.userId, row.chapterId, row.newlyUsedQuestionIds)
    await markDone('chapter')
  }

  // Step 4 — replay the hearts lost during this attempt, one at a time,
  // same loseHeart() logic a live quiz would have run on each wrong answer.
  let heartsProfile = runningProfile
  if (!done.has('hearts')) {
    for (let i = 0; i < row.heartsLostDuringAttempt; i++) {
      const { heartsRemaining } = await loseHeart(row.userId, heartsProfile)
      heartsProfile = { ...heartsProfile, hearts_current: heartsRemaining, hearts_reset_date: completedDate }
    }
    await markDone('hearts')
  }

  await offlineDb.pending_sync.delete(row.localId)

  // Build the running profile forward for the next row in this batch.
  return {
    ...heartsProfile,
    xp: xpAfter,
    streak_days: finalStreak,
    last_study_date: completedDate,
  }
}

/**
 * Runs the full sync batch: oldest-first, sequential, stop-on-first-failure.
 * Safe to call opportunistically (app foreground, reconnect, a periodic
 * timer) — it's a no-op if the queue is empty, already running, or there's
 * no connection right now.
 */
export async function runPendingSync(userId: string): Promise<void> {
  if (syncInFlight) return
  if (await isOffline()) return

  syncInFlight = true
  try {
    const rows = await offlineDb.pending_sync.where('syncStatus').anyOf('pending', 'failed').toArray()
    if (rows.length === 0) return

    // Oldest first — required for the streak math to compute correctly.
    rows.sort((a, b) => a.completedAt.localeCompare(b.completedAt))

    const { data: profileRow, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (error || !profileRow) return
    let runningProfile = profileRow as Profile
    const batch: BatchState = { creditedStreakDays: 0, cappedStreak: null }

    for (const row of rows) {
      try {
        await offlineDb.pending_sync.update(row.localId, { syncStatus: 'syncing' })
        runningProfile = await processOneRow(row, runningProfile, batch)
      } catch (err) {
        console.error('Sync failed on row', row.localId, err)
        const current = await offlineDb.pending_sync.get(row.localId)
        if (current) {
          await offlineDb.pending_sync.update(row.localId, {
            syncStatus: 'failed',
            syncAttempts: current.syncAttempts + 1,
          })
        }
        // Stop — don't process later rows out of order. Retried next run.
        break
      }
    }
  } finally {
    syncInFlight = false
  }
}

export async function pendingSyncCount(): Promise<number> {
  return offlineDb.pending_sync.count()
}
