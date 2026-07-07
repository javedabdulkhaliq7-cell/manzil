import { supabase, Profile } from './supabase'

function todayStr() {
  return new Date().toISOString().split('T')[0]
}
function yesterdayStr() {
  return new Date(Date.now() - 86400000).toISOString().split('T')[0]
}

/**
 * Updates XP, streak, and the daily MCQ counter on the profile after any
 * quiz or mock test submission. Call this once per submission, regardless
 * of whether it was a chapter quiz or a full mock test.
 */
export async function updateProfileAfterAttempt(
  userId: string,
  currentProfile: Profile,
  xpEarned: number,
  mcqCount: number
) {
  const today = todayStr()
  const wasToday = currentProfile.last_study_date === today
  const wasYesterday = currentProfile.last_study_date === yesterdayStr()
  const newStreak = wasToday ? currentProfile.streak_days : wasYesterday ? currentProfile.streak_days + 1 : 1

  const mcqResetNeeded = currentProfile.mcq_reset_date !== today
  const newMcqUsed = mcqResetNeeded ? mcqCount : currentProfile.mcq_used_today + mcqCount

  await supabase
    .from('profiles')
    .update({
      xp: currentProfile.xp + xpEarned,
      streak_days: newStreak,
      last_study_date: today,
      mcq_used_today: newMcqUsed,
      mcq_reset_date: today,
    })
    .eq('id', userId)
}

/**
 * Returns how many MCQs the student has left today on the free plan.
 * Accounts for the daily reset even if the profile object is slightly stale.
 */
export function mcqsRemainingToday(profile: Profile, freeLimit: number): number {
  if (profile.plan !== 'free') return Infinity
  const used = profile.mcq_reset_date === todayStr() ? profile.mcq_used_today : 0
  return Math.max(0, freeLimit - used)
}

/**
 * Updates (or creates) the per-chapter progress row after a chapter-specific
 * quiz. Skipped entirely for mixed/full-syllabus attempts with no single chapter.
 *
 * Note: completion_pct here is a simple stand-in (best score so far on this
 * chapter) — not a true "% of distinct MCQs answered" calculation. Good enough
 * to show real movement for now; a more precise version can replace this later.
 */
export async function updateChapterProgress(
  userId: string,
  chapterId: string,
  subjectId: string | null,
  scorePct: number,
  questionsAttempted: number
) {
  const { data: existing } = await supabase
    .from('user_progress')
    .select('*')
    .eq('user_id', userId)
    .eq('chapter_id', chapterId)
    .maybeSingle()

  const bestScore = Math.max(existing?.best_score ?? 0, scorePct)
  const mcqsAttempted = (existing?.mcqs_attempted ?? 0) + questionsAttempted

  await supabase.from('user_progress').upsert(
    {
      user_id: userId,
      chapter_id: chapterId,
      subject_id: subjectId,
      completion_pct: Math.min(100, bestScore),
      notes_read: existing?.notes_read ?? false,
      mcqs_attempted: mcqsAttempted,
      best_score: bestScore,
    },
    { onConflict: 'user_id,chapter_id' }
  )
}
