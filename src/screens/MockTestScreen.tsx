import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { supabase, MCQ, Subject } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { updateProfileAfterAttempt } from '../lib/progress'
import FractionText from '../components/FractionText'
import DiagramRenderer from '../components/DiagramRenderer'

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5)
}

export default function MockTestScreen() {
  const { subjectId } = useParams<{ subjectId: string }>()
  const { user, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [subject, setSubject] = useState<Subject | null>(null)
  const [mcqs, setMcqs] = useState<MCQ[]>([])
  const [current, setCurrent] = useState(0)
  const [chosen, setChosen] = useState<string | null>(null)
  const [answered, setAnswered] = useState<Record<number, string>>({})
  const [timeLeft, setTimeLeft] = useState(1800) // 30 min
  const [loading, setLoading] = useState(true)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    async function load() {
      let query = supabase.from('mcqs').select('*')
      if (subjectId) query = query.eq('subject_id', subjectId)
      const { data } = await query.limit(30)
      if (data) setMcqs(shuffle(data))

      if (subjectId) {
        const { data: sub } = await supabase.from('subjects').select('*').eq('id', subjectId).single()
        if (sub) setSubject(sub)
      }
      setLoading(false)
    }
    load()
  }, [subjectId])

  useEffect(() => {
    if (!started) return
    const timer = setInterval(() => {
      setTimeLeft(t => { if (t <= 1) { submitTest(); return 0 } return t - 1 })
    }, 1000)
    return () => clearInterval(timer)
  }, [started])

  const submitTest = useCallback(async () => {
    const correct = mcqs.filter((mcq, i) => answered[i] === mcq.correct_option).length
    const score = mcqs.length > 0 ? Math.round((correct / mcqs.length) * 100) : 0
    const wrong = Object.keys(answered).length - correct
    const skipped = mcqs.length - Object.keys(answered).length
    const xpEarned = 75 + correct * 10
    const timeTaken = 1800 - timeLeft

    if (user && profile && mcqs.length > 0) {
      await supabase.from('quiz_attempts').insert({
        user_id: user.id,
        chapter_id: null,
        subject_id: subjectId ?? null,
        score,
        total: mcqs.length,
        correct,
        wrong,
        skipped,
        time_taken: timeTaken,
        xp_earned: xpEarned,
        answers: mcqs.map((mcq, i) => ({ mcq_id: mcq.id, chosen: answered[i] ?? '', correct: answered[i] === mcq.correct_option })),
      })
      await updateProfileAfterAttempt(user.id, profile, xpEarned, mcqs.length)
      await refreshProfile()
    }

    navigate('/quiz-results', {
      state: { score, total: mcqs.length, correct, wrong, skipped, xpEarned, timeTaken }
    })
  }, [mcqs, answered, timeLeft, navigate, user, profile, subjectId, refreshProfile])

  function handleChoose(opt: string) {
    setChosen(opt)
    setAnswered(prev => ({ ...prev, [current]: opt }))
  }

  function goTo(idx: number) {
    setChosen(answered[idx] ?? null)
    setCurrent(idx)
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-slate-950">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!started) {
    return (
      <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
        <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 pt-8 pb-8 text-white flex-shrink-0">
          <button onClick={() => navigate(-1)} className="text-brand-200 text-xs mb-3">✕ Cancel</button>
          <div className="text-4xl mb-2">📝</div>
          <h1 className="text-2xl font-black">{subject ? `${subject.name} Mock Test` : 'Mixed Subjects Mock Test'}</h1>
          <p className="text-brand-100 text-sm mt-1">{subject ? `${subject.name} · Balochistan Board` : 'Full Syllabus · Balochistan Board'}</p>
        </div>
        <div className="flex-1 px-4 py-6 flex flex-col gap-4">
          <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3 dark:text-slate-500">Test Info</div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Questions', val: mcqs.length },
                { label: 'Time', val: '30 min' },
                { label: 'Marks', val: mcqs.length },
              ].map(({ label, val }) => (
                <div key={label} className="bg-gray-50 rounded-xl p-3 text-center dark:bg-slate-950">
                  <div className="text-lg font-black text-slate-900 dark:text-slate-100">{val}</div>
                  <div className="text-[10px] text-gray-400 dark:text-slate-500">{label}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 dark:bg-amber-950/30">
            <div className="text-xs font-bold text-amber-800 mb-2">⚠️ Before You Start</div>
            <div className="flex flex-col gap-1.5">
              {['Visible countdown timer at all times', 'Auto-submits when time expires', 'Cannot go back once submitted'].map(t => (
                <div key={t} className="flex items-center gap-2 text-xs text-amber-700">
                  <span className="text-amber-500">•</span> {t}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-auto">
            <button
              onClick={() => setStarted(true)}
              className="w-full bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all"
            >
              Start Mock Test ▶
            </button>
          </div>
        </div>
      </div>
    )
  }

  const mcq = mcqs[current]
  const mins = Math.floor(timeLeft / 60)
  const secs = timeLeft % 60
  const answeredCount = Object.keys(answered).length

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      {/* Header */}
      <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 py-3 text-white flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-sm font-black">{subject ? `${subject.name} Mock Test` : 'Mixed Subjects Mock Test'}</div>
            <div className="text-xs text-brand-100">{subject ? subject.name : 'Full Syllabus'}</div>
          </div>
          <div className={`font-black text-lg px-3 py-1.5 rounded-xl ${timeLeft < 300 ? 'bg-red-500 text-white animate-pulse' : 'bg-white/20'}`}>
            ⏱ {mins}:{secs.toString().padStart(2,'0')}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { val: `Q${current + 1}`, label: 'Current' },
            { val: answeredCount, label: 'Answered' },
            { val: mcqs.length - answeredCount, label: 'Remaining' },
          ].map(({ val, label }) => (
            <div key={label} className="bg-white/20 rounded-lg py-1.5 text-center">
              <div className="text-sm font-black">{val}</div>
              <div className="text-[9px] text-brand-100">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Progress */}
      <div className="h-1 bg-gray-100 flex-shrink-0 dark:bg-slate-700">
        <div className="h-full bg-gradient-to-r from-brand-600 to-brand-400 transition-all" style={{ width: `${((current + 1) / mcqs.length) * 100}%` }} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        <div className="text-[10px] text-gray-400 font-semibold dark:text-slate-500">QUESTION {current + 1} OF {mcqs.length}</div>
        <p className="text-base font-bold text-slate-900 leading-snug dark:text-slate-100"><FractionText text={mcq.question} /></p>

        {(mcq as any).diagram_type && (mcq as any).diagram_data && (
          <DiagramRenderer diagramType={(mcq as any).diagram_type} diagramData={(mcq as any).diagram_data} />
        )}

        <div className="flex flex-col gap-2.5">
          {(['A','B','C','D'] as const).map(opt => {
            const isChosen = chosen === opt || answered[current] === opt
            return (
              <button
                key={opt}
                onClick={() => handleChoose(opt)}
                className={`flex items-center gap-3 border-2 rounded-2xl px-4 py-3 text-sm text-left transition-all active:scale-[0.99] ${
                  isChosen ? 'border-brand-400 bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-300' : 'border-gray-200 bg-white text-gray-700 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                }`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 border ${
                  isChosen ? 'bg-brand-500 border-brand-500 text-white' : 'border-current'
                }`}>{opt}</span>
                <FractionText text={(mcq as any)[`option_${opt.toLowerCase()}`]} />
              </button>
            )
          })}
        </div>

        {/* Question navigation dots */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {mcqs.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`w-7 h-7 rounded-lg text-[10px] font-bold transition-all ${
                i === current ? 'bg-slate-900 text-brand-400' :
                answered[i] ? 'bg-brand-500 text-white' :
                'bg-gray-200 text-gray-400 dark:bg-slate-600 dark:text-slate-500'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>

      {/* Nav buttons */}
      <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0 dark:bg-slate-800 dark:border-slate-700">
        <button
          onClick={() => { if (current > 0) goTo(current - 1) }}
          disabled={current === 0}
          className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm disabled:opacity-40 active:scale-95 transition-all dark:text-slate-400 dark:border-slate-700"
        >
          ← Previous
        </button>
        {current + 1 < mcqs.length ? (
          <button
            onClick={() => goTo(current + 1)}
            className="flex-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all"
          >
            Next →
          </button>
        ) : (
          <button
            onClick={submitTest}
            className="flex-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all"
          >
            Submit Test ✓
          </button>
        )}
      </div>
    </div>
  )
}
