import { useEffect, useState } from 'react'
import { Flame, Star } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase, Subject } from '../lib/supabase'
import { SUBJECT_COLORS } from '../lib/constants'
import BottomNav from '../components/BottomNav'
import GreenHero from '../components/GreenHero'

const PROGRESS_COLORS: Record<string, string> = {
  bio:  'from-emerald-600 to-emerald-400',
  chem: 'from-blue-600 to-blue-400',
  phy:  'from-orange-500 to-orange-400',
  math: 'from-violet-600 to-violet-400',
  eng:  'from-red-500 to-red-400',
  urdu: 'from-teal-600 to-teal-400',
}

type SubjectProgress = { subject: Subject; pct: number }

export default function ProgressScreen() {
  const { profile } = useAuth()
  const [totalAttempts, setTotalAttempts] = useState(0)
  const [subjectProgress, setSubjectProgress] = useState<SubjectProgress[]>([])
  const [weakestSubject, setWeakestSubject] = useState<SubjectProgress | null>(null)
  const [notStartedCount, setNotStartedCount] = useState(0)

  useEffect(() => {
    async function load() {
      if (!profile) return

      const { count } = await supabase.from('quiz_attempts').select('*', { count: 'exact', head: true }).eq('user_id', profile.id)
      setTotalAttempts(count ?? 0)

      const { data: subjects } = await supabase
        .from('subjects')
        .select('*')
        .eq('class_level', profile.class_level ?? 'Class 9')
        .order('name')

      if (subjects) {
        const results: SubjectProgress[] = []
        for (const sub of subjects) {
          const { data: rows } = await supabase
            .from('user_progress')
            .select('completion_pct')
            .eq('user_id', profile.id)
            .eq('subject_id', sub.id)
          const pct = rows && rows.length > 0
            ? Math.round(rows.reduce((acc, r) => acc + r.completion_pct, 0) / rows.length)
            : 0
          results.push({ subject: sub, pct })
        }
        setSubjectProgress(results)
        // A subject sitting at a true, never-touched 0% isn't "weak" — it's just
        // not started yet. Only subjects with at least one attempt count toward
        // "weakest", so the insight text below never contradicts an untouched 0%
        // shown in the list above it.
        const started = results.filter(r => r.pct > 0)
        setNotStartedCount(results.length - started.length)
        if (started.length > 0) {
          setWeakestSubject(started.reduce((a, b) => (a.pct <= b.pct ? a : b)))
        }
      }
    }
    load()
  }, [profile])

  if (!profile) return null

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <GreenHero>
        <h1 className="text-xl font-black">My Progress</h1>
        <p className="text-emerald-100 text-xs mt-0.5">{profile.full_name || profile.name} · {profile.class_level}</p>
        <div className="grid grid-cols-2 gap-3 mt-3">
          {[
            { icon: Flame, val: `${profile.streak_days} Days`, label: 'Study Streak', color: 'text-orange-300' },
            { icon: Star,  val: `${profile.xp} XP`,         label: 'Total Points',  color: 'text-yellow-300' },
          ].map(({ icon: Icon, val, label, color }) => (
            <div key={label} className="bg-white/20 rounded-xl p-3 flex items-center gap-2">
              <Icon size={18} className={color} />
              <div>
                <div className="text-base font-black">{val}</div>
                <div className="text-[10px] text-emerald-100">{label}</div>
              </div>
            </div>
          ))}
        </div>
      </GreenHero>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {/* Subject Progress — real, computed from user_progress */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <div className="text-xs font-bold text-slate-900 mb-3">Subject Progress</div>
          <div className="flex flex-col gap-3">
            {subjectProgress.map(({ subject, pct }) => {
              const colors = SUBJECT_COLORS[subject.color_class] ?? SUBJECT_COLORS.bio
              const progressColor = PROGRESS_COLORS[subject.color_class] ?? PROGRESS_COLORS.bio
              return (
                <div key={subject.id}>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs font-semibold text-slate-900">{subject.emoji} {subject.name}</span>
                    <span className={`text-xs font-bold ${colors.text}`}>{pct}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full bg-gradient-to-r ${progressColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
            {subjectProgress.length === 0 && (
              <div className="text-xs text-gray-400 text-center py-4">No subjects available for {profile.class_level} yet.</div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { val: totalAttempts, label: 'Total Quiz Attempts', icon: '🎯', bg: 'bg-emerald-50' },
            { val: `${profile.xp} XP`, label: 'Total Experience', icon: '⭐', bg: 'bg-amber-50' },
          ].map(({ val, label, icon, bg }) => (
            <div key={label} className={`${bg} rounded-2xl p-4 text-center`}>
              <div className="text-2xl mb-1">{icon}</div>
              <div className="text-xl font-black text-slate-900">{val}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Real insight — only shown once there's enough data to say something true */}
        {weakestSubject ? (
          <div className="bg-slate-900 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">📊</span>
              <span className="text-xs font-bold text-emerald-400">Weekly Insight</span>
            </div>
            <p className="text-xs text-slate-200 leading-relaxed">
              Among subjects you've started, {weakestSubject.subject.name} is your weakest at {weakestSubject.pct}%. A bit more practice there could help the most.
              {notStartedCount > 0 && ` You also haven't started ${notStartedCount} subject${notStartedCount > 1 ? 's' : ''} yet — worth a look too.`}
            </p>
          </div>
        ) : (
          <div className="bg-slate-900 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">📊</span>
              <span className="text-xs font-bold text-emerald-400">Weekly Insight</span>
            </div>
            <p className="text-xs text-slate-200 leading-relaxed">
              Complete a few chapters and quizzes — your personalized insights will show up here once there's enough data.
            </p>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  )
}
