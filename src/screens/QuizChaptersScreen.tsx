import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Lock, Shuffle } from 'lucide-react'
import { supabase, Chapter, Subject } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import BottomNav from '../components/BottomNav'
import GreenHero from '../components/GreenHero'

// Second step of the Quiz flow (after QuizSubjectsScreen). Lists every
// chapter in the chosen subject — tapping one starts a quiz scoped to
// just that chapter (existing /quiz/:chapterId route, unchanged). The
// "Random Full-Subject Quiz" button starts a quiz drawing from every
// chapter in the subject at once (/quiz/random/:subjectId) — each
// question is tagged with its source chapter inside QuizScreen.
export default function QuizChaptersScreen() {
  const { subjectId } = useParams<{ subjectId: string }>()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [subject, setSubject] = useState<Subject | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)

  const isPremium = profile?.plan === 'premium'

  useEffect(() => {
    async function load() {
      const [{ data: sub }, { data: chs }] = await Promise.all([
        supabase.from('subjects').select('*').eq('id', subjectId).single(),
        supabase.from('chapters').select('*').eq('subject_id', subjectId).order('number'),
      ])
      if (sub) setSubject(sub)
      if (chs) setChapters(chs)
      setLoading(false)
    }
    load()
  }, [subjectId])

  function isLocked(ch: Chapter) {
    return !!ch.is_locked && !isPremium
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      <GreenHero>
        <button onClick={() => navigate(-1)} className="text-brand-200 mb-2 flex items-center gap-1 text-xs">
          <ChevronLeft size={14} /> Back
        </button>
        <div className="flex items-center gap-3">
          <div className="text-3xl">{subject?.emoji ?? '📚'}</div>
          <div>
            <h1 className="text-xl font-black">{subject?.name ?? 'Quiz'}</h1>
            <p className="text-brand-100 text-xs">{subject?.class_level} · Balochistan Board · {chapters.length} Chapters</p>
          </div>
        </div>
      </GreenHero>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {loading && (
          <div className="flex justify-center py-10">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && subjectId && (
          <button
            onClick={() => navigate(`/quiz/random/${subjectId}`)}
            className="flex items-center gap-3 bg-gradient-to-r from-brand-700 to-brand-500 rounded-2xl shadow-lg shadow-brand-200 dark:shadow-black/30 p-4 text-left active:scale-[0.99] transition-all mb-1"
          >
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <Shuffle size={18} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-black text-white">Random Full-Subject Quiz</div>
              <div className="text-[11px] text-brand-100">Mixed questions from every chapter in {subject?.name ?? 'this subject'}</div>
            </div>
          </button>
        )}

        {!loading && chapters.length === 0 && (
          <div className="text-center text-xs text-gray-400 dark:text-slate-500 py-6">No chapters available yet.</div>
        )}

        {chapters.map(ch => {
          const locked = isLocked(ch)
          return (
            <button
              key={ch.id}
              onClick={() => !locked && navigate(`/quiz/${ch.id}`)}
              className={`flex items-center gap-3 bg-white rounded-2xl shadow-sm p-3 text-left active:scale-[0.99] transition-all dark:bg-slate-800 border border-gray-100 dark:border-slate-700 ${locked ? 'opacity-50' : ''}`}
            >
              <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 bg-brand-100 dark:bg-brand-900/60 text-brand-700 dark:text-brand-300">
                {ch.number}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-900 truncate dark:text-slate-100">{ch.title}</div>
                <div className="text-xs text-gray-400 dark:text-slate-500">{ch.mcq_count} MCQs</div>
              </div>
              <div className="flex-shrink-0">
                {locked
                  ? <Lock size={14} className="text-gray-400 dark:text-slate-500" />
                  : <span className="text-[10px] bg-brand-100 dark:bg-brand-900/60 text-brand-700 dark:text-brand-300 font-bold px-2 py-1 rounded-full dark:text-brand-400">Quiz →</span>}
              </div>
            </button>
          )
        })}
      </div>

      <BottomNav />
    </div>
  )
}
