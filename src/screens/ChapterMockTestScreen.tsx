import { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { updateProfileAfterAttempt, updateChapterProgress } from '../lib/progress'
import { shuffleMcqOptions, ShuffledMcq } from '../lib/shuffleMcqOptions'
import { normalizeMcqRow } from '../lib/normalizeMcq'
import { drawMergedQuestions } from '../lib/randomDrawEngine'
import { CONFIG, getMaxMarks } from '../lib/mockTestConfig'
import FractionText from '../components/FractionText'
import TileAnswerInput from '../components/TileAnswerInput'
import { pickDecoyTiles, getStepTexts, tokenizeAnswer } from '../lib/tileAnswer'

// ============================================================
// Keyword-matching auto-grader (no AI). Extracts significant words from
// the model answer, checks how many appear in the student's answer.
// Deterministic, but pattern-matching only — see conversation notes on
// its real limitations before relying on it for anything beyond a
// practice-app score estimate.
// ============================================================

// Simple character-difference check for typo tolerance — not a spellchecker,
// just lets "Anopheless" match "anopheles" without needing exact spelling.
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

// Fill-in-Blank grading: exact match (case/whitespace-insensitive) with the
// same typo tolerance used across this app's grading, scaled to the blank's own length.
function gradeFillBlank(answer: string, correct: string): boolean {
  const a = answer.trim().toLowerCase()
  const c = correct.trim().toLowerCase()
  if (!a) return false
  if (a === c) return true
  const tolerance = c.length > 6 ? 2 : c.length > 3 ? 1 : 0
  return levenshtein(a, c) <= tolerance
}

interface RubricConcept { concept: string; keywords: string[]; points: number }

// ============================================================
// Numericals are answered step by step, one real solution step at a
// time — tiles arranged into that step's exact text rather than typed
// (math notation is painful to type on a phone). This screen merges
// two source tables (the standalone `numericals` table and
// `book_exercises`) that store solution_steps in two different real
// shapes — plain strings vs step objects — both normalized via
// getStepTexts() from the shared tile lib. Falls back to a single
// tile-arrangement of the whole answer when a numerical has no
// solution_steps at all.
// ============================================================
interface NumericalProgress {
  stepChecked: boolean[]
  stepCorrect: boolean[]
  freeformChecked: boolean
  freeformCorrect: boolean
}

function initNumericalProgress(stepCount: number): NumericalProgress {
  return { stepChecked: Array(stepCount).fill(false), stepCorrect: Array(stepCount).fill(false), freeformChecked: false, freeformCorrect: false }
}

// Picks the best N scores out of however many were attempted — mirrors
// "attempt any X of Y" exam instructions without forcing the student to
// pre-select which ones count.
function bestOfN(scores: number[], n: number): number {
  return [...scores].sort((a, b) => b - a).slice(0, n).reduce((sum, s) => sum + s, 0)
}

interface FillBlankQ { id: string; question: string; answer: string }
interface ShortQ { id: string; question: string; answer: string; rubric: RubricConcept[] | null }
interface LongQ { id: string; question: string; answer: string; rubric: RubricConcept[] | null }
interface NumericalQ { id: string; question: string; answer: string; rubric: RubricConcept[] | null; solution_steps?: (string | { step_text: string })[] | null }

// Section A combines two item types (MCQ + Fill-in-Blank) into one
// stepped sequence, so the student sees one continuous "Section A".
type SectionAItem =
  | { kind: 'mcq'; data: ShuffledMcq }
  | { kind: 'fib'; data: FillBlankQ }

type Phase = 'intro' | 'sectionA' | 'sectionB' | 'sectionC' | 'sectionD' | 'results'

// ============================================================
// One numerical, answered one real solution step at a time — tiles
// arranged into that step's exact text, checked immediately before
// the next one unlocks. Falls back to a single tile-arrangement of
// the whole answer when a numerical has no solution_steps at all.
// ============================================================
function NumericalCard({
  question, marks, progress, onProgressChange,
}: {
  question: { question: string; answer: string; rubric: RubricConcept[] | null; solution_steps?: (string | { step_text: string })[] | null }
  marks: number
  progress: NumericalProgress
  onProgressChange: (next: NumericalProgress) => void
}) {
  const steps = getStepTexts(question.solution_steps)

  if (steps.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100 dark:bg-slate-800 dark:border-slate-700">
        <div className="text-[10px] text-gray-400 font-semibold mb-1 dark:text-slate-500">{marks} marks</div>
        <p className="text-sm font-semibold text-slate-900 mb-2 dark:text-slate-100">{question.question}</p>
        <TileAnswerInput
          correctAnswer={question.answer}
          feedback="onSubmit"
          allowRetry={false}
          onResult={correct => onProgressChange({ ...progress, freeformChecked: true, freeformCorrect: correct })}
        />
      </div>
    )
  }

  const total = steps.length
  const perStep = marks / total
  const firstUnchecked = progress.stepChecked.findIndex(c => !c)
  const currentIndex = firstUnchecked === -1 ? total - 1 : firstUnchecked
  const allDone = progress.stepChecked.every(Boolean)
  const earnedSoFar = Math.round(progress.stepCorrect.reduce((sum, correct) => sum + (correct ? perStep : 0), 0))

  function checkStep(i: number, correct: boolean) {
    const nextChecked = [...progress.stepChecked]; nextChecked[i] = true
    const nextCorrect = [...progress.stepCorrect]; nextCorrect[i] = correct
    onProgressChange({ ...progress, stepChecked: nextChecked, stepCorrect: nextCorrect })
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100 dark:bg-slate-800 dark:border-slate-700">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] text-gray-400 font-semibold dark:text-slate-500">{marks} marks · Step {Math.min(currentIndex + 1, total)} of {total}</div>
        {allDone && <div className="text-[10px] font-bold text-brand-600">{earnedSoFar} / {marks} earned</div>}
      </div>
      <p className="text-sm font-semibold text-slate-900 mb-3 dark:text-slate-100"><FractionText text={question.question} /></p>

      <div className="flex gap-1 mb-3">
        {steps.map((_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${
            progress.stepChecked[i] ? (progress.stepCorrect[i] ? 'bg-brand-500' : 'bg-red-300') : i === currentIndex ? 'bg-brand-200' : 'bg-gray-100 dark:bg-slate-700'
          }`} />
        ))}
      </div>

      {steps.map((stepText, i) => {
        if (i > currentIndex) return null
        const checked = progress.stepChecked[i]
        return (
          <div key={i} className="mb-3 last:mb-0">
            <div className="text-xs font-semibold text-gray-500 mb-1.5 dark:text-slate-400">Step {i + 1}</div>
            {!checked ? (
              <TileAnswerInput
                correctAnswer={stepText}
                decoyTiles={pickDecoyTiles(tokenizeAnswer(stepText), steps, 2)}
                feedback="onSubmit"
                allowRetry={false}
                onResult={correct => checkStep(i, correct)}
              />
            ) : (
              <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl ${progress.stepCorrect[i] ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400' : 'bg-red-50 text-red-600 dark:bg-red-950/40'}`}>
                <span>{progress.stepCorrect[i] ? '✓' : '✗'}</span>
                <span className="flex-1"><FractionText text={stepText} /></span>
                <span className="font-bold">{progress.stepCorrect[i] ? `+${Math.round(perStep)}` : '+0'}</span>
              </div>
            )}
          </div>
        )
      })}

      {allDone && (
        <div className="bg-brand-50 border border-brand-100 rounded-xl p-2.5 mt-2 dark:bg-brand-950/40">
          <div className="text-[9px] font-bold text-brand-700 mb-0.5 dark:text-brand-400">✅ Full Worked Solution</div>
          <div className="text-[10px] text-brand-800 leading-relaxed dark:text-brand-300"><FractionText text={question.answer} /></div>
        </div>
      )}
    </div>
  )
}

export default function ChapterMockTestScreen() {
  const { chapterId } = useParams<{ chapterId: string }>()
  const { user, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()

  const [chapterTitle, setChapterTitle] = useState('')
  const [subjectId, setSubjectId] = useState<string | null>(null)

  const [mcqs, setMcqs] = useState<ShuffledMcq[]>([])
  const [fibQs, setFibQs] = useState<FillBlankQ[]>([])
  const [shortQs, setShortQs] = useState<ShortQ[]>([])
  const [longQs, setLongQs] = useState<LongQ[]>([])
  const [numericalQs, setNumericalQs] = useState<NumericalQ[]>([])
  const [loading, setLoading] = useState(true)

  const [phase, setPhase] = useState<Phase>('intro')
  const [sectionAIndex, setSectionAIndex] = useState(0)
  const [mcqAnswers, setMcqAnswers] = useState<Record<string, string>>({}) // keyed by mcq.id
  const [fibAnswers, setFibAnswers] = useState<Record<string, string>>({}) // keyed by fib.id
  const [shortTileCorrect, setShortTileCorrect] = useState<Record<string, boolean>>({})
  const [longTileCorrect, setLongTileCorrect] = useState<Record<string, boolean>>({})
  const [numericalAnswers, setNumericalAnswers] = useState<Record<string, NumericalProgress>>({})

  const [timeLeft, setTimeLeft] = useState(CONFIG.TIME_MINUTES * 60)
  const [results, setResults] = useState<null | {
    mcqScore: number; fibScore: number; shortScore: number; longScore: number; numericalScore: number; total: number; maxMarks: number
    fibBreakdown: { question: string; answer: string; modelAnswer: string; score: number; max: number }[]
    shortBreakdown: { question: string; answer: string; modelAnswer: string; score: number; max: number; hits?: { concept: string; matched: boolean; points: number }[] }[]
    longBreakdown: { question: string; answer: string; modelAnswer: string; score: number; max: number; hits?: { concept: string; matched: boolean; points: number }[] }[]
    numericalBreakdown: { question: string; answer: string; modelAnswer: string; score: number; max: number; hits?: { concept: string; matched: boolean; points: number }[] }[]
    xpEarned: number
  }>(null)

  const sectionAItems: SectionAItem[] = useMemo(
    () => [...mcqs.map(m => ({ kind: 'mcq' as const, data: m })), ...fibQs.map(f => ({ kind: 'fib' as const, data: f }))],
    [mcqs, fibQs]
  )

  useEffect(() => {
    async function load() {
      if (!chapterId || !user) { setLoading(false); return }

      const { data: ch } = await supabase.from('chapters').select('title, subject_id').eq('id', chapterId).single()
      if (!ch) { setLoading(false); return }
      setChapterTitle(ch.title)
      setSubjectId(ch.subject_id)

      // Numericals section is data-driven, not subject-name-driven: always
      // attempt the draw, and let whether anything actually came back
      // (numericalQs.length > 0, checked everywhere below) decide if
      // Section D appears. This works for Physics, Math, or any future
      // subject with numericals content, with zero query/behavior change
      // for subjects that genuinely have none (the draw just returns empty).
      const groups = [
        { key: 'draw_mcq', members: [{ table: 'mcqs' as const }, { table: 'book_exercises' as const, sectionType: 'MCQ' }], count: CONFIG.NUM_MCQS },
        { key: 'draw_fib', members: [{ table: 'fill_in_blanks' as const }], count: CONFIG.FIB_OFFERED },
        { key: 'draw_short', members: [{ table: 'short_questions' as const }, { table: 'book_exercises' as const, sectionType: 'Short' }], count: CONFIG.SHORT_OFFERED },
        { key: 'draw_long', members: [{ table: 'long_questions' as const }, { table: 'book_exercises' as const, sectionType: 'Extended' }], count: CONFIG.LONG_OFFERED },
        { key: 'draw_numerical', members: [{ table: 'numericals' as const }, { table: 'book_exercises' as const, sectionType: 'Numerical' }], count: CONFIG.NUMERICAL_OFFERED },
      ]

      const draws = await drawMergedQuestions({ userId: user.id, scope: 'chapter', scopeId: chapterId, groups })

      setMcqs((draws.draw_mcq ?? []).map(normalizeMcqRow).map(shuffleMcqOptions))
      setFibQs(draws.draw_fib ?? [])
      setShortQs(draws.draw_short ?? [])
      setLongQs(draws.draw_long ?? [])
      setNumericalQs(draws.draw_numerical ?? [])

      setLoading(false)
    }
    load()
  }, [chapterId, user])

  const maxMarks = useMemo(() => getMaxMarks(numericalQs.length > 0), [numericalQs.length])

  const submitTest = useCallback(async () => {
    const mcqCorrect = mcqs.filter(m => mcqAnswers[m.id] === m.options.find(o => o.isCorrect)?.label).length
    const mcqScore = mcqCorrect * CONFIG.MCQ_MARKS

    const fibScored = fibQs.map(q => {
      const answer = fibAnswers[q.id] ?? ''
      const correct = gradeFillBlank(answer, q.answer)
      return { question: q.question, answer, modelAnswer: q.answer, score: correct ? CONFIG.FIB_MARKS : 0, max: CONFIG.FIB_MARKS }
    })
    const fibScore = bestOfN(fibScored.map(s => s.score), CONFIG.FIB_ATTEMPT)

    const shortScored = shortQs.map(q => {
      const correct = shortTileCorrect[q.id] ?? false
      return { question: q.question, answer: correct ? q.answer : '', modelAnswer: q.answer, score: correct ? CONFIG.SHORT_MARKS : 0, max: CONFIG.SHORT_MARKS }
    })
    const shortScore = bestOfN(shortScored.map(s => s.score), CONFIG.SHORT_ATTEMPT)

    const longScored = longQs.map(q => {
      const correct = longTileCorrect[q.id] ?? false
      return { question: q.question, answer: correct ? q.answer : '', modelAnswer: q.answer, score: correct ? CONFIG.LONG_MARKS : 0, max: CONFIG.LONG_MARKS }
    })
    const longScore = bestOfN(longScored.map(s => s.score), CONFIG.LONG_ATTEMPT)

    const numericalScored = numericalQs.map(q => {
      const progress = numericalAnswers[q.id]
      const steps = getStepTexts(q.solution_steps)
      if (steps.length > 0) {
        const perStep = CONFIG.NUMERICAL_MARKS / steps.length
        const score = progress ? progress.stepCorrect.reduce((sum, correct) => sum + (correct ? perStep : 0), 0) : 0
        const answer = progress ? steps.filter((_, i) => progress.stepCorrect[i]).join(' | ') : ''
        return { question: q.question, answer, modelAnswer: q.answer, score: Math.round(Math.min(score, CONFIG.NUMERICAL_MARKS)), max: CONFIG.NUMERICAL_MARKS }
      }
      const correct = progress?.freeformCorrect ?? false
      return { question: q.question, answer: correct ? q.answer : '', modelAnswer: q.answer, score: correct ? CONFIG.NUMERICAL_MARKS : 0, max: CONFIG.NUMERICAL_MARKS }
    })
    const numericalScore = bestOfN(numericalScored.map(s => s.score), CONFIG.NUMERICAL_ATTEMPT)

    const total = mcqScore + fibScore + shortScore + longScore + numericalScore

    if (user && profile) {
      await supabase.from('quiz_attempts').insert({
        user_id: user.id,
        chapter_id: chapterId,
        subject_id: null,
        score: Math.round((total / maxMarks) * 100),
        total: maxMarks,
        correct: mcqCorrect,
        wrong: Object.keys(mcqAnswers).length - mcqCorrect,
        skipped: mcqs.length - Object.keys(mcqAnswers).length,
        time_taken: CONFIG.TIME_MINUTES * 60 - timeLeft,
        xp_earned: 100 + Math.round((total / maxMarks) * 150),
        answers: {
          mcqs: mcqs.map(m => ({ mcq_id: m.id, chosen: mcqAnswers[m.id] ?? '', correct: mcqAnswers[m.id] === m.options.find(o => o.isCorrect)?.label })),
          fib: fibScored,
          short: shortScored,
          long: longScored,
          numerical: numericalScored,
        },
      })
      const xpEarned = 100 + Math.round((total / maxMarks) * 150)
      // BUG FIX: was passing `maxMarks` (total possible marks across ALL
      // sections — 40-48 for this paper structure) as the mcqCount
      // argument. progress.ts adds this value directly onto
      // profile.mcq_used_today, the exact counter QuizScreen.tsx checks
      // for the free-tier daily MCQ limit — so one Mock Test attempt was
      // silently consuming 40+ "MCQs" worth of that unrelated daily
      // allowance instead of the 7 real MCQs actually answered.
      // mcqs.length is the actual MCQ count for this attempt.
      await updateProfileAfterAttempt(user.id, profile, xpEarned, mcqs.length)
      if (chapterId) {
        // Also fixed: this previously used mcqs.length as a stand-in for
        // "questions attempted", undercounting the accumulating
        // mcqs_attempted stat by everything outside Section A's MCQs.
        const questionsAttempted = mcqs.length + fibScored.length + shortScored.length + longScored.length + numericalScored.length
        await updateChapterProgress(user.id, chapterId, subjectId, Math.round((total / maxMarks) * 100), questionsAttempted)
      }
      await refreshProfile()

      setResults({ mcqScore, fibScore, shortScore, longScore, numericalScore, total, maxMarks, fibBreakdown: fibScored, shortBreakdown: shortScored, longBreakdown: longScored, numericalBreakdown: numericalScored, xpEarned })
      setPhase('results')
      return
    }

    const xpEarned = 100 + Math.round((total / maxMarks) * 150)
    setResults({ mcqScore, fibScore, shortScore, longScore, numericalScore, total, maxMarks, fibBreakdown: fibScored, shortBreakdown: shortScored, longBreakdown: longScored, numericalBreakdown: numericalScored, xpEarned })
    setPhase('results')
  }, [mcqs, mcqAnswers, fibQs, fibAnswers, shortQs, shortTileCorrect, longQs, longTileCorrect, numericalQs, numericalAnswers, timeLeft, user, profile, chapterId, subjectId, maxMarks, refreshProfile])

  useEffect(() => {
    if (phase === 'intro' || phase === 'results') return
    const timer = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { submitTest(); return 0 }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [phase, submitTest])

  const mins = Math.floor(timeLeft / 60)
  const secs = timeLeft % 60
  const shortAnsweredCount = useMemo(() => shortQs.filter(q => q.id in shortTileCorrect).length, [shortQs, shortTileCorrect])
  const longAnsweredCount = useMemo(() => longQs.filter(q => q.id in longTileCorrect).length, [longQs, longTileCorrect])
  const numericalAnsweredCount = useMemo(() => numericalQs.filter(q => { const p = numericalAnswers[q.id]; return p && (p.stepChecked.some(Boolean) || p.freeformChecked) }).length, [numericalQs, numericalAnswers])
  const sectionAAnsweredCount = useMemo(
    () => sectionAItems.filter(item => item.kind === 'mcq' ? !!mcqAnswers[item.data.id] : (fibAnswers[item.data.id] ?? '').trim().length > 0).length,
    [sectionAItems, mcqAnswers, fibAnswers]
  )

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-slate-950">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const Timer = () => (
    <div className={`font-black text-sm px-3 py-1.5 rounded-xl flex-shrink-0 ${timeLeft < 300 ? 'bg-red-500 text-white animate-pulse' : 'bg-white/20 text-white'}`}>
      ⏱ {mins}:{secs.toString().padStart(2, '0')}
    </div>
  )

  // ---------------- INTRO ----------------
  if (phase === 'intro') {
    return (
      <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
        <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 pt-8 pb-8 text-white flex-shrink-0">
          <button onClick={() => navigate(-1)} className="text-brand-200 text-xs mb-3">✕ Cancel</button>
          <div className="text-4xl mb-2">📝</div>
          <h1 className="text-2xl font-black">{chapterTitle} — Mock Test</h1>
          <p className="text-brand-100 text-sm mt-1">Balochistan Board Format</p>
        </div>
        <div className="flex-1 px-4 py-6 flex flex-col gap-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3 dark:text-slate-500">Paper Structure</div>
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-300">Section A — MCQs + Fill in the Blanks</span><span className="font-bold text-slate-900 dark:text-slate-100">{CONFIG.NUM_MCQS * CONFIG.MCQ_MARKS + CONFIG.FIB_ATTEMPT * CONFIG.FIB_MARKS} marks</span></div>
              <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-300">Section B — Short (attempt {CONFIG.SHORT_ATTEMPT} of {CONFIG.SHORT_OFFERED})</span><span className="font-bold text-slate-900 dark:text-slate-100">{CONFIG.SHORT_ATTEMPT * CONFIG.SHORT_MARKS} marks</span></div>
              <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-300">Section C — Long (attempt {CONFIG.LONG_ATTEMPT} of {CONFIG.LONG_OFFERED})</span><span className="font-bold text-slate-900 dark:text-slate-100">{CONFIG.LONG_ATTEMPT * CONFIG.LONG_MARKS} marks</span></div>
              {numericalQs.length > 0 && (
                <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-300">Section D — Numericals (2, both count)</span><span className="font-bold text-slate-900 dark:text-slate-100">{CONFIG.NUMERICAL_OFFERED * CONFIG.NUMERICAL_MARKS} marks</span></div>
              )}
              <div className="flex justify-between border-t border-gray-100 pt-2 mt-1 dark:border-slate-700"><span className="font-bold text-slate-900 dark:text-slate-100">Total</span><span className="font-black text-brand-600">{maxMarks} marks · {CONFIG.TIME_MINUTES} min</span></div>
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 dark:bg-amber-950/30">
            <div className="text-xs font-bold text-amber-800 mb-2">⚠️ Before You Start</div>
            <div className="flex flex-col gap-1.5">
              {[
                'One timer runs for the whole test, across all sections',
                'Short/Long answers are auto-graded by matching key terms — write full sentences, not just keywords',
                'Numericals are answered step by step — each step is checked before the next one unlocks',
                'You can answer more than required; only your best scores count toward the section total',
                'Auto-submits when time expires',
              ].map(t => (
                <div key={t} className="flex items-center gap-2 text-xs text-amber-700">
                  <span className="text-amber-500">•</span> {t}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="px-4 py-3 bg-white border-t border-gray-100 flex-shrink-0 dark:bg-slate-800 dark:border-slate-700">
          <button
            onClick={() => setPhase('sectionA')}
            className="w-full bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all"
          >
            Start Mock Test ▶
          </button>
        </div>
      </div>
    )
  }

  // ---------------- SECTION A: MCQs + Fill in the Blanks ----------------
  if (phase === 'sectionA') {
    const item = sectionAItems[sectionAIndex]
    return (
      <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
        <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 py-3 text-white flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-black">Section A — MCQs &amp; Fill in the Blanks</div>
            <Timer />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[{ val: `Q${sectionAIndex + 1}`, label: 'Current' }, { val: sectionAAnsweredCount, label: 'Answered' }, { val: sectionAItems.length - sectionAAnsweredCount, label: 'Remaining' }].map(({ val, label }) => (
              <div key={label} className="bg-white/20 rounded-lg py-1.5 text-center">
                <div className="text-sm font-black">{val}</div>
                <div className="text-[9px] text-brand-100">{label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="h-1 bg-gray-100 flex-shrink-0 dark:bg-slate-700">
          <div className="h-full bg-gradient-to-r from-brand-600 to-brand-400 transition-all" style={{ width: `${((sectionAIndex + 1) / sectionAItems.length) * 100}%` }} />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          <div className="text-[10px] text-gray-400 font-semibold dark:text-slate-500">
            {item.kind === 'mcq' ? 'MULTIPLE CHOICE' : 'FILL IN THE BLANK'} · QUESTION {sectionAIndex + 1} OF {sectionAItems.length}
          </div>
          <p className="text-base font-bold text-slate-900 leading-snug dark:text-slate-100"><FractionText text={item.data.question} /></p>

          {item.kind === 'mcq' ? (
            <div className="flex flex-col gap-2.5">
              {item.data.options.map(opt => {
                const isChosen = mcqAnswers[item.data.id] === opt.label
                return (
                  <button
                    key={opt.label}
                    onClick={() => setMcqAnswers(prev => ({ ...prev, [item.data.id]: opt.label }))}
                    className={`flex items-center gap-3 border-2 rounded-2xl px-4 py-3 text-sm text-left transition-all active:scale-[0.99] ${isChosen ? 'border-brand-400 bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-300' : 'border-gray-200 bg-white text-gray-700 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'}`}
                  >
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 border ${isChosen ? 'bg-brand-500 border-brand-500 text-white' : 'border-current'}`}>{opt.label}</span>
                    <FractionText text={opt.text} />
                  </button>
                )
              })}
            </div>
          ) : (
            <input
              type="text"
              value={fibAnswers[item.data.id] ?? ''}
              onChange={e => setFibAnswers(prev => ({ ...prev, [item.data.id]: e.target.value }))}
              placeholder="Type the missing word/phrase..."
              className="w-full text-sm border-2 border-gray-200 rounded-2xl px-4 py-3 focus:outline-none focus:border-brand-400 dark:border-slate-700"
            />
          )}

          <div className="flex flex-wrap gap-1.5 mt-2">
            {sectionAItems.map((it, i) => {
              const answered = it.kind === 'mcq' ? !!mcqAnswers[it.data.id] : (fibAnswers[it.data.id] ?? '').trim().length > 0
              return (
                <button key={i} onClick={() => setSectionAIndex(i)} className={`w-7 h-7 rounded-lg text-[10px] font-bold transition-all ${i === sectionAIndex ? 'bg-slate-900 text-brand-400' : answered ? 'bg-brand-500 text-white' : 'bg-gray-200 text-gray-400 dark:bg-slate-600 dark:text-slate-500'}`}>
                  {i + 1}
                </button>
              )
            })}
          </div>
        </div>
        <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0 dark:bg-slate-800 dark:border-slate-700">
          <button onClick={() => sectionAIndex > 0 && setSectionAIndex(sectionAIndex - 1)} disabled={sectionAIndex === 0} className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm disabled:opacity-40 active:scale-95 transition-all dark:text-slate-400 dark:border-slate-700">← Previous</button>
          {sectionAIndex + 1 < sectionAItems.length ? (
            <button onClick={() => setSectionAIndex(sectionAIndex + 1)} className="flex-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">Next →</button>
          ) : (
            <button onClick={() => setPhase('sectionB')} className="flex-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">Section B →</button>
          )}
        </div>
      </div>
    )
  }

  // ---------------- SECTION B: Short Questions ----------------
  if (phase === 'sectionB') {
    return (
      <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
        <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 py-3 text-white flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-black">Section B — Short Questions</div>
            <Timer />
          </div>
          <div className="text-xs text-brand-100">Attempt any {CONFIG.SHORT_ATTEMPT} of {CONFIG.SHORT_OFFERED} · {shortAnsweredCount} attempted so far</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {shortQs.map((q, i) => (
            <div key={q.id} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100 dark:bg-slate-800 dark:border-slate-700">
              <div className="text-[10px] text-gray-400 font-semibold mb-1 dark:text-slate-500">Q{i + 1} · {CONFIG.SHORT_MARKS} marks</div>
              <p className="text-sm font-semibold text-slate-900 mb-2 dark:text-slate-100"><FractionText text={q.question} /></p>
              <TileAnswerInput
                correctAnswer={q.answer}
                feedback="onSubmit"
                allowRetry={false}
                onResult={correct => setShortTileCorrect(prev => ({ ...prev, [q.id]: correct }))}
              />
            </div>
          ))}
        </div>
        <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0 dark:bg-slate-800 dark:border-slate-700">
          <button onClick={() => setPhase('sectionA')} className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm active:scale-95 transition-all dark:text-slate-400 dark:border-slate-700">← Section A</button>
          <button onClick={() => setPhase('sectionC')} className="flex-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">Section C →</button>
        </div>
      </div>
    )
  }

  // ---------------- SECTION C: Long Questions ----------------
  if (phase === 'sectionC') {
    return (
      <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
        <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 py-3 text-white flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-black">Section C — Long Questions</div>
            <Timer />
          </div>
          <div className="text-xs text-brand-100">Attempt any {CONFIG.LONG_ATTEMPT} of {CONFIG.LONG_OFFERED} · {longAnsweredCount} attempted so far</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {longQs.map((q, i) => (
            <div key={q.id} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100 dark:bg-slate-800 dark:border-slate-700">
              <div className="text-[10px] text-gray-400 font-semibold mb-1 dark:text-slate-500">Q{i + 1} · {CONFIG.LONG_MARKS} marks</div>
              <p className="text-sm font-semibold text-slate-900 mb-2 dark:text-slate-100"><FractionText text={q.question} /></p>
              <TileAnswerInput
                correctAnswer={q.answer}
                feedback="onSubmit"
                allowRetry={false}
                onResult={correct => setLongTileCorrect(prev => ({ ...prev, [q.id]: correct }))}
              />
            </div>
          ))}
        </div>
        <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0 dark:bg-slate-800 dark:border-slate-700">
          <button onClick={() => setPhase('sectionB')} className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm active:scale-95 transition-all dark:text-slate-400 dark:border-slate-700">← Section B</button>
          {numericalQs.length > 0 ? (
            <button onClick={() => setPhase('sectionD')} className="flex-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">Section D →</button>
          ) : (
            <button onClick={submitTest} className="flex-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">Submit Test ✓</button>
          )}
        </div>
      </div>
    )
  }

  // ---------------- SECTION D: Numericals (any subject with numericals content) ----------------
  if (phase === 'sectionD') {
    return (
      <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
        <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 py-3 text-white flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-black">Section D — Numericals</div>
            <Timer />
          </div>
          <div className="text-xs text-brand-100">Answer both · {numericalAnsweredCount} attempted so far</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {numericalQs.map(q => (
            <NumericalCard
              key={q.id}
              question={q}
              marks={CONFIG.NUMERICAL_MARKS}
              progress={numericalAnswers[q.id] ?? initNumericalProgress(getStepTexts(q.solution_steps).length)}
              onProgressChange={next => setNumericalAnswers(prev => ({ ...prev, [q.id]: next }))}
            />
          ))}
        </div>
        <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0 dark:bg-slate-800 dark:border-slate-700">
          <button onClick={() => setPhase('sectionC')} className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm active:scale-95 transition-all dark:text-slate-400 dark:border-slate-700">← Section C</button>
          <button onClick={submitTest} className="flex-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">Submit Test ✓</button>
        </div>
      </div>
    )
  }

  // ---------------- RESULTS ----------------
  if (phase === 'results' && results) {
    return (
      <div className="flex flex-col h-screen bg-gray-50 overflow-y-auto dark:bg-slate-950">
        <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 pt-8 pb-8 text-white flex-shrink-0 text-center">
          <div className="text-4xl mb-2">🎉</div>
          <div className="text-3xl font-black">{results.total} / {results.maxMarks}</div>
          <div className="text-brand-100 text-sm mt-1">+{results.xpEarned} XP earned</div>
        </div>
        <div className="p-4 flex flex-col gap-4">
          <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3 dark:text-slate-500">Section Breakdown</div>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between"><span>Section A — MCQs + Fill in Blanks</span><span className="font-bold">{results.mcqScore + results.fibScore} / {CONFIG.NUM_MCQS * CONFIG.MCQ_MARKS + CONFIG.FIB_ATTEMPT * CONFIG.FIB_MARKS}</span></div>
              <div className="flex justify-between"><span>Section B — Short</span><span className="font-bold">{results.shortScore} / {CONFIG.SHORT_ATTEMPT * CONFIG.SHORT_MARKS}</span></div>
              <div className="flex justify-between"><span>Section C — Long</span><span className="font-bold">{results.longScore} / {CONFIG.LONG_ATTEMPT * CONFIG.LONG_MARKS}</span></div>
              {numericalQs.length > 0 && (
                <div className="flex justify-between"><span>Section D — Numericals</span><span className="font-bold">{results.numericalScore} / {CONFIG.NUMERICAL_ATTEMPT * CONFIG.NUMERICAL_MARKS}</span></div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3 dark:text-slate-500">Fill in the Blank Review</div>
            <div className="flex flex-col gap-3">
              {results.fibBreakdown.map((s, i) => (
                <div key={i} className="border-b border-gray-50 pb-3 last:border-0">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-100"><FractionText text={s.question} /></div>
                  <div className="text-[10px] text-gray-500 mt-1 dark:text-slate-400">Your answer: {s.answer || '(not attempted)'}</div>
                  <div className={`text-[10px] font-bold mt-1 mb-1.5 ${s.score > 0 ? 'text-brand-600' : 'text-red-500'}`}>{s.score > 0 ? '✓ Correct' : '✗ Incorrect'} — {s.score} / {s.max}</div>
                  {s.score === 0 && (
                    <div className="bg-brand-50 border border-brand-100 rounded-xl p-2.5 dark:bg-brand-950/40">
                      <div className="text-[9px] font-bold text-brand-700 mb-0.5 dark:text-brand-400">✅ Correct Answer</div>
                      <div className="text-[10px] text-brand-800 leading-relaxed dark:text-brand-300"><FractionText text={s.modelAnswer} /></div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3 dark:text-slate-500">Short Question Review</div>
            <div className="flex flex-col gap-3">
              {results.shortBreakdown.map((s, i) => (
                <div key={i} className="border-b border-gray-50 pb-3 last:border-0">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-100"><FractionText text={s.question} /></div>
                  <div className="text-[10px] text-gray-500 mt-1 dark:text-slate-400">Your answer: {s.answer || '(not attempted)'}</div>
                  <div className="text-[10px] font-bold text-brand-600 mt-1 mb-1.5">Score: {s.score} / {s.max}</div>
                  <div className="bg-brand-50 border border-brand-100 rounded-xl p-2.5 dark:bg-brand-950/40">
                    <div className="text-[9px] font-bold text-brand-700 mb-0.5 dark:text-brand-400">✅ Correct Answer</div>
                    <div className="text-[10px] text-brand-800 leading-relaxed dark:text-brand-300"><FractionText text={s.modelAnswer} /></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3 dark:text-slate-500">Long Question Review</div>
            <div className="flex flex-col gap-3">
              {results.longBreakdown.map((s, i) => (
                <div key={i} className="border-b border-gray-50 pb-3 last:border-0">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-100"><FractionText text={s.question} /></div>
                  <div className="text-[10px] text-gray-500 mt-1 dark:text-slate-400">Your answer: {s.answer || '(not attempted)'}</div>
                  <div className="text-[10px] font-bold text-brand-600 mt-1 mb-1.5">Score: {s.score} / {s.max}</div>
                  <div className="bg-brand-50 border border-brand-100 rounded-xl p-2.5 dark:bg-brand-950/40">
                    <div className="text-[9px] font-bold text-brand-700 mb-0.5 dark:text-brand-400">✅ Correct Answer</div>
                    <div className="text-[10px] text-brand-800 leading-relaxed dark:text-brand-300"><FractionText text={s.modelAnswer} /></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {results.numericalBreakdown.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
              <div className="text-xs font-bold text-gray-400 uppercase mb-3 dark:text-slate-500">Numerical Review</div>
              <div className="flex flex-col gap-3">
                {results.numericalBreakdown.map((s, i) => (
                  <div key={i} className="border-b border-gray-50 pb-3 last:border-0">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-100"><FractionText text={s.question} /></div>
                    <div className="text-[10px] text-gray-500 mt-1 dark:text-slate-400">Your answer: {s.answer || '(not attempted)'}</div>
                    <div className="text-[10px] font-bold text-brand-600 mt-1 mb-1.5">Score: {s.score} / {s.max}</div>
                    <div className="bg-brand-50 border border-brand-100 rounded-xl p-2.5 dark:bg-brand-950/40">
                      <div className="text-[9px] font-bold text-brand-700 mb-0.5 dark:text-brand-400">✅ Correct Answer</div>
                      <div className="text-[10px] text-brand-800 leading-relaxed dark:text-brand-300"><FractionText text={s.modelAnswer} /></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => navigate(-1)}
            className="w-full bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all"
          >
            Back to Chapter
          </button>
        </div>
      </div>
    )
  }

  return null
}
