import { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { updateProfileAfterAttempt, updateChapterProgress } from '../lib/progress'
import { shuffleMcqOptions, ShuffledMcq } from '../lib/shuffleMcqOptions'
import FractionText from '../components/FractionText'

// ============================================================
// TEST CONFIG — standard Balochistan Board Class 9 pattern (default).
// Update these numbers once you have the real per-chapter paper structure.
// ============================================================
const CONFIG = {
  NUM_MCQS: 15,        MCQ_MARKS: 1,     // Section A
  SHORT_OFFERED: 10,   SHORT_ATTEMPT: 8, SHORT_MARKS: 2, // Section B
  LONG_OFFERED: 5,     LONG_ATTEMPT: 3,  LONG_MARKS: 8,  // Section C
  NUMERICAL_OFFERED: 2, NUMERICAL_ATTEMPT: 2, NUMERICAL_MARKS: 4, // Section D — fixed at 2, both count, no selection
  TIME_MINUTES: 90,
}
const MAX_MARKS =
  CONFIG.NUM_MCQS * CONFIG.MCQ_MARKS +
  CONFIG.SHORT_ATTEMPT * CONFIG.SHORT_MARKS +
  CONFIG.LONG_ATTEMPT * CONFIG.LONG_MARKS +
  CONFIG.NUMERICAL_ATTEMPT * CONFIG.NUMERICAL_MARKS

// ============================================================
// Keyword-matching auto-grader (no AI). Extracts significant words from
// the model answer, checks how many appear in the student's answer.
// Deterministic, but pattern-matching only — see conversation notes on
// its real limitations before relying on it for anything beyond a
// practice-app score estimate.
// ============================================================
const STOPWORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','to','of','in','on','at','by','for',
  'with','and','or','but','it','this','that','these','those','as','from','which','who','what',
  'when','where','why','how','can','could','will','would','should','may','might','must','not','no',
  'do','does','did','has','have','had','its','their','they','he','she','we','you','i','also','into',
  'than','then','so','such','if','because','about','after','before','between','through','during',
  'above','below','up','down','out','over','under','again','further','once','there','here','all',
  'any','both','each','few','more','most','other','some','only','own','same','too','very','just',
])

function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w))
  )
}

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

// A phrase "matches" if it appears in the answer allowing minor typos on
// each word (max 1-2 character edits depending on word length).
function phraseMatches(answerLower: string, phrase: string): boolean {
  const phraseWords = phrase.toLowerCase().split(/\s+/)
  const answerWords = answerLower.split(/[^a-z0-9]+/).filter(Boolean)
  return phraseWords.every(pw =>
    answerWords.some(aw => {
      if (aw === pw) return true
      const tolerance = pw.length > 6 ? 2 : pw.length > 3 ? 1 : 0
      return levenshtein(aw, pw) <= tolerance
    })
  )
}

interface RubricConcept { concept: string; keywords: string[]; points: number }

// ============================================================
// Numericals are answered step by step, one rubric concept at a time —
// check as you go, not one big textarea graded only at the end. Falls
// back to a single free-text box when a numerical has no rubric yet
// (older content, or not written yet) so nothing breaks either way.
// ============================================================
interface NumericalProgress {
  stepAnswers: string[]
  stepChecked: boolean[]
  stepCorrect: boolean[]
  freeformAnswer: string // used only when the question has no rubric
}

function initNumericalProgress(rubric: RubricConcept[] | null): NumericalProgress {
  const n = rubric?.length ?? 0
  return { stepAnswers: Array(n).fill(''), stepChecked: Array(n).fill(false), stepCorrect: Array(n).fill(false), freeformAnswer: '' }
}

function gradeWithRubric(studentAnswer: string, rubric: RubricConcept[]): { score: number; hits: { concept: string; matched: boolean; points: number }[] } {
  const trimmed = studentAnswer.trim()
  const answerLower = trimmed.toLowerCase()
  const hits = rubric.map(r => {
    const matched = trimmed.length >= 10 && r.keywords.some(kw => phraseMatches(answerLower, kw))
    return { concept: r.concept, matched, points: matched ? r.points : 0 }
  })
  const score = hits.reduce((sum, h) => sum + h.points, 0)
  return { score, hits }
}

// Fallback for chapters generated before rubrics existed (rubric = null).
// Cruder, but keeps old content gradeable without breaking anything.
function gradeTextAnswer(studentAnswer: string, modelAnswer: string, maxMarks: number): number {
  const trimmed = studentAnswer.trim()
  if (trimmed.length < 10) return 0 // too short to be a real attempt
  const modelKeywords = extractKeywords(modelAnswer)
  if (modelKeywords.size === 0) return 0
  const studentKeywords = extractKeywords(trimmed)
  let matched = 0
  modelKeywords.forEach(k => { if (studentKeywords.has(k)) matched++ })
  const ratio = matched / modelKeywords.size
  return Math.round(ratio * maxMarks)
}

// Picks the best N scores out of however many were attempted — mirrors
// "attempt any X of Y" exam instructions without forcing the student to
// pre-select which ones count.
function bestOfN(scores: number[], n: number): number {
  return [...scores].sort((a, b) => b - a).slice(0, n).reduce((sum, s) => sum + s, 0)
}

interface ShortQ { id: string; question: string; answer: string; rubric: RubricConcept[] | null }
interface LongQ { id: string; question: string; answer: string; rubric: RubricConcept[] | null }
interface NumericalQ { id: string; question: string; answer: string; rubric: RubricConcept[] | null }

type Phase = 'intro' | 'sectionA' | 'sectionB' | 'sectionC' | 'sectionD' | 'results'

// ============================================================
// One numerical, answered one rubric-concept step at a time. Each step
// is checked immediately (phrase-matched against that concept's own
// keywords) before the next one unlocks — game-like, not one big
// textarea graded only at the end. Falls back to a single free-text box
// when the question has no rubric (older content, or not written yet).
// ============================================================
function NumericalCard({
  question, marks, progress, onProgressChange,
}: {
  question: { question: string; answer: string; rubric: RubricConcept[] | null }
  marks: number
  progress: NumericalProgress
  onProgressChange: (next: NumericalProgress) => void
}) {
  const rubric = question.rubric

  if (!rubric || rubric.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
        <div className="text-[10px] text-gray-400 font-semibold mb-1">{marks} marks</div>
        <p className="text-sm font-semibold text-slate-900 mb-2">{question.question}</p>
        <textarea
          value={progress.freeformAnswer}
          onChange={e => onProgressChange({ ...progress, freeformAnswer: e.target.value })}
          placeholder="Show your working: given values, formula, substitution, final answer with unit..."
          rows={4}
          className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-400"
        />
      </div>
    )
  }

  const total = rubric.length
  const firstUnchecked = progress.stepChecked.findIndex(c => !c)
  const currentIndex = firstUnchecked === -1 ? total - 1 : firstUnchecked
  const allDone = progress.stepChecked.every(Boolean)
  const earnedSoFar = rubric.reduce((sum, r, i) => sum + (progress.stepCorrect[i] ? r.points : 0), 0)

  function checkStep(i: number) {
    const answer = progress.stepAnswers[i] ?? ''
    const matched = answer.trim().length >= 2 && rubric![i].keywords.some(kw => phraseMatches(answer.toLowerCase(), kw))
    const nextChecked = [...progress.stepChecked]; nextChecked[i] = true
    const nextCorrect = [...progress.stepCorrect]; nextCorrect[i] = matched
    onProgressChange({ ...progress, stepChecked: nextChecked, stepCorrect: nextCorrect })
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] text-gray-400 font-semibold">{marks} marks · Step {Math.min(currentIndex + 1, total)} of {total}</div>
        {allDone && <div className="text-[10px] font-bold text-emerald-600">{earnedSoFar} / {marks} earned</div>}
      </div>
      <p className="text-sm font-semibold text-slate-900 mb-3"><FractionText text={question.question} /></p>

      <div className="flex gap-1 mb-3">
        {rubric.map((_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${
            progress.stepChecked[i] ? (progress.stepCorrect[i] ? 'bg-emerald-500' : 'bg-red-300') : i === currentIndex ? 'bg-emerald-200' : 'bg-gray-100'
          }`} />
        ))}
      </div>

      {rubric.map((concept, i) => {
        if (i > currentIndex) return null
        const checked = progress.stepChecked[i]
        return (
          <div key={i} className="mb-3 last:mb-0">
            <div className="text-xs font-semibold text-gray-500 mb-1.5">Step {i + 1}: {concept.concept}</div>
            {!checked ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={progress.stepAnswers[i] ?? ''}
                  onChange={e => {
                    const next = [...progress.stepAnswers]; next[i] = e.target.value
                    onProgressChange({ ...progress, stepAnswers: next })
                  }}
                  placeholder="Your answer for this step..."
                  className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-400"
                />
                <button onClick={() => checkStep(i)} className="px-4 bg-slate-900 text-emerald-400 text-xs font-bold rounded-xl active:scale-95 transition-all">
                  Check
                </button>
              </div>
            ) : (
              <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl ${progress.stepCorrect[i] ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                <span>{progress.stepCorrect[i] ? '✓' : '✗'}</span>
                <span className="flex-1">{progress.stepAnswers[i]}</span>
                <span className="font-bold">{progress.stepCorrect[i] ? `+${concept.points}` : '+0'}</span>
              </div>
            )}
          </div>
        )
      })}

      {allDone && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-2.5 mt-2">
          <div className="text-[9px] font-bold text-emerald-700 mb-0.5">✅ Full Worked Solution</div>
          <div className="text-[10px] text-emerald-800 leading-relaxed"><FractionText text={question.answer} /></div>
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
  const [shortQs, setShortQs] = useState<ShortQ[]>([])
  const [longQs, setLongQs] = useState<LongQ[]>([])
  const [numericalQs, setNumericalQs] = useState<NumericalQ[]>([])
  const [loading, setLoading] = useState(true)

  const [phase, setPhase] = useState<Phase>('intro')
  const [mcqIndex, setMcqIndex] = useState(0)
  const [mcqAnswers, setMcqAnswers] = useState<Record<number, string>>({})
  const [shortAnswers, setShortAnswers] = useState<Record<string, string>>({})
  const [longAnswers, setLongAnswers] = useState<Record<string, string>>({})
  const [numericalAnswers, setNumericalAnswers] = useState<Record<string, NumericalProgress>>({})

  const [timeLeft, setTimeLeft] = useState(CONFIG.TIME_MINUTES * 60)
  const [results, setResults] = useState<null | {
    mcqScore: number; shortScore: number; longScore: number; numericalScore: number; total: number
    shortBreakdown: { question: string; answer: string; modelAnswer: string; score: number; max: number; hits?: { concept: string; matched: boolean; points: number }[] }[]
    longBreakdown: { question: string; answer: string; modelAnswer: string; score: number; max: number; hits?: { concept: string; matched: boolean; points: number }[] }[]
    numericalBreakdown: { question: string; answer: string; modelAnswer: string; score: number; max: number; hits?: { concept: string; matched: boolean; points: number }[] }[]
    xpEarned: number
  }>(null)

  useEffect(() => {
    async function load() {
      const [{ data: ch }, { data: allMcqs }, { data: sq }, { data: lq }, { data: nums }] = await Promise.all([
        supabase.from('chapters').select('title, subject_id').eq('id', chapterId).single(),
        supabase.from('mcqs').select('*').eq('chapter_id', chapterId),
        supabase.from('short_questions').select('*').eq('chapter_id', chapterId),
        supabase.from('long_questions').select('*').eq('chapter_id', chapterId),
        supabase.from('numericals').select('*').eq('chapter_id', chapterId),
      ])
      if (ch) { setChapterTitle(ch.title); setSubjectId(ch.subject_id) }
      if (allMcqs) setMcqs([...allMcqs].sort(() => Math.random() - 0.5).slice(0, CONFIG.NUM_MCQS).map(shuffleMcqOptions))
      if (sq) setShortQs([...sq].sort(() => Math.random() - 0.5).slice(0, CONFIG.SHORT_OFFERED))
      if (lq) setLongQs([...lq].sort(() => Math.random() - 0.5).slice(0, CONFIG.LONG_OFFERED))

      // Numericals: the standalone `numericals` table is the primary source
      // (real board-style numericals, written for that table specifically).
      // Most Physics chapters don't have rows there yet — only fall back to
      // book_exercises' "Numerical Problems" section for THIS chapter when
      // the primary source truly has nothing, so chapters that already have
      // real numericals content are never touched or duplicated.
      let numericalRows: NumericalQ[] = (nums as NumericalQ[] | null) ?? []
      if (numericalRows.length === 0) {
        const { data: bookNums } = await supabase
          .from('book_exercises')
          .select('id, question, answer, rubric')
          .eq('chapter_id', chapterId)
          .eq('section_type', 'Numerical Problems')
        numericalRows = (bookNums as NumericalQ[] | null) ?? []
      }
      if (numericalRows.length > 0) {
        setNumericalQs([...numericalRows].sort(() => Math.random() - 0.5).slice(0, CONFIG.NUMERICAL_OFFERED))
      }

      setLoading(false)
    }
    load()
  }, [chapterId])

  const submitTest = useCallback(async () => {
    const mcqCorrect = mcqs.filter((m, i) => {
      const correctLabel = m.options.find(o => o.isCorrect)?.label
      return mcqAnswers[i] === correctLabel
    }).length
    const mcqScore = mcqCorrect * CONFIG.MCQ_MARKS

    const shortScored = shortQs.map(q => {
      const answer = shortAnswers[q.id] ?? ''
      if (q.rubric && q.rubric.length > 0) {
        const { score, hits } = gradeWithRubric(answer, q.rubric)
        return { question: q.question, answer, modelAnswer: q.answer, score: Math.min(score, CONFIG.SHORT_MARKS), max: CONFIG.SHORT_MARKS, hits }
      }
      return { question: q.question, answer, modelAnswer: q.answer, score: gradeTextAnswer(answer, q.answer, CONFIG.SHORT_MARKS), max: CONFIG.SHORT_MARKS }
    })
    const shortScore = bestOfN(shortScored.map(s => s.score), CONFIG.SHORT_ATTEMPT)

    const longScored = longQs.map(q => {
      const answer = longAnswers[q.id] ?? ''
      if (q.rubric && q.rubric.length > 0) {
        const { score, hits } = gradeWithRubric(answer, q.rubric)
        return { question: q.question, answer, modelAnswer: q.answer, score: Math.min(score, CONFIG.LONG_MARKS), max: CONFIG.LONG_MARKS, hits }
      }
      return { question: q.question, answer, modelAnswer: q.answer, score: gradeTextAnswer(answer, q.answer, CONFIG.LONG_MARKS), max: CONFIG.LONG_MARKS }
    })
    const longScore = bestOfN(longScored.map(s => s.score), CONFIG.LONG_ATTEMPT)

    const numericalScored = numericalQs.map(q => {
      const progress = numericalAnswers[q.id]
      if (q.rubric && q.rubric.length > 0) {
        const score = progress ? q.rubric.reduce((sum, r, i) => sum + (progress.stepCorrect[i] ? r.points : 0), 0) : 0
        const answer = progress ? progress.stepAnswers.filter(a => a.trim()).join(' | ') : ''
        return { question: q.question, answer, modelAnswer: q.answer, score: Math.min(score, CONFIG.NUMERICAL_MARKS), max: CONFIG.NUMERICAL_MARKS }
      }
      const answer = progress?.freeformAnswer ?? ''
      return { question: q.question, answer, modelAnswer: q.answer, score: gradeTextAnswer(answer, q.answer, CONFIG.NUMERICAL_MARKS), max: CONFIG.NUMERICAL_MARKS }
    })
    const numericalScore = bestOfN(numericalScored.map(s => s.score), CONFIG.NUMERICAL_ATTEMPT)

    const total = mcqScore + shortScore + longScore + numericalScore
    const xpEarned = 100 + Math.round((total / MAX_MARKS) * 150)

    if (user && profile) {
      await supabase.from('quiz_attempts').insert({
        user_id: user.id,
        chapter_id: chapterId,
        subject_id: null,
        score: Math.round((total / MAX_MARKS) * 100),
        total: MAX_MARKS,
        correct: mcqCorrect,
        wrong: Object.keys(mcqAnswers).length - mcqCorrect,
        skipped: mcqs.length - Object.keys(mcqAnswers).length,
        time_taken: CONFIG.TIME_MINUTES * 60 - timeLeft,
        xp_earned: xpEarned,
        answers: {
          mcqs: mcqs.map((m, i) => ({ mcq_id: m.id, chosen: mcqAnswers[i] ?? '', correct: mcqAnswers[i] === m.options.find(o => o.isCorrect)?.label })),
          short: shortScored,
          long: longScored,
          numerical: numericalScored,
        },
      })
      await updateProfileAfterAttempt(user.id, profile, xpEarned, MAX_MARKS)
      if (chapterId) {
        await updateChapterProgress(user.id, chapterId, subjectId, Math.round((total / MAX_MARKS) * 100), mcqs.length)
      }
      await refreshProfile()
    }

    setResults({ mcqScore, shortScore, longScore, numericalScore, total, shortBreakdown: shortScored, longBreakdown: longScored, numericalBreakdown: numericalScored, xpEarned })
    setPhase('results')
  }, [mcqs, mcqAnswers, shortQs, shortAnswers, longQs, longAnswers, numericalQs, numericalAnswers, timeLeft, user, profile, chapterId, subjectId, refreshProfile])

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
  const shortAnsweredCount = useMemo(() => shortQs.filter(q => (shortAnswers[q.id] ?? '').trim().length >= 10).length, [shortQs, shortAnswers])
  const longAnsweredCount = useMemo(() => longQs.filter(q => (longAnswers[q.id] ?? '').trim().length >= 10).length, [longQs, longAnswers])
  const numericalAnsweredCount = useMemo(() => numericalQs.filter(q => { const p = numericalAnswers[q.id]; return p && (p.stepChecked.some(Boolean) || p.freeformAnswer.trim().length > 0) }).length, [numericalQs, numericalAnswers])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
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
      <div className="flex flex-col h-screen bg-gray-50">
        <div className="bg-gradient-to-br from-emerald-700 to-emerald-500 px-4 pt-8 pb-8 text-white flex-shrink-0">
          <button onClick={() => navigate(-1)} className="text-emerald-200 text-xs mb-3">✕ Cancel</button>
          <div className="text-4xl mb-2">📝</div>
          <h1 className="text-2xl font-black">{chapterTitle} — Mock Test</h1>
          <p className="text-emerald-100 text-sm mt-1">Balochistan Board Format</p>
        </div>
        <div className="flex-1 px-4 py-6 flex flex-col gap-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3">Paper Structure</div>
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex justify-between"><span className="text-gray-600">Section A — MCQs</span><span className="font-bold text-slate-900">{CONFIG.NUM_MCQS} × {CONFIG.MCQ_MARKS} = {CONFIG.NUM_MCQS * CONFIG.MCQ_MARKS} marks</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Section B — Short (attempt {CONFIG.SHORT_ATTEMPT} of {CONFIG.SHORT_OFFERED})</span><span className="font-bold text-slate-900">{CONFIG.SHORT_ATTEMPT * CONFIG.SHORT_MARKS} marks</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Section C — Long (attempt {CONFIG.LONG_ATTEMPT} of {CONFIG.LONG_OFFERED})</span><span className="font-bold text-slate-900">{CONFIG.LONG_ATTEMPT * CONFIG.LONG_MARKS} marks</span></div>
              {numericalQs.length > 0 && (
                <div className="flex justify-between"><span className="text-gray-600">Section D — Numericals (2, both count)</span><span className="font-bold text-slate-900">{CONFIG.NUMERICAL_OFFERED * CONFIG.NUMERICAL_MARKS} marks</span></div>
              )}
              <div className="flex justify-between border-t border-gray-100 pt-2 mt-1"><span className="font-bold text-slate-900">Total</span><span className="font-black text-emerald-600">{MAX_MARKS} marks · {CONFIG.TIME_MINUTES} min</span></div>
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
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
        <div className="px-4 py-3 bg-white border-t border-gray-100 flex-shrink-0">
          <button
            onClick={() => setPhase('sectionA')}
            className="w-full bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all"
          >
            Start Mock Test ▶
          </button>
        </div>
      </div>
    )
  }

  // ---------------- SECTION A: MCQs ----------------
  if (phase === 'sectionA') {
    const mcq = mcqs[mcqIndex]
    const answeredCount = Object.keys(mcqAnswers).length
    return (
      <div className="flex flex-col h-screen bg-gray-50">
        <div className="bg-gradient-to-br from-emerald-700 to-emerald-500 px-4 py-3 text-white flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-black">Section A — MCQs</div>
            <Timer />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[{ val: `Q${mcqIndex + 1}`, label: 'Current' }, { val: answeredCount, label: 'Answered' }, { val: mcqs.length - answeredCount, label: 'Remaining' }].map(({ val, label }) => (
              <div key={label} className="bg-white/20 rounded-lg py-1.5 text-center">
                <div className="text-sm font-black">{val}</div>
                <div className="text-[9px] text-emerald-100">{label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="h-1 bg-gray-100 flex-shrink-0">
          <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all" style={{ width: `${((mcqIndex + 1) / mcqs.length) * 100}%` }} />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          <div className="text-[10px] text-gray-400 font-semibold">QUESTION {mcqIndex + 1} OF {mcqs.length}</div>
          <p className="text-base font-bold text-slate-900 leading-snug"><FractionText text={mcq.question} /></p>
          <div className="flex flex-col gap-2.5">
            {mcq.options.map(opt => {
              const isChosen = mcqAnswers[mcqIndex] === opt.label
              return (
                <button
                  key={opt.label}
                  onClick={() => setMcqAnswers(prev => ({ ...prev, [mcqIndex]: opt.label }))}
                  className={`flex items-center gap-3 border-2 rounded-2xl px-4 py-3 text-sm text-left transition-all active:scale-[0.99] ${isChosen ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-700'}`}
                >
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 border ${isChosen ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-current'}`}>{opt.label}</span>
                  <FractionText text={opt.text} />
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {mcqs.map((_, i) => (
              <button key={i} onClick={() => setMcqIndex(i)} className={`w-7 h-7 rounded-lg text-[10px] font-bold transition-all ${i === mcqIndex ? 'bg-slate-900 text-emerald-400' : mcqAnswers[i] ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-400'}`}>
                {i + 1}
              </button>
            ))}
          </div>
        </div>
        <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0">
          <button onClick={() => mcqIndex > 0 && setMcqIndex(mcqIndex - 1)} disabled={mcqIndex === 0} className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm disabled:opacity-40 active:scale-95 transition-all">← Previous</button>
          {mcqIndex + 1 < mcqs.length ? (
            <button onClick={() => setMcqIndex(mcqIndex + 1)} className="flex-1 bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all">Next →</button>
          ) : (
            <button onClick={() => setPhase('sectionB')} className="flex-1 bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all">Section B →</button>
          )}
        </div>
      </div>
    )
  }

  // ---------------- SECTION B: Short Questions ----------------
  if (phase === 'sectionB') {
    return (
      <div className="flex flex-col h-screen bg-gray-50">
        <div className="bg-gradient-to-br from-emerald-700 to-emerald-500 px-4 py-3 text-white flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-black">Section B — Short Questions</div>
            <Timer />
          </div>
          <div className="text-xs text-emerald-100">Attempt any {CONFIG.SHORT_ATTEMPT} of {CONFIG.SHORT_OFFERED} · {shortAnsweredCount} attempted so far</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {shortQs.map((q, i) => (
            <div key={q.id} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
              <div className="text-[10px] text-gray-400 font-semibold mb-1">Q{i + 1} · {CONFIG.SHORT_MARKS} marks</div>
              <p className="text-sm font-semibold text-slate-900 mb-2"><FractionText text={q.question} /></p>
              <textarea
                value={shortAnswers[q.id] ?? ''}
                onChange={e => setShortAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                placeholder="Write your answer..."
                rows={3}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-400"
              />
            </div>
          ))}
        </div>
        <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0">
          <button onClick={() => setPhase('sectionA')} className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm active:scale-95 transition-all">← Section A</button>
          <button onClick={() => setPhase('sectionC')} className="flex-1 bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all">Section C →</button>
        </div>
      </div>
    )
  }

  // ---------------- SECTION C: Long Questions ----------------
  if (phase === 'sectionC') {
    return (
      <div className="flex flex-col h-screen bg-gray-50">
        <div className="bg-gradient-to-br from-emerald-700 to-emerald-500 px-4 py-3 text-white flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-black">Section C — Long Questions</div>
            <Timer />
          </div>
          <div className="text-xs text-emerald-100">Attempt any {CONFIG.LONG_ATTEMPT} of {CONFIG.LONG_OFFERED} · {longAnsweredCount} attempted so far</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {longQs.map((q, i) => (
            <div key={q.id} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
              <div className="text-[10px] text-gray-400 font-semibold mb-1">Q{i + 1} · {CONFIG.LONG_MARKS} marks</div>
              <p className="text-sm font-semibold text-slate-900 mb-2"><FractionText text={q.question} /></p>
              <textarea
                value={longAnswers[q.id] ?? ''}
                onChange={e => setLongAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                placeholder="Write your detailed answer..."
                rows={6}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-400"
              />
            </div>
          ))}
        </div>
        <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0">
          <button onClick={() => setPhase('sectionB')} className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm active:scale-95 transition-all">← Section B</button>
          {numericalQs.length > 0 ? (
            <button onClick={() => setPhase('sectionD')} className="flex-1 bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all">Section D →</button>
          ) : (
            <button onClick={submitTest} className="flex-1 bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all">Submit Test ✓</button>
          )}
        </div>
      </div>
    )
  }

  // ---------------- SECTION D: Numericals ----------------
  if (phase === 'sectionD') {
    return (
      <div className="flex flex-col h-screen bg-gray-50">
        <div className="bg-gradient-to-br from-emerald-700 to-emerald-500 px-4 py-3 text-white flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-black">Section D — Numericals</div>
            <Timer />
          </div>
          <div className="text-xs text-emerald-100">Answer both · {numericalAnsweredCount} attempted so far</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {numericalQs.map(q => (
            <NumericalCard
              key={q.id}
              question={q}
              marks={CONFIG.NUMERICAL_MARKS}
              progress={numericalAnswers[q.id] ?? initNumericalProgress(q.rubric)}
              onProgressChange={next => setNumericalAnswers(prev => ({ ...prev, [q.id]: next }))}
            />
          ))}
        </div>
        <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0">
          <button onClick={() => setPhase('sectionC')} className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm active:scale-95 transition-all">← Section C</button>
          <button onClick={submitTest} className="flex-1 bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all">Submit Test ✓</button>
        </div>
      </div>
    )
  }

  // ---------------- RESULTS ----------------
  if (phase === 'results' && results) {
    return (
      <div className="flex flex-col h-screen bg-gray-50 overflow-y-auto">
        <div className="bg-gradient-to-br from-emerald-700 to-emerald-500 px-4 pt-8 pb-8 text-white flex-shrink-0 text-center">
          <div className="text-4xl mb-2">🎉</div>
          <div className="text-3xl font-black">{results.total} / {MAX_MARKS}</div>
          <div className="text-emerald-100 text-sm mt-1">+{results.xpEarned} XP earned</div>
        </div>
        <div className="p-4 flex flex-col gap-4">
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3">Section Breakdown</div>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between"><span>Section A — MCQs</span><span className="font-bold">{results.mcqScore} / {CONFIG.NUM_MCQS * CONFIG.MCQ_MARKS}</span></div>
              <div className="flex justify-between"><span>Section B — Short</span><span className="font-bold">{results.shortScore} / {CONFIG.SHORT_ATTEMPT * CONFIG.SHORT_MARKS}</span></div>
              <div className="flex justify-between"><span>Section C — Long</span><span className="font-bold">{results.longScore} / {CONFIG.LONG_ATTEMPT * CONFIG.LONG_MARKS}</span></div>
              {numericalQs.length > 0 && (
                <div className="flex justify-between"><span>Section D — Numericals</span><span className="font-bold">{results.numericalScore} / {CONFIG.NUMERICAL_ATTEMPT * CONFIG.NUMERICAL_MARKS}</span></div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3">Short Question Review</div>
            <div className="flex flex-col gap-3">
              {results.shortBreakdown.map((s, i) => (
                <div key={i} className="border-b border-gray-50 pb-3 last:border-0">
                  <div className="text-xs font-semibold text-slate-800"><FractionText text={s.question} /></div>
                  <div className="text-[10px] text-gray-500 mt-1">Your answer: {s.answer || '(not attempted)'}</div>
                  <div className="text-[10px] font-bold text-emerald-600 mt-1 mb-1.5">Score: {s.score} / {s.max}</div>
                  <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-2.5">
                    <div className="text-[9px] font-bold text-emerald-700 mb-0.5">✅ Correct Answer</div>
                    <div className="text-[10px] text-emerald-800 leading-relaxed"><FractionText text={s.modelAnswer} /></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3">Long Question Review</div>
            <div className="flex flex-col gap-3">
              {results.longBreakdown.map((s, i) => (
                <div key={i} className="border-b border-gray-50 pb-3 last:border-0">
                  <div className="text-xs font-semibold text-slate-800"><FractionText text={s.question} /></div>
                  <div className="text-[10px] text-gray-500 mt-1">Your answer: {s.answer || '(not attempted)'}</div>
                  <div className="text-[10px] font-bold text-emerald-600 mt-1 mb-1.5">Score: {s.score} / {s.max}</div>
                  <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-2.5">
                    <div className="text-[9px] font-bold text-emerald-700 mb-0.5">✅ Correct Answer</div>
                    <div className="text-[10px] text-emerald-800 leading-relaxed"><FractionText text={s.modelAnswer} /></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {results.numericalBreakdown.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm p-4">
              <div className="text-xs font-bold text-gray-400 uppercase mb-3">Numerical Review</div>
              <div className="flex flex-col gap-3">
                {results.numericalBreakdown.map((s, i) => (
                  <div key={i} className="border-b border-gray-50 pb-3 last:border-0">
                    <div className="text-xs font-semibold text-slate-800"><FractionText text={s.question} /></div>
                    <div className="text-[10px] text-gray-500 mt-1">Your answer: {s.answer || '(not attempted)'}</div>
                    <div className="text-[10px] font-bold text-emerald-600 mt-1 mb-1.5">Score: {s.score} / {s.max}</div>
                    <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-2.5">
                      <div className="text-[9px] font-bold text-emerald-700 mb-0.5">✅ Correct Answer</div>
                      <div className="text-[10px] text-emerald-800 leading-relaxed"><FractionText text={s.modelAnswer} /></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => navigate(-1)}
            className="w-full bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all"
          >
            Back to Chapter
          </button>
        </div>
      </div>
    )
  }

  return null
}
