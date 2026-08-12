import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { updateProfileAfterAttempt, updateChapterProgress } from '../lib/progress'
import { shuffleMcqOptions, ShuffledMcq } from '../lib/shuffleMcqOptions'
import FractionText from '../components/FractionText'

const CONFIG = { NUM_MCQS: 10, NUM_BLANKS: 10, TIME_MINUTES: 15 }

interface FillBlank { id: string; question: string; answer: string }

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5)
}
function isBlankCorrect(typed: string, answer: string): boolean {
  return typed.trim().toLowerCase() === answer.trim().toLowerCase()
}

type Phase = 'intro' | 'mcq' | 'fib' | 'results'

export default function ChapterQuickQuizScreen() {
  const { chapterId } = useParams<{ chapterId: string }>()
  const { user, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()

  const [chapterTitle, setChapterTitle] = useState('')
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [mcqs, setMcqs] = useState<ShuffledMcq[]>([])
  const [blanks, setBlanks] = useState<FillBlank[]>([])
  const [loading, setLoading] = useState(true)

  const [phase, setPhase] = useState<Phase>('intro')
  const [mcqIndex, setMcqIndex] = useState(0)
  const [mcqAnswers, setMcqAnswers] = useState<Record<number, string>>({})
  const [blankAnswers, setBlankAnswers] = useState<Record<string, string>>({})
  const [timeLeft, setTimeLeft] = useState(CONFIG.TIME_MINUTES * 60)

  const [results, setResults] = useState<null | {
    mcqCorrect: number; blankCorrect: number; total: number; max: number; xpEarned: number
    mcqBreakdown: { question: string; chosen: string; correctLabel: string | null; correct: boolean }[]
    blankBreakdown: { question: string; typed: string; answer: string; correct: boolean }[]
  }>(null)

  useEffect(() => {
    async function load() {
      const [{ data: allMcqs }, { data: allBlanks }, { data: ch }] = await Promise.all([
        supabase.from('mcqs').select('*').eq('chapter_id', chapterId),
        supabase.from('fill_in_blanks').select('*').eq('chapter_id', chapterId),
        supabase.from('chapters').select('title, subject_id').eq('id', chapterId).single(),
      ])
      if (allMcqs) setMcqs(shuffle(allMcqs).slice(0, CONFIG.NUM_MCQS).map(shuffleMcqOptions))
      if (allBlanks) setBlanks(shuffle(allBlanks as FillBlank[]).slice(0, CONFIG.NUM_BLANKS))
      if (ch) { setChapterTitle(ch.title); setSubjectId(ch.subject_id) }
      setLoading(false)
    }
    load()
  }, [chapterId])

  const maxScore = mcqs.length + blanks.length

  const submitQuiz = useCallback(async () => {
    const mcqBreakdown = mcqs.map((m, i) => {
      const correctLabel = m.options.find(o => o.isCorrect)?.label ?? null
      const chosen = mcqAnswers[i] ?? ''
      return { question: m.question, chosen, correctLabel, correct: chosen !== '' && chosen === correctLabel }
    })
    const mcqCorrect = mcqBreakdown.filter(m => m.correct).length

    const blankBreakdown = blanks.map(b => {
      const typed = blankAnswers[b.id] ?? ''
      return { question: b.question, typed, answer: b.answer, correct: typed !== '' && isBlankCorrect(typed, b.answer) }
    })
    const blankCorrect = blankBreakdown.filter(b => b.correct).length

    const total = mcqCorrect + blankCorrect
    const score = maxScore > 0 ? Math.round((total / maxScore) * 100) : 0
    const xpEarned = total * 9 + (score === 100 ? 40 : 0) + 15

    if (user && profile) {
      await supabase.from('quiz_attempts').insert({
        user_id: user.id,
        chapter_id: chapterId ?? null,
        subject_id: subjectId,
        score,
        total: maxScore,
        correct: total,
        wrong: mcqBreakdown.filter(m => m.chosen && !m.correct).length + blankBreakdown.filter(b => b.typed && !b.correct).length,
        skipped: mcqBreakdown.filter(m => !m.chosen).length + blankBreakdown.filter(b => !b.typed).length,
        time_taken: CONFIG.TIME_MINUTES * 60 - timeLeft,
        xp_earned: xpEarned,
        answers: { mcqs: mcqBreakdown, blanks: blankBreakdown },
      })
      await updateProfileAfterAttempt(user.id, profile, xpEarned, maxScore)
      if (chapterId) {
        await updateChapterProgress(user.id, chapterId, subjectId, score, maxScore)
      }
      await refreshProfile()
    }

    setResults({ mcqCorrect, blankCorrect, total, max: maxScore, xpEarned, mcqBreakdown, blankBreakdown })
    setPhase('results')
  }, [mcqs, mcqAnswers, blanks, blankAnswers, timeLeft, user, profile, chapterId, subjectId, refreshProfile, maxScore])

  useEffect(() => {
    if (phase === 'intro' || phase === 'results') return
    const timer = setInterval(() => {
      setTimeLeft(t => { if (t <= 1) { submitQuiz(); return 0 } return t - 1 })
    }, 1000)
    return () => clearInterval(timer)
  }, [phase, submitQuiz])

  const mins = Math.floor(timeLeft / 60)
  const secs = timeLeft % 60

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-slate-950">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (mcqs.length === 0 && blanks.length === 0) {
    return (
      <div className="flex flex-col h-screen items-center justify-center bg-gray-50 gap-3 px-4 dark:bg-slate-950">
        <div className="text-sm text-gray-400 text-center dark:text-slate-500">Quiz content for this chapter isn't ready yet.</div>
        <button onClick={() => navigate(-1)} className="text-brand-600 text-sm font-bold">← Back</button>
      </div>
    )
  }

  const Timer = () => (
    <span className={`font-black text-xs px-3 py-1.5 rounded-xl flex-shrink-0 ${timeLeft < 120 ? 'bg-red-500 text-white animate-pulse' : 'bg-white/20 text-white'}`}>
      ⏱ {mins}:{secs.toString().padStart(2, '0')}
    </span>
  )

  // ---------------- INTRO ----------------
  if (phase === 'intro') {
    return (
      <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
        <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 pt-8 pb-8 text-white flex-shrink-0">
          <button onClick={() => navigate(-1)} className="text-brand-200 text-xs mb-3">✕ Cancel</button>
          <div className="text-4xl mb-2">⚡</div>
          <h1 className="text-2xl font-black">{chapterTitle} — Quick Quiz</h1>
          <p className="text-brand-100 text-sm mt-1">MCQs + Fill in the Blanks, one fast round</p>
        </div>
        <div className="flex-1 px-4 py-6 flex flex-col gap-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3 dark:text-slate-500">What's in this quiz</div>
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-300">Part 1 — MCQs</span><span className="font-bold text-slate-900 dark:text-slate-100">{mcqs.length} questions</span></div>
              <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-300">Part 2 — Fill in the Blanks</span><span className="font-bold text-slate-900 dark:text-slate-100">{blanks.length} questions</span></div>
              <div className="flex justify-between border-t border-gray-100 pt-2 mt-1 dark:border-slate-700"><span className="font-bold text-slate-900 dark:text-slate-100">Total</span><span className="font-black text-brand-600">{maxScore} points · {CONFIG.TIME_MINUTES} min</span></div>
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 dark:bg-amber-950/30">
            <div className="text-xs font-bold text-amber-800 mb-2">⚠️ Before You Start</div>
            <div className="flex flex-col gap-1.5">
              {['One timer for both parts', 'Answers are checked at the end, not question by question', 'Auto-submits when time runs out'].map(t => (
                <div key={t} className="flex items-center gap-2 text-xs text-amber-700"><span className="text-amber-500">•</span> {t}</div>
              ))}
            </div>
          </div>
        </div>
        <div className="px-4 py-3 bg-white border-t border-gray-100 flex-shrink-0 dark:bg-slate-800 dark:border-slate-700">
          <button onClick={() => setPhase(mcqs.length > 0 ? 'mcq' : 'fib')} className="w-full bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">
            Start Quick Quiz ▶
          </button>
        </div>
      </div>
    )
  }

  // ---------------- MCQ SECTION ----------------
  if (phase === 'mcq') {
    const mcq = mcqs[mcqIndex]
    const answeredCount = Object.keys(mcqAnswers).length
    return (
      <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
        <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 py-3 text-white flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-black">Part 1 — MCQs</div>
            <Timer />
          </div>
          <div className="text-xs text-brand-100">{answeredCount} of {mcqs.length} answered</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          <div className="text-[10px] text-gray-400 font-semibold dark:text-slate-500">QUESTION {mcqIndex + 1} OF {mcqs.length}</div>
          <p className="text-base font-bold text-slate-900 leading-snug dark:text-slate-100"><FractionText text={mcq.question} /></p>
          <div className="flex flex-col gap-2.5">
            {mcq.options.map(opt => {
              const isChosen = mcqAnswers[mcqIndex] === opt.label
              return (
                <button key={opt.label} onClick={() => setMcqAnswers(prev => ({ ...prev, [mcqIndex]: opt.label }))}
                  className={`flex items-center gap-3 border-2 rounded-2xl px-4 py-3 text-sm text-left transition-all active:scale-[0.99] ${isChosen ? 'border-brand-400 bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-300' : 'border-gray-200 bg-white text-gray-700 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'}`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 border ${isChosen ? 'bg-brand-500 border-brand-500 text-white' : 'border-current'}`}>{opt.label}</span>
                  <FractionText text={opt.text} />
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {mcqs.map((_, i) => (
              <button key={i} onClick={() => setMcqIndex(i)} className={`w-7 h-7 rounded-lg text-[10px] font-bold transition-all ${i === mcqIndex ? 'bg-slate-900 text-brand-400' : mcqAnswers[i] ? 'bg-brand-500 text-white' : 'bg-gray-200 text-gray-400 dark:bg-slate-600 dark:text-slate-500'}`}>{i + 1}</button>
            ))}
          </div>
        </div>
        <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0 dark:bg-slate-800 dark:border-slate-700">
          <button onClick={() => mcqIndex > 0 && setMcqIndex(mcqIndex - 1)} disabled={mcqIndex === 0} className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm disabled:opacity-40 active:scale-95 transition-all dark:text-slate-400 dark:border-slate-700">← Previous</button>
          {mcqIndex + 1 < mcqs.length ? (
            <button onClick={() => setMcqIndex(mcqIndex + 1)} className="flex-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">Next →</button>
          ) : (
            <button onClick={() => setPhase(blanks.length > 0 ? 'fib' : 'results')} className="flex-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">
              {blanks.length > 0 ? 'Fill in the Blanks →' : 'Submit Quiz ✓'}
            </button>
          )}
        </div>
      </div>
    )
  }

  // ---------------- FILL BLANKS SECTION ----------------
  if (phase === 'fib') {
    return (
      <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
        <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 py-3 text-white flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-black">Part 2 — Fill in the Blanks</div>
            <Timer />
          </div>
          <div className="text-xs text-brand-100">Answer all {blanks.length}</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {blanks.map((b, i) => (
            <div key={b.id} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100 dark:bg-slate-800 dark:border-slate-700">
              <div className="text-[10px] text-gray-400 font-semibold mb-1 dark:text-slate-500">Q{i + 1}</div>
              <p className="text-sm font-semibold text-slate-900 mb-2 dark:text-slate-100"><FractionText text={b.question} /></p>
              <input
                value={blankAnswers[b.id] ?? ''}
                onChange={e => setBlankAnswers(prev => ({ ...prev, [b.id]: e.target.value }))}
                placeholder="Type the missing word..."
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-brand-400 dark:border-slate-700"
              />
            </div>
          ))}
        </div>
        <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0 dark:bg-slate-800 dark:border-slate-700">
          <button onClick={() => setPhase('mcq')} className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm active:scale-95 transition-all dark:text-slate-400 dark:border-slate-700">← MCQs</button>
          <button onClick={submitQuiz} className="flex-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">Submit Quiz ✓</button>
        </div>
      </div>
    )
  }

  // ---------------- RESULTS ----------------
  if (phase === 'results' && results) {
    return (
      <div className="flex flex-col h-screen bg-gray-50 overflow-y-auto dark:bg-slate-950">
        <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 pt-8 pb-8 text-white flex-shrink-0 text-center">
          <div className="text-4xl mb-2">⚡</div>
          <div className="text-3xl font-black">{results.total} / {results.max}</div>
          <div className="text-brand-100 text-sm mt-1">+{results.xpEarned} XP earned</div>
        </div>
        <div className="p-4 flex flex-col gap-4">
          <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3 dark:text-slate-500">Breakdown</div>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between"><span>MCQs</span><span className="font-bold">{results.mcqCorrect} / {mcqs.length}</span></div>
              <div className="flex justify-between"><span>Fill in the Blanks</span><span className="font-bold">{results.blankCorrect} / {blanks.length}</span></div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3 dark:text-slate-500">MCQ Review</div>
            <div className="flex flex-col gap-2">
              {results.mcqBreakdown.map((m, i) => (
                <div key={i} className="border-b border-gray-50 pb-2 last:border-0">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-100"><FractionText text={m.question} /></div>
                  <div className={`text-[10px] font-bold mt-0.5 ${m.correct ? 'text-brand-600' : 'text-red-500'}`}>
                    {m.correct ? '✓ Correct' : `✗ You chose ${m.chosen || '(skipped)'} — correct was ${m.correctLabel}`}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3 dark:text-slate-500">Fill in the Blanks Review</div>
            <div className="flex flex-col gap-2">
              {results.blankBreakdown.map((b, i) => (
                <div key={i} className="border-b border-gray-50 pb-2 last:border-0">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-100"><FractionText text={b.question} /></div>
                  <div className={`text-[10px] font-bold mt-0.5 ${b.correct ? 'text-brand-600' : 'text-red-500'}`}>
                    {b.correct ? (
                      <>✓ Correct: {b.typed}</>
                    ) : (
                      <>✗ You typed "{b.typed || '(skipped)'}" — correct: <FractionText text={b.answer} /></>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button onClick={() => navigate(-1)} className="w-full bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">
            Back to Chapter
          </button>
        </div>
      </div>
    )
  }

  return null
}
