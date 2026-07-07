import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, Subject } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
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

export default function SubjectsScreen() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const classLevel = profile?.class_level ?? 'Class 9'
      const { data } = await supabase
        .from('subjects')
        .select('*')
        .eq('class_level', classLevel)
        .order('name')
      if (data) setSubjects(data)

      if (data && profile) {
        const results: Record<string, number> = {}
        for (const sub of data) {
          const { data: rows } = await supabase
            .from('user_progress')
            .select('completion_pct')
            .eq('user_id', profile.id)
            .eq('subject_id', sub.id)
          results[sub.id] = rows && rows.length > 0
            ? Math.round(rows.reduce((acc, r) => acc + r.completion_pct, 0) / rows.length)
            : 0
        }
        setProgress(results)
      }
      setLoading(false)
    }
    load()
  }, [profile])

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <GreenHero>
        <h1 className="text-xl font-black">My Subjects</h1>
        <p className="text-emerald-100 text-xs mt-0.5">
          {profile?.class_level ?? 'Class 9'} · Balochistan Board · {subjects.length} Active Subjects
        </p>
      </GreenHero>

      <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 gap-3 content-start">
        {loading && (
          <div className="col-span-2 flex justify-center py-10">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {subjects.map(sub => {
          const colors = SUBJECT_COLORS[sub.color_class] ?? SUBJECT_COLORS.bio
          const progressColor = PROGRESS_COLORS[sub.color_class] ?? PROGRESS_COLORS.bio
          const pct = progress[sub.id] ?? 0
          return (
            <button
              key={sub.id}
              onClick={() => navigate(`/chapters/${sub.id}`)}
              className={`${colors.bg} ${colors.border} border-2 rounded-2xl p-3 text-left active:scale-95 transition-all`}
            >
              <div className="text-3xl mb-1">{sub.emoji}</div>
              <div className={`text-sm font-bold ${colors.text}`}>{sub.name}</div>
              <div className={`text-xs mt-0.5 opacity-70 ${colors.text}`}>
                {sub.chapter_count} Ch · {sub.mcq_count} MCQs
              </div>
              <div className="mt-2 h-1.5 bg-white/60 rounded-full overflow-hidden">
                <div className={`h-full bg-gradient-to-r ${progressColor} rounded-full`} style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between items-center mt-1">
                <span className={`text-[10px] font-bold ${colors.text}`}>{pct}%</span>
                <span className={`text-[10px] font-bold bg-white/60 px-2 py-0.5 rounded-full ${colors.text}`}>Go →</span>
              </div>
            </button>
          )
        })}
      </div>

      <BottomNav />
    </div>
  )
}
