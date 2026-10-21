import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { supabase, Subject } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { updateProfileAfterAttempt, recordMockTestUsage } from '../lib/progress'
import { shuffleMcqOptions, ShuffledMcq } from '../lib/shuffleMcqOptions'
import { drawQuestions } from '../lib/randomDrawEngine'
import { createMockTestRecord } from '../lib/mockTestApi'
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
  const [mcqs, setMcqs] = useState<ShuffledMcq[]>([])
  const [current, setCurrent] = useState(0)
  const [chosen, setChosen] = useState<string | null>(null)
  const [answered, setAnswered] = useState<Record<number, string>>({})
  const [timeLeft, setTimeLeft] = useState(1800)
  const [loading, setLoading] = useState(true)
  const [started, setStarted] = useState(false)
  const endAtRef = useRef(0)
  const submittedRef = useRef(false)
  const submitTestRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    if (!user) return
    const currentUser = user

    async function load() {
      if (subjectId) {
        const result = await drawQuestions({
          userId: currentUser.id,
          scope: 'subject',
          scopeId: subjectId,
          sources: [{ table: 'mcqs', count: 30 }],
        })
        const rows = result['mcqs'] ?? []
        setMcqs(shuffle(rows).map(shuffleMcqOptions))

        const { data: sub } = await supabase.from('subjects').select('*').eq('id', subjectId).single()
        if (sub) setSubject(sub)
        setLoading(false)
        return
      }

      const { data } = await supabase
        .from('mcqs')
        .select('*, chapters!inner(subject_id, subjects!inner(class_level))')
        .eq('chapters.subjects.class_level', profile?.class_level)
        .limit(30)
      if (data) setMcqs(shuffle(data).map(shuffleMcqOptions))
      setLoading(false)
    }
    load()
  }, [subjectId, user, profile?.class_level])

  useEffect(() => {
    if (!started) return
    if (!endAtRef.current) endAtRef.current = Date.now() + 1800 * 1000
    const tick = () => {
      const left = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000))
      setTimeLeft(left)
      if (left <= 0) {
        clearInterval(timer)
        void submitTestRef.current()
      }
    }
    const timer = setInterval(tick, 1000)
    tick()
    return () => clearInterval(timer)
  }, [started])

  const runSubmit = useCallback(async () => {
    const correct = mcqs.filter((mcq, i) => {
      const opt = mcq.options.find(o => o.label === answered[i])
      return opt?.isCorrect ?? false
    }).length
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
        answers: mcqs.map((mcq, i) => {
          const opt = mcq.options.find(o => o.label === answered[i])
          return { mcq_id: mcq.id, chosen: answered[i] ?? '', correct: opt?.isCorrect ?? false }
        }),
      })

      try {
        const savedMockTestId = await createMockTestRecord({
          subjectId: subjectId ?? null,
          kind: subjectId ? 'subject_mix' : 'all_mix',
          chapterIds: [],
          recipe: {
            source: subjectId ? 'subject' : 'mixed',
            totalQuestions: mcqs.length,
            timeMinutes: 30,
          },
          questions: mcqs.map((mcq, i) => ({
            id: mcq.id,
            type: 'mcq',
            question: mcq.question,
            options: mcq.options,
            answer: mcq.options.find(o => o.isCorrect)?.label ?? '',
            chosen: answered[i] ?? '',
          })),
          totalMarks: mcqs.length,
          timeMinutes: 30,
        })

        if (savedMockTestId) {
          console.info('Mock test saved server-side:', savedMockTestId)
        }
      } catch (err) {
        console.warn('Server mock-test save failed (non-blocking):', err)
      }

      const streakResult = await updateProfileAfterAttempt(user.id, profile, xpEarned, mcqs.length)
      await recordMockTestUsage(user.id, profile)
      await refreshProfile()

      navigate('/quiz-results', {
        state: {
          score, total: mcqs.length, correct, wrong, skipped, xpEarned, timeTaken,
          ...streakResult,
        }
      })
      return
    }

    navigate('/quiz-results', {
      state: { score, total: mcqs.length, correct, wrong, skipped, xpEarned, timeTaken }
    })
  }, [mcqs, answered, timeLeft, navigate, user, profile, subjectId, refreshProfile])

  const submitTest = useCallback(async () => {
    if (submittedRef.current) return
    submittedRef.current = true
    try {
      await runSubmit()
    } catch (e) {
      submittedRef.current = false
      console.error('Mock Test submit failed:', e)
    }
  }, [runSubmit])

  useEffect(() => { submitTestRef.current = submitTest }, [submitTest])

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
              className="w-full bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-brand-200 dark:shadow-black/30 active:scale-95 transition-all"
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

      <div className="h-1 bg-gray-100 flex-shrink-0 dark:bg-slate-700">
        <div className="h-full bg-gradient-to-r from-brand-600 to-brand-400 transition-all" style={{ width: `${((current + 1) / mcqs.length) * 100}%` }} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        <div className="text-[10px] text-gray-400 font-semibold dark:text-slate-500">QUESTION {current + 1} OF {mcqs.length}</div>
        <p className="text-base font-bold text-slate-900 leading-snug dark:text-slate-100"><FractionText text={mcq.question} /></p>

        {mcq.diagram_type && mcq.diagram_data && (
          <DiagramRenderer diagramType={mcq.diagram_type} diagramData={mcq.diagram_data} />
        )}

        <div className="flex flex-col gap-2.5">
          {mcq.options.map(opt => {
            const isChosen = chosen === opt.label || answered[current] === opt.label
            return (
              <button
                key={opt.label}
                onClick={() => handleChoose(opt.label)}
                className={`flex items-center gap-3 border-2 rounded-2xl px-4 py-3 text-sm text-left transition-all active:scale-[0.99] ${
                  isChosen ? 'border-brand-400 bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-300' : 'border-gray-200 bg-white text-gray-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 border ${
                  isChosen ? 'bg-brand-500 border-brand-500 text-white' : 'border-current'
                }`}>{opt.label}</span>
                <FractionText text={opt.text} />
              </button>
            )
          })}
        </div>

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
            className="flex-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 dark:shadow-black/30 active:scale-95 transition-all"
          >
            Next →
          </button>
        ) : (
          <button
            onClick={submitTest}
            className="flex-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 dark:shadow-black/30 active:scale-95 transition-all"
          >
            Submit Test ✓
          </button>
        )}
      </div>
    </div>
  )
}












































































































































 
 
 
 
 
 
 
 
 
 
 
 