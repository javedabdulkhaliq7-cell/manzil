import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { supabase, Subject } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { SUBJECT_COLORS } from '../lib/constants'
import BottomNav from '../components/BottomNav'
import GreenHero from '../components/GreenHero'

// What the bottom-nav Quiz tab now lands on. Previously the Quiz tab
// linked straight to bare `/quiz`, which is QuizScreen with no chapterId —
// that screen has always required a chapter to draw questions, so it
// dead-ended on "No MCQs Available" every single time.
//
// One row per subject (not a chapter picker — chapter-specific quizzing
// already exists via Subjects → Chapters → Chapter Detail). Tapping a
// subject here starts a random quiz drawing from every chapter in that
// subject at once; QuizScreen tags each question with its source chapter.
export default function QuizSubjectsScreen() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [subjects, setSubjects] = useState<Subject[]>([])
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
      setLoading(false)
    }
    load()
  }, [profile])

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      <GreenHero>
        <h1 className="text-xl font-black">⚡ Quiz</h1>
        <p className="text-brand-100 text-xs mt-0.5">
          Pick a subject to start a random quiz — {profile?.class_level ?? 'Class 9'} · Balochistan Board
        </p>
      </GreenHero>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {loading && (
          <div className="flex justify-center py-10">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {subjects.map(sub => {
          const colors = SUBJECT_COLORS[sub.color_class] ?? SUBJECT_COLORS.bio
          return (
            <button
              key={sub.id}
              onClick={() => navigate(`/quiz/random/${sub.id}`)}
              className="flex items-center gap-3 bg-white rounded-2xl shadow-sm p-3 text-left active:scale-[0.99] transition-all dark:bg-slate-800 border border-gray-100 dark:border-slate-700"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${colors.bg}`}>
                {sub.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-900 truncate dark:text-slate-100">{sub.name}</div>
                <div className="text-xs text-gray-400 dark:text-slate-500">{sub.chapter_count} Ch · {sub.mcq_count} MCQs</div>
              </div>
              <div className="flex-shrink-0 flex items-center gap-1">
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${colors.bg} ${colors.text}`}>Quiz</span>
                <ChevronRight size={16} className="text-gray-300 dark:text-slate-600" />
              </div>
            </button>
          )
        })}
      </div>

      <BottomNav />
    </div>
  )
}
