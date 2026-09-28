import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Share2, RotateCcw, ChevronRight, Flame, Snowflake, Check } from 'lucide-react'
import BottomNav from '../components/BottomNav'
import { useAuth } from '../contexts/AuthContext'
import { setWeeklyGoal, getWeekStrip, WeekStripDay } from '../lib/progress'

type ResultState = {
  score: number
  total: number
  correct: number
  wrong: number
  skipped: number
  xpEarned: number
  timeTaken: number
  subjectName?: string
  quizLabel?: string
  // Streak fields — passed straight through from the StreakResult returned
  // by updateProfileAfterAttempt() at the call site (QuizScreen/MockTest
  // screen), so this screen never recomputes streak logic itself.
  oldStreak?: number
  newStreak?: number
  streakChanged?: boolean
  streakStarted?: boolean
  // Leaderboard rank right before and after this specific attempt was
  // recorded (see QuizScreen.tsx's submitQuiz) — not the same signal as
  // LeaderboardScreen's own "since you last checked" celebration; this one
  // is scoped to exactly what this attempt changed.
  prevRank?: number | null
  newRank?: number | null
  leaderboardScore?: number | null
  // True when this attempt was completed with no connection and is queued
  // for sync (see QuizScreen.tsx's submitQuiz). Rank/streak numbers can't
  // be computed until it syncs, so they're omitted rather than shown wrong.
  offlineSubmission?: boolean
}

// Timing for the reveal sequence. Previously had a 900ms pause before the
// streak takeover appeared, during which the plain results page was
// visible — felt like a flash/glitch rather than an intentional beat.
// Now near-instant: just enough for the CSS opacity transition to
// register the "hidden" starting state before flipping to visible (skip
// straight to 0 and the fade-in sometimes doesn't animate at all).
const STREAK_BEAT_DELAY_MS = 30
const STREAK_COUNT_STEP_MS = 350
const GOAL_OPTIONS: { label: string; days: 3 | 5 | 7 }[] = [
  { label: '3 days', days: 3 },
  { label: '5 days', days: 5 },
  { label: 'Every day', days: 7 },
]

// Milestone celebrations — a bigger, special version of the same streak
// takeover screen at round numbers. Purely visual/celebratory (no gems,
// no bonus freezes — those are explicitly deferred past v1 per Doc 2).
const MILESTONE_CONFIG: Record<number, { emoji: string; title: string; sub: string }> = {
  7: { emoji: '🏆', title: '7-Day Milestone!', sub: 'One full week — you\'re building a real habit.' },
  30: { emoji: '👑', title: '30 Days Strong!', sub: 'A month of consistency. Incredible discipline.' },
  100: { emoji: '💎', title: '100 Day Legend!', sub: 'You\'re in rare company now. Absolutely legendary.' },
}
const CONFETTI_COLORS = ['#FFD700', '#FFA500', '#FFFFFF', '#FDBA74']

/**
 * A short, soft two-note chime for the streak reveal — synthesized with
 * the Web Audio API rather than an audio file, so there's nothing to
 * upload/host and no extra network request. Milestone days (7/30/100)
 * get a third, higher note layered on for a slightly bigger moment.
 * Fails silently if Web Audio is unavailable or blocked (e.g. no user
 * gesture yet in this tab) — the visual celebration never depends on it.
 */
function playStreakChime(isMilestone: boolean) {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new AudioContextClass()
    const now = ctx.currentTime
    const notes = isMilestone
      ? [
          { freq: 523.25, start: 0, dur: 0.16 }, // C5
          { freq: 659.25, start: 0.1, dur: 0.18 }, // E5
          { freq: 880.0, start: 0.22, dur: 0.32 }, // A5
        ]
      : [
          { freq: 587.33, start: 0, dur: 0.18 }, // D5
          { freq: 880.0, start: 0.12, dur: 0.28 }, // A5
        ]
    notes.forEach(({ freq, start, dur }) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, now + start)
      gain.gain.linearRampToValueAtTime(0.15, now + start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + start)
      osc.stop(now + start + dur + 0.05)
    })
    // Close the context once the sound has finished — avoids leaking an
    // AudioContext per completion across a long session.
    setTimeout(() => ctx.close(), 800)
  } catch {
    // Web Audio unsupported or blocked — never let this break the reveal.
  }
}

function getGrade(score: number) {
  if (score >= 90) return { label: 'Excellent!', emoji: '🌟', color: 'text-brand-600' }
  if (score >= 75) return { label: 'Great Job!', emoji: '🎉', color: 'text-brand-600' }
  if (score >= 60) return { label: 'Good Work!', emoji: '👍', color: 'text-blue-600' }
  if (score >= 40) return { label: 'Keep Going!', emoji: '💪', color: 'text-amber-600' }
  return { label: 'Keep Practicing', emoji: '📚', color: 'text-red-600' }
}

export default function QuizResultsScreen() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const { profile, refreshProfile } = useAuth()
  const result = (state as ResultState) ?? { score: 85, total: 20, correct: 17, wrong: 2, skipped: 1, xpEarned: 170, timeTaken: 497, quizLabel: 'Sample Quiz' }
  const grade = getGrade(result.score)
  const circumference = 2 * Math.PI * 38
  const dashOffset = circumference * (1 - result.score / 100)
  const mins = Math.floor(result.timeTaken / 60)
  const secs = result.timeTaken % 60

  // Beat 2: the full-screen streak takeover (see reference: flame, big
  // count-up, 7-day strip, Continue button). Score/results (beat 1) are
  // already on screen the instant this component mounts, underneath.
  const hasStreakReveal = result.streakChanged === true && result.newStreak !== undefined
  // The number the count-up is climbing toward — used to tell the final
  // "landing" digit apart from the quick intermediate counting steps.
  const finalStreakValue = result.newStreak ?? result.oldStreak ?? 0
  // Which milestone (if any) this exact completion hits — only true on
  // the day the count LANDS on 7/30/100, not every day after.
  const milestone = hasStreakReveal && result.newStreak !== undefined ? MILESTONE_CONFIG[result.newStreak] : undefined
  // Ask the weekly-goal question once, right after the very first
  // completion ever (streakStarted) — but only if it hasn't been answered
  // before, so a later streak restart after a break doesn't re-ask.
  const eligibleForGoalPrompt = result.streakStarted === true && profile != null && profile.weekly_goal_days == null

  const [overlayStage, setOverlayStage] = useState<'none' | 'streak' | 'goal'>('none')
  const [streakVisible, setStreakVisible] = useState(false)
  const [displayedStreak, setDisplayedStreak] = useState(result.oldStreak ?? 0)
  const [weekStrip, setWeekStrip] = useState<WeekStripDay[] | null>(null)
  const [savingGoal, setSavingGoal] = useState(false)

  // Generated once per mount, not on every render — re-randomizing on
  // each render would make the confetti visibly jitter/reset mid-fall.
  const confettiPieces = useMemo(() => {
    if (!milestone) return []
    return Array.from({ length: 18 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      duration: 2.2 + Math.random() * 1.2,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: 6 + Math.random() * 5,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch the 7-day strip as soon as we know we'll need it, in parallel
  // with the reveal delay below, so it's ready by the time the takeover
  // screen appears rather than popping in empty.
  useEffect(() => {
    if (!hasStreakReveal || !profile) return
    getWeekStrip(profile.id, profile.created_at).then(setWeekStrip).catch(() => setWeekStrip(null))
  }, [hasStreakReveal, profile])

  useEffect(() => {
    if (!hasStreakReveal) return

    let countInterval: ReturnType<typeof setInterval> | undefined
    const revealTimer = setTimeout(() => {
      setOverlayStage('streak')
      playStreakChime(!!milestone)
      // Let the takeover screen finish fading/scaling in before the number
      // starts moving — the animation itself is what beat 2 ends up showing.
      setTimeout(() => setStreakVisible(true), 50)

      const from = result.oldStreak ?? 0
      const to = result.newStreak ?? from
      if (to <= from) {
        setDisplayedStreak(to)
        return
      }
      let current = from
      countInterval = setInterval(() => {
        current += 1
        setDisplayedStreak(current)
        if (current >= to && countInterval) clearInterval(countInterval)
      }, STREAK_COUNT_STEP_MS)
    }, STREAK_BEAT_DELAY_MS)

    return () => {
      clearTimeout(revealTimer)
      if (countInterval) clearInterval(countInterval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStreakReveal])

  function handleStreakContinue() {
    setStreakVisible(false)
    // Small pause so the takeover screen finishes fading out before either
    // the goal prompt appears or we drop back to the plain results view.
    setTimeout(() => {
      setOverlayStage(eligibleForGoalPrompt ? 'goal' : 'none')
    }, 300)
  }

  async function handlePickGoal(days: 3 | 5 | 7) {
    if (!profile || savingGoal) return
    setSavingGoal(true)
    await setWeeklyGoal(profile.id, days)
    await refreshProfile()
    setSavingGoal(false)
    setOverlayStage('none')
  }

  const aiRecs = [
    result.wrong > 0 ? 'Review the questions you got wrong with their explanations.' : null,
    result.score >= 80 ? 'You\'re ready for the Mock Test — try it now!' : 'Practice more MCQs on weak topics.',
    result.score < 60 ? 'Watch the chapter lecture to strengthen your understanding.' : 'Keep the streak going — quiz again tomorrow!',
  ].filter(Boolean) as string[]

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      {/* Hero */}
      <div className="bg-gradient-to-br from-brand-700 to-brand-500 text-white px-4 pt-6 pb-8 text-center flex-shrink-0">
        <div className="text-3xl mb-1">{grade.emoji}</div>
        <h1 className="text-xl font-bold">Quiz Complete!</h1>
        <p className="text-brand-100 text-xs mt-0.5">{result.quizLabel || result.subjectName || 'Quiz'} · {result.total} Questions</p>

        {/* Score ring */}
        <div className="relative w-24 h-24 mx-auto mt-4">
          <svg width="96" height="96" viewBox="0 0 96 96">
            <circle cx="48" cy="48" r="38" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="8" />
            <circle
              cx="48" cy="48" r="38" fill="none" stroke="white" strokeWidth="8"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform="rotate(-90 48 48)"
              className="transition-all duration-1000"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-black">{result.score}%</span>
            <span className="text-[10px] text-brand-100">{result.correct}/{result.total}</span>
          </div>
        </div>
      </div>

      {/* XP card floating */}
      <div className="px-4 -mt-4 z-10">
        <div className="bg-gradient-to-r from-amber-400 to-amber-500 rounded-2xl p-3 text-center shadow-lg shadow-amber-200">
          <div className="text-sm font-bold text-white">+{result.xpEarned} ⭐ XP Earned!</div>
          <div className="text-[10px] text-amber-100">
            {result.score === 100 ? 'Perfect score bonus! ' : ''}
            {result.correct * 10} base + {result.score >= 80 ? '20 bonus (80%+)' : ''}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { val: result.correct, label: 'Correct',   bg: 'bg-brand-50 dark:bg-brand-950/40', text: 'text-brand-600' },
            { val: result.wrong,   label: 'Wrong',     bg: 'bg-red-50 dark:bg-red-950/40',     text: 'text-red-500' },
            { val: result.skipped, label: 'Skipped',   bg: 'bg-gray-50 dark:bg-slate-950',    text: 'text-gray-500 dark:text-slate-400' },
            { val: `${mins}:${secs.toString().padStart(2,'0')}`, label: 'Time', bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-600' },
          ].map(({ val, label, bg, text }) => (
            <div key={label} className={`${bg} rounded-xl p-2 text-center`}>
              <div className={`text-sm font-bold ${text}`}>{val}</div>
              <div className="text-[9px] text-gray-400 font-medium dark:text-slate-500">{label}</div>
            </div>
          ))}
        </div>

        {/* Phase 7.3 — offline-completed attempt: the rank comparison and
            streak reveal can't run without a connection, so show an honest
            message instead of nothing or a wrong number. Both update
            automatically once the queued result syncs. */}
        {result.offlineSubmission && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3 dark:bg-amber-950/30 dark:border-amber-800">
            <div className="text-2xl">📡</div>
            <div className="flex-1 text-left">
              <div className="text-sm font-bold text-amber-900 dark:text-amber-200">Saved offline</div>
              <div className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
                Rank and streak update once you're back online.
              </div>
            </div>
          </div>
        )}

        {/* Leaderboard impact — only renders once we actually have a
            post-attempt rank (the fetch in QuizScreen.tsx can come back
            null if e.g. the profile isn't complete enough to be ranked
            yet, matching LeaderboardScreen's own gate). */}
        {result.leaderboardScore != null && (
          <button
            onClick={() => navigate('/leaderboard')}
            className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3 active:scale-[0.99] transition-all dark:bg-slate-800"
          >
            <div className="text-2xl">🏆</div>
            <div className="flex-1 text-left">
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Score: {result.leaderboardScore}
                <span className="text-brand-600 dark:text-brand-400"> (+{result.correct})</span>
              </div>
              {result.newRank != null && result.prevRank != null && result.newRank < result.prevRank ? (
                <div className="text-xs text-brand-600 dark:text-brand-400 font-semibold mt-0.5">
                  Rank up! #{result.prevRank} → #{result.newRank} 🚀
                </div>
              ) : result.newRank != null ? (
                <div className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">App Rank #{result.newRank}</div>
              ) : null}
            </div>
            <ChevronRight size={18} className="text-brand-600" />
          </button>
        )}

        {/* AI Recommendations */}
        <div className="bg-slate-900 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">🤖</span>
            <span className="text-xs font-bold text-brand-400">AI Recommendations</span>
          </div>
          <div className="flex flex-col gap-2">
            {aiRecs.map((rec, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-brand-400 text-xs flex-shrink-0">▸</span>
                <span className="text-xs text-slate-200 leading-relaxed">{rec}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Performance grade */}
        <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-4 dark:bg-slate-800">
          <div className="text-4xl">{grade.emoji}</div>
          <div>
            <div className={`text-base font-bold ${grade.color}`}>{grade.label}</div>
            <div className="text-xs text-gray-400 mt-0.5 dark:text-slate-500">
              {result.score >= 80 ? 'Excellent performance! You\'re well prepared.' : 'Keep practicing to improve your score.'}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center justify-center gap-2 bg-transparent border-2 border-brand-600 text-brand-700 dark:text-brand-400 font-bold py-3 rounded-2xl text-sm active:scale-95 transition-all"
          >
            <RotateCcw size={16} /> Try Again
          </button>
          <button className="flex items-center justify-center gap-2 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 dark:shadow-black/30 active:scale-95 transition-all">
            <Share2 size={16} /> Share Score
          </button>
        </div>

        <button
          onClick={() => navigate('/subjects')}
          className="flex items-center justify-between bg-white rounded-2xl shadow-sm p-4 active:scale-[0.99] transition-all dark:bg-slate-800"
        >
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Continue Studying</span>
          <ChevronRight size={18} className="text-brand-600" />
        </button>
      </div>

      <BottomNav />

      {/* Beat 2: full-screen streak takeover — flame, big count-up, rolling
          7-day strip with completed/frozen/missed status, Continue button.
          Plays every day the streak moves, not just the first time; only
          the "Streak started" copy inside it is one-time. */}
      {hasStreakReveal && overlayStage === 'streak' && (
        <div
          className={`fixed inset-0 z-50 flex flex-col items-center justify-center px-6 transition-opacity duration-300 overflow-hidden ${
            milestone ? 'bg-gradient-to-b from-amber-950 via-slate-900 to-brand-950' : 'bg-gradient-to-b from-slate-900 to-brand-950'
          } ${streakVisible ? 'opacity-100' : 'opacity-0'}`}
        >
          {/* Confetti — milestone days only (7/30/100). Decorative, so
              pointer-events-none keeps it from ever blocking the Continue
              tap underneath it. */}
          {milestone && streakVisible && (
            <div className="absolute inset-0 pointer-events-none">
              {confettiPieces.map(p => (
                <span
                  key={p.id}
                  className="absolute top-0 rounded-sm"
                  style={{
                    left: `${p.left}%`,
                    width: p.size,
                    height: p.size,
                    backgroundColor: p.color,
                    animation: `confetti-fall ${p.duration}s ease-in ${p.delay}s forwards`,
                  }}
                />
              ))}
              <style>{`
                @keyframes confetti-fall {
                  0% { transform: translateY(-24px) rotate(0deg); opacity: 1; }
                  100% { transform: translateY(520px) rotate(720deg); opacity: 0; }
                }
              `}</style>
            </div>
          )}

          {milestone && (
            <div
              className={`flex items-center gap-1.5 bg-amber-400/20 border border-amber-300/40 rounded-full px-4 py-1.5 mb-4 transition-all duration-500 ${
                streakVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
              }`}
            >
              <span className="text-base">{milestone.emoji}</span>
              <span className="text-xs font-bold text-amber-200">{milestone.title}</span>
            </div>
          )}

          <div
            className={`flex flex-col items-center transition-all duration-500 ${
              streakVisible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-90 translate-y-4'
            }`}
          >
            <Flame
              size={milestone ? 104 : 88}
              className={milestone ? 'text-amber-400 drop-shadow-[0_0_32px_rgba(251,191,36,0.65)]' : 'text-orange-400 drop-shadow-[0_0_24px_rgba(251,146,60,0.5)]'}
              fill="currentColor"
            />
            {/* key={displayedStreak} remounts this element on every count-up
                step, restarting the CSS animation each time. Intermediate
                digits during counting (2, 3...) get a quick snappy pop so
                the counting rhythm stays fast; the FINAL number gets a
                slower, more dramatic rise-then-settle (~4s) — the actual
                "landing" moment, not just another counting tick. */}
            <div
              key={displayedStreak}
              className={`font-black text-white mt-2 tabular-nums ${milestone ? 'text-7xl' : 'text-6xl'}`}
              style={{
                animation:
                  displayedStreak === finalStreakValue
                    ? 'streak-pop-rest 4s cubic-bezier(0.22, 1, 0.36, 1) forwards'
                    : 'streak-pop-quick 0.3s ease-out',
              }}
            >
              {displayedStreak}
            </div>
            <div className={`font-bold mt-1 ${milestone ? 'text-lg text-amber-300' : 'text-base text-orange-300'}`}>day streak</div>
          </div>
          <style>{`
            @keyframes streak-pop-quick {
              0% { transform: scale(1); }
              40% { transform: scale(1.2); }
              100% { transform: scale(1); }
            }
            @keyframes streak-pop-rest {
              0%   { transform: scale(1); }
              12%  { transform: scale(1.4); }
              28%  { transform: scale(0.94); }
              45%  { transform: scale(1.12); }
              62%  { transform: scale(0.98); }
              80%  { transform: scale(1.03); }
              100% { transform: scale(1); }
            }
          `}</style>

          {/* 7-day strip */}
          <div className="flex items-center gap-2 mt-8">
            {(weekStrip ?? new Array<WeekStripDay | undefined>(7).fill(undefined)).map((day, i) => {
              if (!day) {
                return <div key={i} className="w-9 h-9 rounded-full bg-white/10 animate-pulse" />
              }
              const isCompleted = day.status === 'completed'
              const isFrozen = day.status === 'frozen'
              const isUnregistered = day.status === 'not_registered'
              return (
                <div key={day.date} className="flex flex-col items-center gap-1">
                  <span className={`text-[10px] font-semibold ${isUnregistered ? 'text-slate-600' : 'text-slate-400'}`}>{day.label}</span>
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center ${
                      day.isToday && isCompleted
                        ? milestone ? 'bg-amber-400' : 'bg-sky-400'
                        : isCompleted
                        ? milestone ? 'bg-amber-500' : 'bg-orange-500'
                        : isFrozen
                        ? 'bg-sky-500/70'
                        : isUnregistered
                        ? 'bg-transparent'
                        : 'bg-white/10 border border-white/15'
                    }`}
                  >
                    {isCompleted && <Check size={16} className="text-white" strokeWidth={3} />}
                    {isFrozen && <Snowflake size={15} className="text-white" />}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="text-xs text-slate-300 text-center mt-6 max-w-[260px]">
            {milestone
              ? milestone.sub
              : result.streakStarted
              ? 'Streak started! Come back tomorrow to keep it going.'
              : weekStrip?.some(d => d.status === 'frozen')
              ? 'A Streak Freeze covered your missed day — get a perfect week next time by not needing one!'
              // FIX: only count days the account actually existed for —
              // otherwise every().every() on pre-signup "missed" days made
              // this show "Perfect week!" incorrectly, or conversely
              // Array.every() on a mix including days that were never
              // fairly "missable" gave a misleading read either way.
              : weekStrip?.filter(d => d.status !== 'not_registered').every(d => d.status === 'completed')
              ? 'Perfect week! Keep the flame burning 🔥'
              : 'Come back tomorrow to keep your streak alive!'}
          </div>

          <button
            onClick={handleStreakContinue}
            className={`mt-10 w-full max-w-xs font-bold py-3.5 rounded-2xl text-sm shadow-lg active:scale-95 transition-all ${
              milestone
                ? 'bg-gradient-to-r from-amber-500 to-amber-400 text-amber-950'
                : 'bg-gradient-to-r from-brand-600 to-brand-500 text-white'
            }`}
          >
            Continue
          </button>
        </div>
      )}

      {/* Weekly commitment question — asked once, right after the very
          first quiz completion ever, and only if not already answered. */}
      {overlayStage === 'goal' && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 to-brand-950 px-6">
          <div className="text-4xl mb-3">🎯</div>
          <h2 className="text-xl font-black text-white text-center">How many days a week<br />do you want to study?</h2>
          <p className="text-xs text-slate-400 text-center mt-2 max-w-[260px]">
            We'll use this to help remind you — you can always beat your goal.
          </p>
          <div className="flex flex-col gap-3 w-full max-w-xs mt-8">
            {GOAL_OPTIONS.map(opt => (
              <button
                key={opt.days}
                disabled={savingGoal}
                onClick={() => handlePickGoal(opt.days)}
                className="w-full bg-white/10 hover:bg-white/15 border border-white/15 text-white font-bold py-3.5 rounded-2xl text-sm active:scale-95 transition-all disabled:opacity-50"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
