import { supabase, Profile } from './supabase'

// Local calendar date as YYYY-MM-DD, NOT UTC. .toISOString() converts to
// UTC first, so for ~5 hours every day (midnight-5am Pakistan time, since
// PKT is UTC+5) it returns the previous day's date — breaking the streak
// comparison below for anyone studying late at night/early morning.
function localDateStr(d: Date) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
export function todayStr() {
  return localDateStr(new Date())
}

/**
 * Start of today (local midnight) as a precise UTC instant — safe to use
 * directly in a `created_at >= X` filter against a timestamptz column.
 * Same trick as startOfWeekISO() below: build the Date from local y/m/d
 * components so .toISOString() lands on the correct instant regardless of
 * session/browser timezone. Use this instead of
 * `new Date().toISOString().split('T')[0]` for any "today" boundary query —
 * that pattern converts to UTC BEFORE taking the date part, so for ~5 hours
 * every day (midnight-5am PKT) it silently returns yesterday's date, and
 * even a corrected date string still gets misinterpreted at the DB layer
 * when compared against a timestamptz column (see get_reminder_candidates'
 * migration history for the same class of bug on the Postgres side).
 */
export function startOfTodayISO(now: Date = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
}

/** Local YYYY-MM month key (Asia/Karachi-equivalent, i.e. local device time), for the monthly mock-test cap below. */
function thisMonthStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * A local YYYY-MM-DD date string, offset by `deltaDays` (negative = past).
 * Used to compute "yesterday" for freeze backfill and the 7-day strip below,
 * built the same way as localDateStr()/todayStr() to stay consistent.
 */
function offsetDateStr(deltaDays: number, from: Date = new Date()): string {
  const d = new Date(from)
  d.setDate(d.getDate() + deltaDays)
  return localDateStr(d)
}

/**
 * Whole calendar days between two YYYY-MM-DD local date strings (b - a).
 * Parsed as local midnight, not UTC, so this stays correct around DST
 * and matches localDateStr()/todayStr() above. Returns Infinity when
 * dateStr is null (student has never studied).
 */
function daysBetween(dateStr: string | null, otherStr: string): number {
  if (!dateStr) return Infinity
  const [y1, m1, d1] = dateStr.split('-').map(Number)
  const [y2, m2, d2] = otherStr.split('-').map(Number)
  const a = new Date(y1, m1 - 1, d1)
  const b = new Date(y2, m2 - 1, d2)
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export type StreakStatus = 'none' | 'active' | 'frozen' | 'broken'

/**
 * Pure, read-only classification of the CURRENT streak state, for display
 * (dashboard flame icon, frozen banner). Does not write anything — safe to
 * call on every Home render. Mirrors the increment rule in
 * updateProfileAfterAttempt() below, so what's shown always matches what
 * a quiz completed right now would do to the streak.
 *
 * - none:   never studied (last_study_date is null)
 * - active: studied today, or studied yesterday (streak intact, not yet
 *           at risk)
 * - frozen: missed exactly one day — the one free automatic freeze is
 *           covering it. Number is preserved. A quiz completed today
 *           saves it; a second missed day would break it.
 * - broken: missed two or more consecutive days — streak is gone. Shows
 *           as 0 immediately, even though the DB row won't actually read
 *           0 until the next attempt writes it.
 */
export function computeStreakStatus(
  lastStudyDate: string | null,
  streakDays: number,
  today: string = todayStr()
): { status: StreakStatus; displayStreak: number } {
  const daysSince = daysBetween(lastStudyDate, today)
  if (daysSince === Infinity) return { status: 'none', displayStreak: 0 }
  if (daysSince <= 1) return { status: 'active', displayStreak: streakDays }
  if (daysSince === 2) return { status: 'frozen', displayStreak: streakDays }
  return { status: 'broken', displayStreak: 0 }
}

export type StreakResult = {
  oldStreak: number
  newStreak: number
  /** False when a quiz was already completed earlier today — no change, no reveal. */
  streakChanged: boolean
  /** True only on the increment that takes the streak from 0 — first-ever
   *  completion, or a fresh start after a break. Drives the "Streak
   *  started! Come back tomorrow to keep it going." copy — shown once,
   *  not on every subsequent day's count-up. */
  streakStarted: boolean
}

/**
 * Updates XP, streak, and the daily MCQ counter on the profile after any
 * quiz or mock test submission. Call this once per submission, regardless
 * of whether it was a chapter quiz or a full mock test.
 *
 * Returns the old/new streak values so the results screen can drive the
 * Duolingo-style count-up reveal (score first, then the flame animating
 * oldStreak -> newStreak) — never skip straight to the post-increment
 * number.
 */
export async function updateProfileAfterAttempt(
  userId: string,
  currentProfile: Profile,
  xpEarned: number,
  mcqCount: number,
  currentHeartsOverride?: number
): Promise<StreakResult> {
  const today = todayStr()
  const oldStreak = currentProfile.streak_days
  const daysSince = daysBetween(currentProfile.last_study_date, today)

  let newStreak: number
  let streakChanged: boolean
  // Which streak_daily_log rows to write for this completion. today is
  // always logged as 'completed' when the streak actually moves; the
  // freeze-save branch additionally backfills the missed day as 'frozen'
  // so the 7-day strip can show it correctly later, not just today.
  const logRows: { user_id: string; log_date: string; status: 'completed' | 'frozen' }[] = []
  if (daysSince === 0) {
    // Already completed a quiz/mock test today — only the first completion
    // of the day moves the streak (doing 5 quizzes today still counts once).
    newStreak = oldStreak
    streakChanged = false
  } else if (daysSince === 1) {
    // Consecutive day — continues the streak normally.
    newStreak = oldStreak + 1
    streakChanged = true
    logRows.push({ user_id: userId, log_date: today, status: 'completed' })
  } else if (daysSince === 2) {
    // Exactly one day was missed and the free automatic freeze is saving
    // it — continue the streak, and backfill yesterday as frozen so the
    // strip shows the snowflake on the day it actually applied to.
    newStreak = oldStreak + 1
    streakChanged = true
    logRows.push({ user_id: userId, log_date: offsetDateStr(-1), status: 'frozen' })
    logRows.push({ user_id: userId, log_date: today, status: 'completed' })
  } else {
    // Never studied before, or two+ consecutive days missed (freeze only
    // ever protects one day at a time) — fresh start.
    newStreak = 1
    streakChanged = true
    logRows.push({ user_id: userId, log_date: today, status: 'completed' })
  }
  const streakStarted = streakChanged && oldStreak === 0

  const mcqResetNeeded = currentProfile.mcq_reset_date !== today
  const newMcqUsed = mcqResetNeeded ? mcqCount : currentProfile.mcq_used_today + mcqCount

  const patch: Record<string, unknown> = {
    xp: currentProfile.xp + xpEarned,
    streak_days: newStreak,
    last_study_date: today,
    mcq_used_today: newMcqUsed,
    mcq_reset_date: today,
  }

  // Completion reward: finishing a Quiz/Exercise OR a Mock Test gives back
  // 1 heart (capped at FREE_HEARTS_MAX) — win or lose, this is separate
  // from the per-wrong-answer loss in loseHeart(). Free plan only (Pro
  // never reads hearts_current at all, so writing it would be a no-op
  // anyway, but skipping it keeps the intent clear). Uses
  // currentHeartsOverride when given — QuizScreen passes its live
  // `hearts` state, since mid-quiz losses via loseHeart() may have moved
  // hearts past whatever currentProfile.hearts_current still says.
  if (currentProfile.plan === 'free') {
    const heartsBaseline =
      currentHeartsOverride !== undefined && currentHeartsOverride !== Infinity
        ? currentHeartsOverride
        : currentProfile.hearts_reset_date === today
        ? currentProfile.hearts_current
        : FREE_HEARTS_MAX
    patch.hearts_current = Math.min(FREE_HEARTS_MAX, heartsBaseline + 1)
    patch.hearts_reset_date = today
  }

  // First-visit nudge on Home (pulsing Quick Quiz card) — turns off
  // permanently the moment any quiz or mock test is actually submitted.
  // Only included in the update when it's still false, so this never
  // fires an extra write for students who've long since completed it.
  if (!currentProfile.has_completed_first_task) {
    patch.has_completed_first_task = true
  }

  await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)

  if (logRows.length > 0) {
    // upsert, not insert: daysSince===2 can touch yesterday's row, which
    // in rare double-submit races might already exist — onConflict keeps
    // this idempotent rather than erroring.
    await supabase.from('streak_daily_log').upsert(logRows, { onConflict: 'user_id,log_date' })
  }

  return { oldStreak, newStreak, streakChanged, streakStarted }
}

export type WeekStripDay = {
  date: string
  /** 2-letter weekday label, e.g. 'Mo', 'Tu' — matches the rolling strip on the streak reveal screen. */
  label: string
  /** 'not_registered' = this date is before the student's account even
   *  existed — rendered as a neutral placeholder, never as a red "missed"
   *  flag (a brand-new student on day 2 would otherwise see 5 misleading
   *  "missed" days from before they signed up). */
  status: 'completed' | 'frozen' | 'missed' | 'not_registered'
  isToday: boolean
}

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

/**
 * The last 7 calendar days (6 days ago -> today), each with its logged
 * status, for the full-screen streak reveal's day strip. Reads
 * streak_daily_log rather than re-deriving from quiz_attempts, so it
 * reflects freeze-covered days accurately, not just "studied or not".
 * A day with no log row shows as 'missed', UNLESS it falls before
 * accountCreatedAt (if provided), in which case it's 'not_registered'.
 */
export async function getWeekStrip(userId: string, accountCreatedAt?: string | null): Promise<WeekStripDay[]> {
  const start = offsetDateStr(-6)
  const today = todayStr()
  const createdLocalDate = accountCreatedAt ? localDateStr(new Date(accountCreatedAt)) : null

  const { data } = await supabase
    .from('streak_daily_log')
    .select('log_date, status')
    .eq('user_id', userId)
    .gte('log_date', start)
    .lte('log_date', today)

  const byDate = new Map<string, 'completed' | 'frozen'>()
  for (const row of data ?? []) byDate.set(row.log_date, row.status)

  const days: WeekStripDay[] = []
  for (let i = -6; i <= 0; i++) {
    const date = offsetDateStr(i)
    const weekday = new Date(date + 'T00:00:00').getDay()
    const status: WeekStripDay['status'] =
      createdLocalDate && date < createdLocalDate ? 'not_registered' : byDate.get(date) ?? 'missed'
    days.push({
      date,
      label: WEEKDAY_LABELS[weekday],
      status,
      isToday: date === today,
    })
  }
  return days
}

/**
 * Records the student's one-time weekly study-day commitment (3, 5, or 7 =
 * "every day"). Call this only once — the prompt that calls it is gated on
 * profile.weekly_goal_days being null, so this never needs to be called a
 * second time for the same student. Purely a soft, secondary goal (Stats
 * tab progress ring + future reminder-notification threshold) — it never
 * feeds the daily flame streak or its freeze logic above.
 */
export async function setWeeklyGoal(userId: string, days: 3 | 5 | 7) {
  await supabase
    .from('profiles')
    .update({ weekly_goal_days: days })
    .eq('id', userId)
}

/**
 * Start of the current calendar week (Monday, local time) as a precise
 * UTC instant — safe to use directly in a `created_at >= X` filter against
 * a timestamptz column. Unlike localDateStr() above (which converts an
 * existing UTC timestamp to a local date string, and breaks near midnight
 * PKT if done naively), this goes the other direction: it builds a Date
 * from local y/m/d components, so .toISOString() correctly reflects local
 * midnight regardless of the server's or browser's timezone.
 */
function startOfWeekISO(today: Date = new Date()): string {
  const day = today.getDay() // 0=Sun .. 6=Sat
  const daysSinceMonday = (day + 6) % 7
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysSinceMonday)
  return monday.toISOString()
}

/**
 * How many distinct calendar days this week (Mon-today) the student has
 * completed at least one quiz/mock test — the numerator for the Stats tab
 * progress ring ("this week: 3/5"). Deliberately independent of
 * streak_days: a broken streak can still show partial weekly progress,
 * and this doesn't get frozen the way the streak does.
 */
export async function getStudyDaysThisWeek(userId: string): Promise<number> {
  const { data } = await supabase
    .from('quiz_attempts')
    .select('created_at')
    .eq('user_id', userId)
    .gte('created_at', startOfWeekISO())

  if (!data) return 0
  const distinctDays = new Set(data.map(row => localDateStr(new Date(row.created_at))))
  return distinctDays.size
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

export const FREE_HEARTS_MAX = 5

/**
 * Free monthly cap on Mock Tests / Past Papers (Doc 2, Section 5 lists
 * this as a still-open decision — "3 free mock tests per month" was the
 * doc's own illustrative example, used here as a real, changeable
 * constant rather than left unbuilt). Pro is unlimited, same as hearts.
 */
export const FREE_MOCK_TESTS_PER_MONTH = 3

/**
 * Mock tests remaining this month on the free plan. Lazy monthly reset —
 * same shape as mcqsRemainingToday/heartsRemaining: if mock_test_reset_month
 * isn't the current month, the count is effectively 0 used even though the
 * DB row hasn't been rewritten yet.
 */
export function mockTestsRemainingThisMonth(profile: Profile): number {
  if (profile.plan !== 'free') return Infinity
  const used = profile.mock_test_reset_month === thisMonthStr() ? profile.mock_tests_used_this_month : 0
  return Math.max(0, FREE_MOCK_TESTS_PER_MONTH - used)
}

/**
 * Records one Mock Test / Past Paper submission against the monthly cap.
 * Call once per submission, free plan or not (it's a no-op write-wise
 * for Pro — still fine to call unconditionally, mirrors mcq usage
 * tracking elsewhere). Applies the lazy monthly reset first if this is
 * the first one counted this month.
 */
export async function recordMockTestUsage(userId: string, currentProfile: Profile): Promise<void> {
  const month = thisMonthStr()
  const resetNeeded = currentProfile.mock_test_reset_month !== month
  const newUsed = resetNeeded ? 1 : currentProfile.mock_tests_used_this_month + 1

  await supabase
    .from('profiles')
    .update({ mock_tests_used_this_month: newUsed, mock_test_reset_month: month })
    .eq('id', userId)
}

/**
 * Hearts remaining right now (Doc 2, Section 3). Pro students are
 * unlimited — this only ever gates the free plan. Lazy daily reset: if
 * hearts_reset_date isn't today, the student effectively has a full 5
 * even though the DB row hasn't been rewritten yet (same pattern as
 * mcqsRemainingToday above) — the row only actually updates the next
 * time a heart is spent or refilled, via loseHeart()/refillHearts*()
 * below.
 */
export function heartsRemaining(profile: Profile): number {
  if (profile.plan !== 'free') return Infinity
  if (profile.hearts_reset_date !== todayStr()) return FREE_HEARTS_MAX
  return profile.hearts_current
}

/**
 * Records one wrong answer in a Quiz or Exercise (NEVER call this for
 * Mock Tests, Past Papers, or Notes — those are explicitly exempt per the
 * doc). Applies the lazy daily reset first if this is the first heart
 * spent today, then decrements, floored at 0.
 *
 * currentHeartsOverride: pass the caller's own LIVE running hearts count
 * (e.g. QuizScreen's local `hearts` state) when calling this more than
 * once without a profile refresh in between — otherwise every call in the
 * same quiz recomputes from the same stale currentProfile.hearts_current,
 * so 3 wrong answers in one quiz would only ever net -1, not -3. Omit it
 * for a one-off call where currentProfile is known fresh.
 *
 * Per the doc's literal wording ("cannot START a new quiz/exercise" at 0
 * hearts) this does NOT forcibly eject the student from a quiz already in
 * progress — hitting 0 mid-quiz just means the next quiz/exercise they
 * try to open will show the out-of-hearts screen instead. If you actually
 * want a harder Duolingo-style mid-quiz cutoff instead, that's a real
 * product decision to confirm before changing this.
 */
export async function loseHeart(
  userId: string,
  currentProfile: Profile,
  currentHeartsOverride?: number
): Promise<{ heartsRemaining: number; justRanOut: boolean }> {
  if (currentProfile.plan !== 'free') return { heartsRemaining: Infinity, justRanOut: false }

  const today = todayStr()
  const current =
    currentHeartsOverride !== undefined && currentHeartsOverride !== Infinity
      ? currentHeartsOverride
      : currentProfile.hearts_reset_date === today
      ? currentProfile.hearts_current
      : FREE_HEARTS_MAX
  const newHearts = Math.max(0, current - 1)

  await supabase
    .from('profiles')
    .update({ hearts_current: newHearts, hearts_reset_date: today })
    .eq('id', userId)

  return { heartsRemaining: newHearts, justRanOut: newHearts === 0 && current > 0 }
}

/**
 * Full refill to 5/5 — the "watch a short ad" free refill path from the
 * doc. NOT wired to an actual ad SDK yet (no ad provider chosen as of
 * this build) — call this from wherever that integration ends up
 * completing successfully.
 */
export async function refillHeartsFull(userId: string): Promise<void> {
  await supabase
    .from('profiles')
    .update({ hearts_current: FREE_HEARTS_MAX, hearts_reset_date: todayStr() })
    .eq('id', userId)
}

/**
 * Partial refill (e.g. +2) — the "complete a Notes section" free refill
 * path from the doc. NOT wired to a trigger yet: notes-completion tracking
 * doesn't exist anywhere in the app (flagged in IQRA_01's completion
 * report — user_progress.notes_read is never set by any code path), so
 * there's nothing to call this from until that's built. Capped at
 * FREE_HEARTS_MAX either way.
 */
export async function refillHeartsPartial(
  userId: string,
  currentProfile: Profile,
  amount: number
): Promise<number> {
  const today = todayStr()
  const current = currentProfile.hearts_reset_date === today ? currentProfile.hearts_current : FREE_HEARTS_MAX
  const newHearts = Math.min(FREE_HEARTS_MAX, current + amount)

  await supabase
    .from('profiles')
    .update({ hearts_current: newHearts, hearts_reset_date: today })
    .eq('id', userId)

  return newHearts
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
