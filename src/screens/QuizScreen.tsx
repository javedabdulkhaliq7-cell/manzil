import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { X, Bookmark } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { FREE_MCQ_LIMIT } from '../lib/constants'
import { updateProfileAfterAttempt, updateChapterProgress, mcqsRemainingToday } from '../lib/progress'
import { shuffleMcqOptions, ShuffledMcq } from '../lib/shuffleMcqOptions'
import { drawQuestions } from '../lib/randomDrawEngine'
import FractionText from '../components/FractionText'
import DiagramRenderer from '../components/DiagramRenderer'

type Answer = { mcq_id: string; chosen: string; correct: boolean; time: number }

function shuffleArray<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5)
}

export default function QuizScreen() {
  const { chapterId } = useParams<{ chapterId: string }>()
  const { user, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()

  const [mcqs, setMcqs] = useState<ShuffledMcq[]>([])
  const [chapterTitle, setChapterTitle] = useState('')
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [timeLeft, setTimeLeft] = useState(600) // 10 min
  const [qTime, setQTime] = useState(0)
  const [loading, setLoading] = useState(true)
  const [bookmarked, setBookmarked] = useState<Set<number>>(new Set())

  useEffect(() => {
    // Wait for auth to resolve — the draw engine needs a real user.id to
    // track per-student "used" state. Firing this with no user would fall
    // back to fetching nothing / never excluding anything.
    if (!user) return
    const currentUser = user

    async function load() {
      if (!chapterId) {
        setLoading(false)
        return
      }

      // Previously: a raw `.select('*').limit(20)` query with no ordering,
      // which silently returned the same ~20 rows every time (Postgres has
      // no guaranteed order without an ORDER BY, but in practice it's
      // stable insertion/PK order) — shuffleArray() below only reshuffled
      // *display* order of that fixed set, it never changed *which*
      // questions were fetched. drawQuestions() actually rotates through
      // the full chapter pool and excludes anything this user has already
      // seen (per-chapter), reshuffling only once the pool is exhausted.
      const result = await drawQuestions({
        userId: currentUser.id,
        scope: 'chapter',
        scopeId: chapterId,
        sources: [{ table: 'mcqs', count: 20 }],
      })
      const rows = result['mcqs'] ?? []
      setMcqs(shuffleArray(rows).map(shuffleMcqOptions))

      const { data: ch } = await supabase.from('chapters').select('title, subject_id').eq('id', chapterId).single()
      if (ch) {
        setChapterTitle(ch.title)
        setSubjectId(ch.subject_id)
      }
      setLoading(false)
    }
    load()
  }, [chapterId, user])

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { submitQuiz(); return 0 }
        return t - 1
      })
      setQTime(q => q + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const submitQuiz = useCallback(async () => {
    if (!user || !profile || mcqs.length === 0) return
    const correct = answers.filter(a => a.correct).length
    const wrong = answers.filter(a => !a.correct && a.chosen !== '').length
    const skipped = mcqs.length - answers.length
    const score = Math.round((correct / mcqs.length) * 100)
    const xpEarned = correct * 10 + (score === 100 ? 50 : 0) + 20

    await supabase.from('quiz_attempts').insert({
      user_id: user.id,
      chapter_id: chapterId ?? null,
      subject_id: subjectId,
      score,
      total: mcqs.length,
      correct,
      wrong,
      skipped,
      time_taken: 600 - timeLeft,
      xp_earned: xpEarned,
      answers: answers,
    })

    // Update XP, streak, and today's MCQ usage on the profile
    await updateProfileAfterAttempt(user.id, profile, xpEarned, mcqs.length)

    // Only track per-chapter progress when this was a chapter-specific quiz
    if (chapterId) {
      await updateChapterProgress(user.id, chapterId, subjectId, score, mcqs.length)
    }

    await refreshProfile()

    navigate('/quiz-results', {
      state: { score, total: mcqs.length, correct, wrong, skipped, xpEarned, timeTaken: 600 - timeLeft }
    })
  }, [answers, mcqs, timeLeft, user, profile, chapterId, subjectId, navigate, refreshProfile])

  function handleChoose(label: string) {
    if (revealed) return
    setChosen(label)
    setRevealed(true)
    const mcq = mcqs[current]
    const opt = mcq.options.find(o => o.label === label)
    const isCorrect = opt?.isCorrect ?? false
    setAnswers(prev => [...prev, { mcq_id: mcq.id, chosen: label, correct: isCorrect, time: qTime }])
  }

  function handleNext() {
    if (current + 1 >= mcqs.length) {
      submitQuiz()
    } else {
      setCurrent(c => c + 1)
      setChosen(null)
      setRevealed(false)
      setQTime(0)
    }
  }

  function handleSkip() {
    if (current + 1 >= mcqs.length) {
      submitQuiz()
    } else {
      setCurrent(c => c + 1)
      setChosen(null)
      setRevealed(false)
      setQTime(0)
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-slate-950">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (profile && mcqsRemainingToday(profile, FREE_MCQ_LIMIT) <= 0) {
    return (
      <div className="flex flex-col h-screen bg-gray-50 items-center justify-center gap-4 px-6 text-center dark:bg-slate-950">
        <div className="text-5xl">⏳</div>
        <div className="font-bold text-amber-800 text-base">Daily MCQ Limit Reached</div>
        <div className="text-sm text-gray-500 dark:text-slate-400">You've used today's free MCQs. Upgrade to Premium for unlimited practice.</div>
        <button onClick={() => navigate('/profile')} className="bg-amber-500 text-white text-sm font-bold px-6 py-3 rounded-xl">
          Upgrade to Premium
        </button>
        <button onClick={() => navigate(-1)} className="text-gray-400 text-sm dark:text-slate-500">Go Back</button>
      </div>
    )
  }

  if (mcqs.length === 0) {
    return (
      <div className="flex flex-col h-screen bg-gray-50 items-center justify-center gap-4 px-6 dark:bg-slate-950">
        <div className="text-5xl">📭</div>
        <div className="text-center">
          <div className="font-bold text-slate-900 mb-1 dark:text-slate-100">No MCQs Available</div>
          <div className="text-sm text-gray-400 dark:text-slate-500">MCQs for this chapter are being prepared.</div>
        </div>
        <button onClick={() => navigate(-1)} className="bg-brand-600 text-white px-6 py-3 rounded-xl font-bold text-sm">Go Back</button>
      </div>
    )
  }

  const mcq = mcqs[current]
  const progress = ((current + 1) / mcqs.length) * 100
  const mins = Math.floor(timeLeft / 60)
  const secs = timeLeft % 60

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 flex-shrink-0 dark:bg-slate-800 dark:border-slate-700">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-600 dark:text-slate-500">
          <X size={20} />
        </button>
        <span className="text-sm font-bold text-slate-900 dark:text-slate-100">Q{current + 1} of {mcqs.length}</span>
        <span className="bg-gradient-to-r from-brand-700 to-brand-500 text-white text-xs font-bold px-3 py-1.5 rounded-xl">
          ⏱ {mins}:{secs.toString().padStart(2,'0')}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-gray-100 flex-shrink-0 dark:bg-slate-700">
        <div className="h-full bg-gradient-to-r from-brand-600 to-brand-400 transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {/* Chapter tag — real title, not a hardcoded placeholder */}
        <div className="flex items-center gap-2">
          <span className="bg-brand-100 dark:bg-brand-900/60 text-brand-700 dark:text-brand-300 text-[10px] font-bold px-2.5 py-1 rounded-full dark:text-brand-400">
            🧬 {chapterTitle || 'Mixed Practice'}
          </span>
          <button
            onClick={() => setBookmarked(b => { const n = new Set(b); n.has(current) ? n.delete(current) : n.add(current); return n })}
            className={`ml-auto ${bookmarked.has(current) ? 'text-amber-500' : 'text-gray-300 dark:text-slate-600'}`}
          >
            <Bookmark size={18} fill={bookmarked.has(current) ? 'currentColor' : 'none'} />
          </button>
        </div>

        {/* Question */}
        <p className="text-base font-bold text-slate-900 leading-snug dark:text-slate-100"><FractionText text={mcq.question} /></p>

        {/* Diagram — only for MCQs that reference one (e.g. "look at the diagram below") */}
        {mcq.diagram_type && mcq.diagram_data && (
          <DiagramRenderer diagramType={mcq.diagram_type} diagramData={mcq.diagram_data} />
        )}

        {/* Options — rendered from the shuffled order, not raw option_a/b/c/d */}
        <div className="flex flex-col gap-2.5">
          {mcq.options.map(opt => {
            const isChosen = chosen === opt.label
            let style = 'border-gray-200 bg-white text-gray-700 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
            if (revealed) {
              if (opt.isCorrect) style = 'border-brand-400 bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-300'
              else if (isChosen) style = 'border-red-400 bg-red-50 text-red-800 dark:bg-red-950/40'
            } else if (isChosen) style = 'border-brand-400 bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-300'

            return (
              <button
                key={opt.label}
                onClick={() => handleChoose(opt.label)}
                disabled={revealed}
                className={`flex items-center gap-3 border-2 rounded-2xl px-4 py-3 text-sm text-left transition-all active:scale-[0.99] ${style}`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 border ${
                  revealed && opt.isCorrect ? 'bg-brand-500 border-brand-500 text-white' :
                  revealed && isChosen ? 'bg-red-500 border-red-500 text-white' :
                  'border-current'
                }`}>{opt.label}</span>
                <span className="flex-1"><FractionText text={opt.text} /></span>
                {revealed && opt.isCorrect && <span className="text-brand-500 text-base">✓</span>}
                {revealed && isChosen && !opt.isCorrect && <span className="text-red-500 text-base">✗</span>}
              </button>
            )
          })}
        </div>

        {/* Explanation */}
        {revealed && mcq.explanation && (
          <div className="bg-brand-50 border border-brand-200 rounded-2xl p-4 animate-in fade-in dark:bg-brand-950/40">
            <div className="text-xs font-bold text-brand-700 mb-1 dark:text-brand-400">💡 Explanation</div>
            <p className="text-xs text-brand-800 leading-relaxed dark:text-brand-300"><FractionText text={mcq.explanation} /></p>
          </div>
        )}
      </div>

      {/* Bottom buttons */}
      <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0 dark:bg-slate-800 dark:border-slate-700">
        {!revealed && (
          <button onClick={handleSkip} className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm active:scale-95 transition-all dark:text-slate-400 dark:border-slate-700">
            Skip
          </button>
        )}
        {revealed && (
          <button onClick={handleNext} className="flex-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">
            {current + 1 >= mcqs.length ? 'See Results 🎉' : 'Next Question →'}
          </button>
        )}
      </div>
    </div>
  )
}
