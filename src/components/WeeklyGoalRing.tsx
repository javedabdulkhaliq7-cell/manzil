import { useEffect, useState } from 'react'
import { Target } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getStudyDaysThisWeek } from '../lib/progress'

/**
 * The secondary, soft weekly-goal ring for the Stats tab (Doc 2, Section 1:
 * "Weekly Commitment Question"). Deliberately separate from the daily flame
 * streak — per the spec, the two numbers must never compete on the same
 * screen, so this renders nothing at all until a goal has actually been
 * set (i.e. the student has answered the one-time prompt on
 * QuizResultsScreen after their first-ever completion).
 *
 * Self-contained: fetches its own profile + this-week count, so it can be
 * dropped into any screen with <WeeklyGoalRing /> and no props.
 */
export default function WeeklyGoalRing() {
  const { profile } = useAuth()
  const [studiedDays, setStudiedDays] = useState<number | null>(null)

  useEffect(() => {
    if (!profile || profile.weekly_goal_days == null) return
    getStudyDaysThisWeek(profile.id).then(setStudiedDays)
  }, [profile])

  if (!profile || profile.weekly_goal_days == null) return null

  const goal = profile.weekly_goal_days
  const studied = studiedDays ?? 0
  const pct = Math.min(1, studied / goal)
  const circumference = 2 * Math.PI * 30
  const dashOffset = circumference * (1 - pct)
  const goalLabel = goal === 7 ? 'Every day' : `${goal} days/week`
  const met = studied >= goal

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-4 dark:bg-slate-800">
      <div className="relative w-16 h-16 flex-shrink-0">
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" strokeWidth="6" className="text-gray-100 dark:text-slate-700" />
          <circle
            cx="32" cy="32" r="30" fill="none"
            stroke="currentColor" strokeWidth="6"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform="rotate(-90 32 32)"
            className={`transition-all duration-700 ${met ? 'text-brand-500' : 'text-brand-400'}`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <Target size={18} className="text-brand-600 dark:text-brand-400" />
        </div>
      </div>
      <div>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wide dark:text-slate-500">Weekly Goal</div>
        <div className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
          Goal: {goalLabel} — this week: {studied}/{goal}
        </div>
        {met && (
          <div className="text-[11px] text-brand-600 dark:text-brand-400 font-semibold mt-0.5">Goal reached! 🎉</div>
        )}
      </div>
    </div>
  )
}
