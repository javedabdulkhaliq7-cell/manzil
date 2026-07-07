import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Flame, Star, Clock, Trophy, Zap, AlertTriangle, BookOpen, Target, FileText, Bot } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { getRank } from '../lib/constants'
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
      const today = new Date().toISOString().split('T')[0]

      const { data: todayAttempts } = await supabase
        .from('quiz_attempts')
        .select('total')
        .eq('user_id', profile.id)
        .gte('created_at', today)
      if (todayAttempts) setTodayMCQs(todayAttempts.reduce((acc, a) => acc + a.total, 0))

      const { data: allAttempts } = await supabase
        .from('quiz_attempts')
        .select('score')
        .eq('user_id', profile.id)
      if (allAttempts && allAttempts.length > 0) {
        setAvgScore(Math.round(allAttempts.reduce((acc, a) => acc + a.score, 0) / allAttempts.length))
      }

      // Most recently touched, not-yet-complete chapter
      const { data: progressRows } = await supabase
        .from('user_progress')
        .select('chapter_id, completion_pct, chapters(title, subjects(emoji))')
        .eq('user_id', profile.id)
        .lt('completion_pct', 100)
        .order('chapter_id', { ascending: false })
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

      // Weakest chapter by lowest best_score, only where they've actually attempted something
      const { data: weakRows } = await supabase
        .from('user_progress')
        .select('chapter_id, best_score, chapters(title)')
        .eq('user_id', profile.id)
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

  const actions = [
    { label: 'Quick Quiz',  icon: Target,   color: 'from-emerald-100 to-emerald-50 text-emerald-700', path: '/quiz' },
    { label: 'Mock Test',   icon: FileText,  color: 'from-blue-100 to-blue-50 text-blue-700',          path: '/mock-test' },
    { label: 'AI Tutor',    icon: Bot,       color: 'from-slate-900 to-slate-800 text-emerald-400',    path: '/ai-tutor' },
    { label: 'Past Papers', icon: BookOpen,  color: 'from-violet-100 to-violet-50 text-violet-700',    path: '/past-papers' },
  ]

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <GreenHero className="pb-10">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs text-emerald-200 font-medium">Good morning 👋</div>
            <div className="text-xl font-black">{name}</div>
            <div className="text-xs text-emerald-100 mt-0.5">{profile.class_level} · {profile.district} · Balochistan Board</div>
          </div>
          <div className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center text-2xl">👦</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white/20 rounded-full px-3 py-1">
            <Flame size={13} className="text-orange-300" />
            <span className="text-xs font-bold">{profile.streak_days} Day Streak</span>
          </div>
          <div className="flex items-center gap-1.5 bg-white/20 rounded-full px-3 py-1">
            <Star size={13} className="text-yellow-300" />
            <span className="text-xs font-bold">{rank.badge} {rank.name}</span>
          </div>
        </div>
      </GreenHero>

      {/* Stat cards floating over hero */}
      <div className="px-4 -mt-5 z-10">
        <div className="bg-white rounded-2xl shadow-md p-3 grid grid-cols-3 divide-x divide-gray-100">
          {[
            { val: todayMCQs, label: 'MCQs Today', icon: Target,  color: 'text-slate-900' },
            { val: avgScore !== null ? `${avgScore}%` : '—', label: 'Avg Score', icon: Star, color: 'text-emerald-600' },
            { val: `${profile.xp}`, label: 'Total XP', icon: Trophy, color: 'text-violet-600' },
          ].map(({ val, label, color }) => (
            <div key={label} className="flex flex-col items-center px-1 py-1">
              <span className={`text-sm font-black ${color}`}>{val}</span>
              <span className="text-[9px] text-gray-400 font-medium text-center">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {/* Continue learning */}
        {continueChapter ? (
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">▶ Continue Learning</div>
            <button onClick={() => navigate(`/chapter/${continueChapter.id}`)} className="flex items-center gap-3 w-full text-left">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-100 to-emerald-50 flex items-center justify-center text-xl flex-shrink-0">{continueChapter.subjectEmoji}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-900 truncate">{continueChapter.title}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">Balochistan Board · {profile.class_level}</div>
                <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full" style={{ width: `${continueChapter.pct}%` }} />
                </div>
                <div className="text-[10px] text-emerald-600 font-bold mt-1">{continueChapter.pct}% Complete</div>
              </div>
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm p-4 text-center">
            <div className="text-sm font-bold text-slate-900 mb-1">Ready to start?</div>
            <div className="text-xs text-gray-400 mb-3">Pick a subject and begin your first chapter</div>
            <button onClick={() => navigate('/subjects')} className="text-xs font-bold text-emerald-600">Browse Subjects →</button>
          </div>
        )}

        {/* Quick Actions */}
        <div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Quick Actions</div>
          <div className="grid grid-cols-2 gap-3">
            {actions.map(({ label, icon: Icon, color, path }) => (
              <button
                key={label}
                onClick={() => navigate(path)}
                className={`bg-gradient-to-br ${color} rounded-2xl p-4 text-center active:scale-95 transition-all`}
              >
                <Icon size={22} className="mx-auto mb-1.5" />
                <div className="text-xs font-bold">{label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Weak chapter alert — only shown once there's real data behind it */}
        {weakChapter && weakChapter.bestScore < 60 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 flex items-center gap-3">
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
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-slate-900">{rank.badge} {rank.name} · {profile.xp} XP</span>
            <span className="text-xs text-gray-400">Next: {getRank(profile.xp + 1).name}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all" style={{ width: `${Math.min((profile.xp % 500) / 5, 100)}%` }} />
          </div>
          <div className="text-[10px] text-gray-400 mt-1">Earn XP by completing quizzes and maintaining streaks</div>
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
