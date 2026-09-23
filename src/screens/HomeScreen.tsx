import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Flame, Star, Clock, Trophy, Zap, AlertTriangle, BookOpen, Target, FileText, Bot, Snowflake, Heart } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { getRank } from '../lib/constants'
import { computeStreakStatus, startOfTodayISO, heartsRemaining } from '../lib/progress'
import BottomNav from '../components/BottomNav'
import GreenHero from '../components/GreenHero'

type ContinueChapter = { id: string; title: string; subjectEmoji: string; pct: number }
type WeakChapter = { id: string; title: string; bestScore: number }

export default function HomeScreen() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [todayMCQs, setTodayMCQs] = useState(0)
  const [avgScore, setAvgScore] = useState<number | null>(null)
  const [continueChapter, setContinueChapter] = useState<ContinueChapter | null>(null)
  const [weakChapter, setWeakChapter] = useState<WeakChapter | null>(null)

  useEffect(() => {
    async function loadStats() {
      if (!profile) return

      // FIX: previously `new Date().toISOString().split('T')[0]` — converts
      // to UTC before taking the date part, so for ~5 hours every day
      // (midnight-5am PKT) this undercounted "today" using yesterday's
      // date. startOfTodayISO() builds the boundary from local y/m/d
      // components instead, so it's correct at every hour.
      const { data: todayAttempts } = await supabase
        .from('quiz_attempts')
        .select('total')
        .eq('user_id', profile.id)
        .gte('created_at', startOfTodayISO())
      if (todayAttempts) setTodayMCQs(todayAttempts.reduce((acc, a) => acc + a.total, 0))

      const { data: allAttempts } = await supabase
        .from('quiz_attempts')
        .select('score')
        .eq('user_id', profile.id)
      if (allAttempts && allAttempts.length > 0) {
        setAvgScore(Math.round(allAttempts.reduce((acc, a) => acc + a.score, 0) / allAttempts.length))
      }

      // Most recently touched, not-yet-complete chapter. user_progress
      // previously had no timestamp column at all, so this used to order
      // by chapter_id (a random UUID) descending — showing an essentially
      // random incomplete chapter, not the one actually last worked on.
      // Now ordered by the real updated_at column (added via migration,
      // auto-maintained by a DB trigger on every update).
      //
      // Scoped to the student's currently selected class via !inner joins —
      // a plain embed (`chapters(...)`) doesn't filter rows, it just nulls
      // out unmatched fields, so without !inner this could surface a
      // chapter from a class the student switched away from.
      const { data: progressRows } = await supabase
        .from('user_progress')
        .select('chapter_id, completion_pct, chapters!inner(title, subjects!inner(emoji, class_level))')
        .eq('user_id', profile.id)
        .eq('chapters.subjects.class_level', profile.class_level)
        .lt('completion_pct', 100)
        .order('updated_at', { ascending: false })
        .limit(1)
      if (progressRows && progressRows.length > 0) {
        const row: any = progressRows[0]
        setContinueChapter({
          id: row.chapter_id,
          title: row.chapters?.title ?? 'Chapter',
          subjectEmoji: row.chapters?.subjects?.emoji ?? '📚',
          pct: row.completion_pct,
        })
      }

      // Weakest chapter by lowest best_score, only where they've actually
      // attempted something — same class-scoping fix as above.
      const { data: weakRows } = await supabase
        .from('user_progress')
        .select('chapter_id, best_score, chapters!inner(title, subjects!inner(class_level))')
        .eq('user_id', profile.id)
        .eq('chapters.subjects.class_level', profile.class_level)
        .gt('mcqs_attempted', 0)
        .order('best_score', { ascending: true })
        .limit(1)
      if (weakRows && weakRows.length > 0) {
        const row: any = weakRows[0]
        setWeakChapter({ id: row.chapter_id, title: row.chapters?.title ?? 'Chapter', bestScore: row.best_score })
      }
    }
    loadStats()
  }, [profile])

  if (!profile) return null

  const rank = getRank(profile.xp)
  const name = profile.full_name || profile.name || 'Student'

  // Streak display state — computed fresh on every render from
  // last_study_date/streak_days, so it's correct even if the student
  // hasn't opened a quiz since the freeze/break threshold passed
  // (i.e. this doesn't wait for a write; it reflects "if I did nothing
  // else, what would today's state be").
  const { status: streakStatus, displayStreak } = computeStreakStatus(
    profile.last_study_date,
    profile.streak_days
  )

  // Hearts — same persistent-badge style as the Quiz screen's header pill.
  // Hidden for Pro (unlimited, Infinity).
  const hearts = heartsRemaining(profile)

  const actions = [
    { label: 'Quick Quiz',  icon: Target,   color: 'from-brand-100 to-brand-50 text-brand-700 dark:from-brand-950/50 dark:to-brand-900/30 dark:text-brand-400', path: '/quiz' },
    { label: 'Mock Test',   icon: FileText,  color: 'from-blue-100 to-blue-50 text-blue-700 dark:from-blue-950/50 dark:to-blue-900/30 dark:text-blue-400',          path: '/mock-test' },
    { label: 'AI Tutor',    icon: Bot,       color: 'from-slate-900 to-slate-800 text-brand-400',    path: '/ai-tutor' },
    { label: 'Past Papers', icon: BookOpen,  color: 'from-violet-100 to-violet-50 text-violet-700 dark:from-violet-950/50 dark:to-violet-900/30 dark:text-violet-400',    path: '/past-papers' },
  ]

  // First-visit nudge: a subtle pulsing glow + arrow on Quick Quiz, shown
  // only until the student completes their first quiz, mock test, or
  // notes section (has_completed_first_task flips server-side wherever
  // that completion happens — see QuizResultsScreen etc.). Disappears
  // permanently after that, not just for this session.
  const showFirstTaskNudge = profile.has_completed_first_task === false

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      <GreenHero className="pb-10">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs text-brand-200 font-medium">Good morning 👋</div>
            <div className="text-xl font-bold">{name}</div>
            <div className="text-xs text-brand-100 mt-0.5">{profile.class_level} · {profile.district} · Balochistan Board</div>
          </div>
          <div className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center text-2xl">👦</div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`relative flex items-center gap-1.5 rounded-full px-3 py-1 ${
            streakStatus === 'frozen' ? 'bg-sky-400/30' : 'bg-white/20'
          }`}>
            <span className="relative inline-flex">
              <Flame
                size={13}
                className={streakStatus === 'frozen' ? 'text-sky-200' : 'text-orange-300'}
              />
              {streakStatus === 'frozen' && (
                <Snowflake size={9} className="absolute -top-1 -right-1.5 text-sky-100" />
              )}
            </span>
            <span className="text-xs font-bold">{displayStreak} Day Streak</span>
          </div>
          <div className="flex items-center gap-1.5 bg-white/20 rounded-full px-3 py-1">
            <Star size={13} className="text-yellow-300" />
            <span className="text-xs font-bold">{rank.badge} {rank.name}</span>
          </div>
          {hearts !== Infinity && (
            <div className="flex items-center gap-1.5 bg-white/20 rounded-full px-3 py-1">
              <Heart size={13} className="text-red-400" fill="currentColor" />
              <span className="text-xs font-bold">{hearts}</span>
            </div>
          )}
        </div>

        {streakStatus === 'frozen' && (
          <div className="mt-3 flex items-center gap-2 bg-sky-400/20 border border-sky-300/40 rounded-xl px-3 py-2">
            <Snowflake size={14} className="text-sky-100 flex-shrink-0" />
            <span className="text-[11px] font-semibold text-sky-50">
              Streak frozen — do a quiz today to save it!
            </span>
          </div>
        )}
      </GreenHero>

      {/* Stat cards floating over hero */}
      <div className="px-4 -mt-5 z-10">
        <div className="bg-white rounded-2xl shadow-md p-3 grid grid-cols-3 divide-x divide-gray-100 dark:bg-slate-800 dark:divide-slate-700">
          {[
            { val: todayMCQs, label: 'MCQs Today', icon: Target,  color: 'text-slate-900 dark:text-slate-100' },
            { val: avgScore !== null ? `${avgScore}%` : '—', label: 'Avg Score', icon: Star, color: 'text-brand-600' },
            { val: `${profile.xp}`, label: 'Total XP', icon: Trophy, color: 'text-violet-600' },
          ].map(({ val, label, color }) => (
            <div key={label} className="flex flex-col items-center px-1 py-1">
              <span className={`text-sm font-bold ${color}`}>{val}</span>
              <span className="text-[9px] text-gray-400 font-medium text-center dark:text-slate-500">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {/* Continue learning */}
        {continueChapter ? (
          <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3 dark:text-slate-500">▶ Continue Learning</div>
            <button onClick={() => navigate(`/chapter/${continueChapter.id}`)} className="flex items-center gap-3 w-full text-left">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-100 to-brand-50 dark:from-brand-950/50 dark:to-brand-900/30 flex items-center justify-center text-xl flex-shrink-0">{continueChapter.subjectEmoji}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-900 truncate dark:text-slate-100">{continueChapter.title}</div>
                <div className="text-[11px] text-gray-400 mt-0.5 dark:text-slate-500">Balochistan Board · {profile.class_level}</div>
                <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden dark:bg-slate-700">
                  <div className="h-full bg-gradient-to-r from-brand-600 to-brand-400 rounded-full" style={{ width: `${continueChapter.pct}%` }} />
                </div>
                <div className="text-[10px] text-brand-600 font-bold mt-1">Best Score: {continueChapter.pct}%</div>
              </div>
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm p-4 text-center dark:bg-slate-800">
            <div className="text-sm font-bold text-slate-900 mb-1 dark:text-slate-100">Ready to start?</div>
            <div className="text-xs text-gray-400 mb-3 dark:text-slate-500">Pick a subject and begin your first chapter</div>
            <button onClick={() => navigate('/subjects')} className="text-xs font-bold text-brand-600">Browse Subjects →</button>
          </div>
        )}

        {/* Quick Actions */}
        <div className={showFirstTaskNudge ? 'mt-9' : undefined}>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 dark:text-slate-500">Quick Actions</div>
          <div className="grid grid-cols-2 gap-3">
            {actions.map(({ label, icon: Icon, color, path }) => {
              const isNudged = label === 'Quick Quiz' && showFirstTaskNudge
              return (
                <div key={label} className={isNudged ? 'relative' : undefined}>
                  {/* A proper curved, hand-drawn-style pointing arrow — the
                      small straight lucide icon before wasn't obviously
                      "an arrow" at a glance. This one visibly swoops down
                      from the label and points straight into the card. */}
                  {isNudged && (
                    <div className="absolute -top-16 -right-2 flex flex-col items-end z-10 pointer-events-none animate-bounce">
                      <span className="text-[11px] font-bold text-brand-600 bg-white dark:bg-slate-800 px-2.5 py-1 rounded-full shadow-md whitespace-nowrap mb-0.5">
                        Start here! 👋
                      </span>
                      <svg width="60" height="52" viewBox="0 0 60 52" fill="none" className="text-brand-500 drop-shadow-sm">
                        <path d="M50 6 C 30 3, 12 16, 16 42" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" fill="none" />
                        <path d="M7 34 L16 42 L25 33" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </svg>
                    </div>
                  )}
                  <button
                    onClick={() => navigate(path)}
                    className={`relative bg-gradient-to-br ${color} rounded-2xl p-4 text-center active:scale-95 transition-all w-full ${
                      isNudged ? 'ring-2 ring-brand-400 animate-pulse' : ''
                    }`}
                  >
                    <div className="relative inline-block mb-1.5">
                      <Icon size={22} className="mx-auto" />
                      {isNudged && (
                        <span className="absolute -top-1 -right-1.5 w-3 h-3 rounded-full bg-brand-500 animate-ping" />
                      )}
                      {isNudged && (
                        <span className="absolute -top-1 -right-1.5 w-3 h-3 rounded-full bg-brand-500" />
                      )}
                    </div>
                    <div className="text-xs font-bold">{label}</div>
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* Weak chapter alert — only shown once there's real data behind it */}
        {weakChapter && weakChapter.bestScore < 60 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 flex items-center gap-3 dark:bg-amber-950/30">
            <AlertTriangle size={20} className="text-amber-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-amber-800">Weak Chapter Alert</div>
              <div className="text-xs text-amber-600 mt-0.5">{weakChapter.title} — Best score {weakChapter.bestScore}%. Practice now!</div>
            </div>
            <button onClick={() => navigate(`/chapter/${weakChapter.id}`)} className="text-xs font-bold text-amber-700 flex-shrink-0">
              Practice →
            </button>
          </div>
        )}

        {/* XP progress */}
        <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{rank.badge} {rank.name} · {profile.xp} XP</span>
            <span className="text-xs text-gray-400 dark:text-slate-500">Next: {getRank(profile.xp + 1).name}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden dark:bg-slate-700">
            <div className="h-full bg-gradient-to-r from-brand-600 to-brand-400 rounded-full transition-all" style={{ width: `${Math.min((profile.xp % 500) / 5, 100)}%` }} />
          </div>
          <div className="text-[10px] text-gray-400 mt-1 dark:text-slate-500">Earn XP by completing quizzes and maintaining streaks</div>
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
