import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { updateProfileAfterAttempt, updateChapterProgress } from '../lib/progress'
import FractionText from '../components/FractionText'

// ============================================================
// Marks per item type — the book exercise itself has a fixed number of
// questions (whatever the textbook printed), so unlike the Mock Test
// there's no "attempt X of Y" selection: every item is included.
// Update these mark values if you have the book's actual marking scheme.
// ============================================================
const MARKS = { mcq: 1, short: 2, extended: 4, numerical: 4 }
const TIME_MINUTES = 60

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
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOPWORDS.has(w)))
}

function gradeTextAnswer(studentAnswer: string, modelAnswer: string, maxMarks: number): number {
  const trimmed = studentAnswer.trim()
  if (trimmed.length < 10) return 0
  const modelKeywords = extractKeywords(modelAnswer)
  if (modelKeywords.size === 0) return 0
  const studentKeywords = extractKeywords(trimmed)
  let matched = 0
  modelKeywords.forEach(k => { if (studentKeywords.has(k)) matched++ })
  return Math.round((matched / modelKeywords.size) * maxMarks)
}

// Typo-tolerant phrase matching, same approach as the Mock Test screen.
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

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
// back to a single free-text box when a numerical has no rubric yet.
// ============================================================
interface NumericalProgress {
  stepAnswers: string[]
  stepChecked: boolean[]
  stepCorrect: boolean[]
  freeformAnswer: string
}

function initNumericalProgress(rubric: RubricConcept[] | null): NumericalProgress {
  const n = rubric?.length ?? 0
  return { stepAnswers: Array(n).fill(''), stepChecked: Array(n).fill(false), stepCorrect: Array(n).fill(false), freeformAnswer: '' }
}

function gradeWithRubric(studentAnswer: string, rubric: RubricConcept[]): number {
  const trimmed = studentAnswer.trim()
  const answerLower = trimmed.toLowerCase()
  if (trimmed.length < 10) return 0
  return rubric.reduce((sum, r) => sum + (r.keywords.some(kw => phraseMatches(answerLower, kw)) ? r.points : 0), 0)
}

function gradeAnswer(studentAnswer: string, modelAnswer: string, rubric: RubricConcept[] | null, maxMarks: number): number {
  if (rubric && rubric.length > 0) {
    return Math.min(Math.round(gradeWithRubric(studentAnswer, rubric)), maxMarks)
  }
  return gradeTextAnswer(studentAnswer, modelAnswer, maxMarks)
}

// Book exercise MCQ answers are stored verbatim as e.g. "(c) Botany" —
// extract just the letter to check against the student's selection.
function extractCorrectLetter(answer: string): string | null {
  const m = answer.match(/^\(([a-dA-D])\)/)
  return m ? m[1].toUpperCase() : null
}

interface ShuffledOption { label: string; text: string; isCorrect: boolean }

// Same shuffle-and-relabel approach as shuffleMcqOptions.ts, adapted for
// book_exercises' {A,B,C,D} option shape instead of the mcqs table's shape.
function shuffleBookExerciseOptions(options: { A: string; B: string; C: string; D: string }, correctLetter: string | null): ShuffledOption[] {
  const raw = (['A', 'B', 'C', 'D'] as const).map(label => ({ text: options[label], isCorrect: label === correctLetter }))
  for (let i = raw.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[raw[i], raw[j]] = [raw[j], raw[i]]
  }
  return raw.map((opt, idx) => ({ label: ['A', 'B', 'C', 'D'][idx], text: opt.text, isCorrect: opt.isCorrect }))
}

interface BookExercise {
  id: string
  section_type: string
  question_number: number
  question: string
  options: { A: string; B: string; C: string; D: string } | null
  answer: string
  source_citation: string
  rubric: RubricConcept[] | null
  shuffledOptions?: ShuffledOption[]
}

type Phase = 'intro' | 'mcq' | 'short' | 'extended' | 'numerical' | 'results'

// ============================================================
// One numerical, answered one rubric-concept step at a time, checked
// immediately before the next step unlocks. Falls back to a single
// free-text box when the question has no rubric yet.
// ============================================================
function NumericalCard({
  item, marks, progress, onProgressChange,
}: {
  item: BookExercise
  marks: number
  progress: NumericalProgress
  onProgressChange: (next: NumericalProgress) => void
}) {
  const rubric = item.rubric

  if (!rubric || rubric.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
        <div className="text-[10px] text-gray-400 font-semibold mb-1">{marks} marks</div>
        <p className="text-sm font-semibold text-slate-900 mb-2"><FractionText text={item.question} /></p>
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
      <p className="text-sm font-semibold text-slate-900 mb-3"><FractionText text={item.question} /></p>

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
          <div className="text-[10px] text-emerald-800 leading-relaxed"><FractionText text={item.answer} /></div>
          <div className="text-[9px] text-emerald-600 mt-1">📖 {item.source_citation}</div>
        </div>
      )}
    </div>
  )
}

export default function ChapterExerciseTestScreen() {
  const { chapterId } = useParams<{ chapterId: string }>()
  const { user, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()

  const [chapterTitle, setChapterTitle] = useState('')
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [mcqItems, setMcqItems] = useState<BookExercise[]>([])
  const [shortItems, setShortItems] = useState<BookExercise[]>([])
  const [extendedItems, setExtendedItems] = useState<BookExercise[]>([])
  const [numericalItems, setNumericalItems] = useState<BookExercise[]>([])
  const [loading, setLoading] = useState(true)

  const [phase, setPhase] = useState<Phase>('intro')
  const [mcqIndex, setMcqIndex] = useState(0)
  const [mcqAnswers, setMcqAnswers] = useState<Record<number, string>>({})
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({})
  const [numericalAnswers, setNumericalAnswers] = useState<Record<string, NumericalProgress>>({})
  const [timeLeft, setTimeLeft] = useState(TIME_MINUTES * 60)

  const [results, setResults] = useState<null | {
    mcqScore: number; shortScore: number; extendedScore: number; numericalScore: number; total: number; max: number
    mcqBreakdown: { question: string; chosen: string; correctLetter: string | null; answer: string; source: string; correct: boolean }[]
    textBreakdown: { question: string; answer: string; modelAnswer: string; source: string; score: number; max: number }[]
    numericalBreakdown: { question: string; answer: string; modelAnswer: string; source: string; score: number; max: number }[]
    xpEarned: number
  }>(null)

  useEffect(() => {
    async function load() {
      const [{ data: ch }, { data: items }] = await Promise.all([
        supabase.from('chapters').select('title, subject_id').eq('id', chapterId).single(),
        supabase.from('book_exercises').select('*').eq('chapter_id', chapterId).order('section_type').order('question_number'),
      ])
      if (ch) { setChapterTitle(ch.title); setSubjectId(ch.subject_id) }
      if (items) {
        setMcqItems((items as BookExercise[]).filter(i => i.section_type === 'Multiple Choice Questions').map(item => ({
          ...item,
          shuffledOptions: item.options ? shuffleBookExerciseOptions(item.options, extractCorrectLetter(item.answer)) : undefined,
        })))
        setShortItems((items as BookExercise[]).filter(i => i.section_type === 'Short Response Questions'))
        setExtendedItems((items as BookExercise[]).filter(i => i.section_type === 'Extended Response Questions'))
        setNumericalItems((items as BookExercise[]).filter(i => i.section_type === 'Numerical Problems'))
      }
      setLoading(false)
    }
    load()
  }, [chapterId])

  const maxMarks = mcqItems.length * MARKS.mcq + shortItems.length * MARKS.short + extendedItems.length * MARKS.extended + numericalItems.length * MARKS.numerical

  const submitTest = useCallback(async () => {
    const mcqBreakdown = mcqItems.map((item, i) => {
      const correctLetter = item.shuffledOptions?.find(o => o.isCorrect)?.label ?? null
      const chosen = mcqAnswers[i] ?? ''
      return { question: item.question, chosen, correctLetter, answer: item.answer, source: item.source_citation, correct: chosen !== '' && chosen === correctLetter }
    })
    const mcqScore = mcqBreakdown.filter(m => m.correct).length * MARKS.mcq

    const shortBreakdown = shortItems.map(item => {
      const answer = textAnswers[item.id] ?? ''
      return { question: item.question, answer, modelAnswer: item.answer, source: item.source_citation, score: gradeAnswer(answer, item.answer, item.rubric, MARKS.short), max: MARKS.short }
    })
    const shortScore = shortBreakdown.reduce((s, b) => s + b.score, 0)

    const extendedBreakdown = extendedItems.map(item => {
      const answer = textAnswers[item.id] ?? ''
      return { question: item.question, answer, modelAnswer: item.answer, source: item.source_citation, score: gradeAnswer(answer, item.answer, item.rubric, MARKS.extended), max: MARKS.extended }
    })
    const extendedScore = extendedBreakdown.reduce((s, b) => s + b.score, 0)

    const numericalBreakdown = numericalItems.map(item => {
      const progress = numericalAnswers[item.id]
      if (item.rubric && item.rubric.length > 0) {
        const score = progress ? item.rubric.reduce((sum, r, i) => sum + (progress.stepCorrect[i] ? r.points : 0), 0) : 0
        const answer = progress ? progress.stepAnswers.filter(a => a.trim()).join(' | ') : ''
        return { question: item.question, answer, modelAnswer: item.answer, source: item.source_citation, score: Math.min(score, MARKS.numerical), max: MARKS.numerical }
      }
      const answer = progress?.freeformAnswer ?? ''
      return { question: item.question, answer, modelAnswer: item.answer, source: item.source_citation, score: gradeTextAnswer(answer, item.answer, MARKS.numerical), max: MARKS.numerical }
    })
    const numericalScore = numericalBreakdown.reduce((s, b) => s + b.score, 0)

    const total = mcqScore + shortScore + extendedScore + numericalScore
    const xpEarned = 80 + Math.round((total / maxMarks) * 120)

    if (user && profile) {
      await supabase.from('quiz_attempts').insert({
        user_id: user.id,
        chapter_id: chapterId,
        subject_id: null,
        score: Math.round((total / maxMarks) * 100),
        total: maxMarks,
        correct: mcqBreakdown.filter(m => m.correct).length,
        wrong: mcqBreakdown.filter(m => m.chosen && !m.correct).length,
        skipped: mcqBreakdown.filter(m => !m.chosen).length,
        time_taken: TIME_MINUTES * 60 - timeLeft,
        xp_earned: xpEarned,
        answers: { mcqs: mcqBreakdown, short: shortBreakdown, extended: extendedBreakdown, numerical: numericalBreakdown },
      })
      await updateProfileAfterAttempt(user.id, profile, xpEarned, maxMarks)
      if (chapterId) {
        await updateChapterProgress(user.id, chapterId, subjectId, Math.round((total / maxMarks) * 100), mcqItems.length)
      }
      await refreshProfile()
    }

    setResults({
      mcqScore, shortScore, extendedScore, numericalScore, total, max: maxMarks,
      mcqBreakdown, textBreakdown: [...shortBreakdown, ...extendedBreakdown], numericalBreakdown,
      xpEarned,
    })
    setPhase('results')
  }, [mcqItems, mcqAnswers, shortItems, extendedItems, numericalItems, textAnswers, numericalAnswers, timeLeft, user, profile, chapterId, subjectId, refreshProfile, maxMarks])

  useEffect(() => {
    if (phase === 'intro' || phase === 'results') return
    const timer = setInterval(() => {
      setTimeLeft(t => { if (t <= 1) { submitTest(); return 0 } return t - 1 })
    }, 1000)
    return () => clearInterval(timer)
  }, [phase, submitTest])

  const mins = Math.floor(timeLeft / 60)
  const secs = timeLeft % 60

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (mcqItems.length === 0 && shortItems.length === 0 && extendedItems.length === 0 && numericalItems.length === 0) {
    return (
      <div className="flex flex-col h-screen items-center justify-center bg-gray-50 gap-3 px-4">
        <div className="text-sm text-gray-400 text-center">Book exercise for this chapter isn't loaded yet.</div>
        <button onClick={() => navigate(-1)} className="text-emerald-600 text-sm font-bold">← Back</button>
      </div>
    )
  }

  const Timer = () => (
    <div className={`font-black text-sm px-3 py-1.5 rounded-xl flex-shrink-0 ${timeLeft < 300 ? 'bg-red-500 text-white animate-pulse' : 'bg-white/20 text-white'}`}>
      ⏱ {mins}:{secs.toString().padStart(2, '0')}
    </div>
  )

  // Helper: which phase comes after the current one, based on what sections actually exist.
  function nextAfter(current: Phase): Phase {
    const order: Phase[] = ['mcq', 'short', 'extended', 'numerical']
    const has: Record<string, boolean> = {
      mcq: mcqItems.length > 0, short: shortItems.length > 0, extended: extendedItems.length > 0, numerical: numericalItems.length > 0,
    }
    const idx = order.indexOf(current)
    for (let i = idx + 1; i < order.length; i++) {
      if (has[order[i]]) return order[i]
    }
    return 'results'
  }

  // ---------------- INTRO ----------------
  if (phase === 'intro') {
    const firstPhase = (['mcq', 'short', 'extended', 'numerical'] as Phase[]).find(p =>
      p === 'mcq' ? mcqItems.length > 0 : p === 'short' ? shortItems.length > 0 : p === 'extended' ? extendedItems.length > 0 : numericalItems.length > 0
    ) ?? 'results'
    return (
      <div className="flex flex-col h-screen bg-gray-50">
        <div className="bg-gradient-to-br from-emerald-700 to-emerald-500 px-4 pt-8 pb-8 text-white flex-shrink-0">
          <button onClick={() => navigate(-1)} className="text-emerald-200 text-xs mb-3">✕ Cancel</button>
          <div className="text-4xl mb-2">📖</div>
          <h1 className="text-2xl font-black">{chapterTitle} — Book Exercise Test</h1>
          <p className="text-emerald-100 text-sm mt-1">Straight from your textbook's own exercise — nothing else</p>
        </div>
        <div className="flex-1 px-4 py-6 flex flex-col gap-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3">What's in this test</div>
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex justify-between"><span className="text-gray-600">MCQs</span><span className="font-bold text-slate-900">{mcqItems.length} × {MARKS.mcq} = {mcqItems.length * MARKS.mcq} marks</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Short Response</span><span className="font-bold text-slate-900">{shortItems.length} × {MARKS.short} = {shortItems.length * MARKS.short} marks</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Extended Response</span><span className="font-bold text-slate-900">{extendedItems.length} × {MARKS.extended} = {extendedItems.length * MARKS.extended} marks</span></div>
              {numericalItems.length > 0 && (
                <div className="flex justify-between"><span className="text-gray-600">Numericals</span><span className="font-bold text-slate-900">{numericalItems.length} × {MARKS.numerical} = {numericalItems.length * MARKS.numerical} marks</span></div>
              )}
              <div className="flex justify-between border-t border-gray-100 pt-2 mt-1"><span className="font-bold text-slate-900">Total</span><span className="font-black text-emerald-600">{maxMarks} marks · {TIME_MINUTES} min</span></div>
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <div className="text-xs font-bold text-amber-800 mb-2">📖 About this test</div>
            <div className="flex flex-col gap-1.5">
              {[
                'Every question here is taken exactly from your book\'s own exercise pages',
                'Answers shown afterward are exactly as extracted from the book, with page citations',
                'Numericals are answered step by step — each step is checked before the next one unlocks',
                'No AI-generated or extra practice questions are mixed in',
              ].map(t => (
                <div key={t} className="flex items-center gap-2 text-xs text-amber-700"><span className="text-amber-500">•</span> {t}</div>
              ))}
            </div>
          </div>
        </div>
        <div className="px-4 py-3 bg-white border-t border-gray-100 flex-shrink-0">
          <button onClick={() => setPhase(firstPhase)} className="w-full bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all">
            Start Test ▶
          </button>
        </div>
      </div>
    )
  }

  // ---------------- MCQ SECTION ----------------
  if (phase === 'mcq') {
    const item = mcqItems[mcqIndex]
    const answeredCount = Object.keys(mcqAnswers).length
    const nextPhase = nextAfter('mcq')
    const nextLabel = nextPhase === 'short' ? 'Short Response →' : nextPhase === 'extended' ? 'Extended Response →' : nextPhase === 'numerical' ? 'Numericals →' : 'Submit Test ✓'
    return (
      <div className="flex flex-col h-screen bg-gray-50">
        <div className="bg-gradient-to-br from-emerald-700 to-emerald-500 px-4 py-3 text-white flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-black">Multiple Choice Questions</div>
            <Timer />
          </div>
          <div className="text-xs text-emerald-100">{answeredCount} of {mcqItems.length} answered</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          <div className="text-[10px] text-gray-400 font-semibold">QUESTION {mcqIndex + 1} OF {mcqItems.length}</div>
          <p className="text-base font-bold text-slate-900 leading-snug"><FractionText text={item.question} /></p>
          <div className="flex flex-col gap-2.5">
            {(item.shuffledOptions ?? []).map(opt => {
              const isChosen = mcqAnswers[mcqIndex] === opt.label
              return (
                <button key={opt.label} onClick={() => setMcqAnswers(prev => ({ ...prev, [mcqIndex]: opt.label }))}
                  className={`flex items-center gap-3 border-2 rounded-2xl px-4 py-3 text-sm text-left transition-all active:scale-[0.99] ${isChosen ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-700'}`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 border ${isChosen ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-current'}`}>{opt.label}</span>
                  <FractionText text={opt.text} />
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {mcqItems.map((_, i) => (
              <button key={i} onClick={() => setMcqIndex(i)} className={`w-7 h-7 rounded-lg text-[10px] font-bold transition-all ${i === mcqIndex ? 'bg-slate-900 text-emerald-400' : mcqAnswers[i] ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-400'}`}>{i + 1}</button>
            ))}
          </div>
        </div>
        <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0">
          <button onClick={() => mcqIndex > 0 && setMcqIndex(mcqIndex - 1)} disabled={mcqIndex === 0} className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm disabled:opacity-40 active:scale-95 transition-all">← Previous</button>
          {mcqIndex + 1 < mcqItems.length ? (
            <button onClick={() => setMcqIndex(mcqIndex + 1)} className="flex-1 bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all">Next →</button>
          ) : (
            <button onClick={() => setPhase(nextPhase)} className="flex-1 bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all">
              {nextLabel}
            </button>
          )}
        </div>
      </div>
    )
  }

  // ---------------- SHORT RESPONSE SECTION ----------------
  if (phase === 'short') {
    const nextPhase = nextAfter('short')
    const nextLabel = nextPhase === 'extended' ? 'Extended Response →' : nextPhase === 'numerical' ? 'Numericals →' : 'Submit Test ✓'
    return (
      <div className="flex flex-col h-screen bg-gray-50">
        <div className="bg-gradient-to-br from-emerald-700 to-emerald-500 px-4 py-3 text-white flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-black">Short Response Questions</div>
            <Timer />
          </div>
          <div className="text-xs text-emerald-100">Answer all {shortItems.length}</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {shortItems.map((item, i) => (
            <div key={item.id} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
              <div className="text-[10px] text-gray-400 font-semibold mb-1">Q{i + 1} · {MARKS.short} marks</div>
              <p className="text-sm font-semibold text-slate-900 mb-2"><FractionText text={item.question} /></p>
              <textarea value={textAnswers[item.id] ?? ''} onChange={e => setTextAnswers(prev => ({ ...prev, [item.id]: e.target.value }))} placeholder="Write your answer..." rows={3} className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-400" />
            </div>
          ))}
        </div>
        <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0">
          <button onClick={() => setPhase('mcq')} className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm active:scale-95 transition-all">← MCQs</button>
          <button onClick={() => setPhase(nextPhase)} className="flex-1 bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all">
            {nextLabel}
          </button>
        </div>
      </div>
    )
  }

  // ---------------- EXTENDED RESPONSE SECTION ----------------
  if (phase === 'extended') {
    const nextPhase = nextAfter('extended')
    return (
      <div className="flex flex-col h-screen bg-gray-50">
        <div className="bg-gradient-to-br from-emerald-700 to-emerald-500 px-4 py-3 text-white flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-black">Extended Response Questions</div>
            <Timer />
          </div>
          <div className="text-xs text-emerald-100">Answer all {extendedItems.length}</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {extendedItems.map((item, i) => (
            <div key={item.id} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
              <div className="text-[10px] text-gray-400 font-semibold mb-1">Q{i + 1} · {MARKS.extended} marks</div>
              <p className="text-sm font-semibold text-slate-900 mb-2"><FractionText text={item.question} /></p>
              <textarea value={textAnswers[item.id] ?? ''} onChange={e => setTextAnswers(prev => ({ ...prev, [item.id]: e.target.value }))} placeholder="Write your detailed answer..." rows={6} className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-400" />
            </div>
          ))}
        </div>
        <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0">
          <button onClick={() => setPhase(shortItems.length > 0 ? 'short' : 'mcq')} className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm active:scale-95 transition-all">← Back</button>
          {nextPhase === 'numerical' ? (
            <button onClick={() => setPhase('numerical')} className="flex-1 bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all">Numericals →</button>
          ) : (
            <button onClick={submitTest} className="flex-1 bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all">Submit Test ✓</button>
          )}
        </div>
      </div>
    )
  }

  // ---------------- NUMERICAL SECTION ----------------
  if (phase === 'numerical') {
    const backPhase = extendedItems.length > 0 ? 'extended' : shortItems.length > 0 ? 'short' : 'mcq'
    return (
      <div className="flex flex-col h-screen bg-gray-50">
        <div className="bg-gradient-to-br from-emerald-700 to-emerald-500 px-4 py-3 text-white flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-black">Numerical Problems</div>
            <Timer />
          </div>
          <div className="text-xs text-emerald-100">Answer all {numericalItems.length}</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {numericalItems.map(item => (
            <NumericalCard
              key={item.id}
              item={item}
              marks={MARKS.numerical}
              progress={numericalAnswers[item.id] ?? initNumericalProgress(item.rubric)}
              onProgressChange={next => setNumericalAnswers(prev => ({ ...prev, [item.id]: next }))}
            />
          ))}
        </div>
        <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0">
          <button onClick={() => setPhase(backPhase)} className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm active:scale-95 transition-all">← Back</button>
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
          <div className="text-4xl mb-2">📖</div>
          <div className="text-3xl font-black">{results.total} / {results.max}</div>
          <div className="text-emerald-100 text-sm mt-1">+{results.xpEarned} XP earned</div>
        </div>
        <div className="p-4 flex flex-col gap-4">
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3">Section Breakdown</div>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between"><span>MCQs</span><span className="font-bold">{results.mcqScore} / {mcqItems.length * MARKS.mcq}</span></div>
              <div className="flex justify-between"><span>Short Response</span><span className="font-bold">{results.shortScore} / {shortItems.length * MARKS.short}</span></div>
              <div className="flex justify-between"><span>Extended Response</span><span className="font-bold">{results.extendedScore} / {extendedItems.length * MARKS.extended}</span></div>
              {numericalItems.length > 0 && (
                <div className="flex justify-between"><span>Numericals</span><span className="font-bold">{results.numericalScore} / {numericalItems.length * MARKS.numerical}</span></div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3">MCQ Review</div>
            <div className="flex flex-col gap-3">
              {results.mcqBreakdown.map((m, i) => (
                <div key={i} className="border-b border-gray-50 pb-2 last:border-0">
                  <div className="text-xs font-semibold text-slate-800"><FractionText text={m.question} /></div>
                  <div className="text-[10px] mt-1">
                    <span className={m.correct ? 'text-emerald-600 font-bold' : 'text-red-500 font-bold'}>
                      {m.correct ? '✓ Correct' : `✗ You chose ${m.chosen || '(skipped)'}`}
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">Book answer: <FractionText text={m.answer} /></div>
                  <div className="text-[9px] text-gray-400 mt-0.5">📖 {m.source}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3">Written Answer Review</div>
            <div className="flex flex-col gap-3">
              {results.textBreakdown.map((s, i) => (
                <div key={i} className="border-b border-gray-50 pb-3 last:border-0">
                  <div className="text-xs font-semibold text-slate-800"><FractionText text={s.question} /></div>
                  <div className="text-[10px] text-gray-500 mt-1">Your answer: {s.answer || '(not attempted)'}</div>
                  <div className="text-[10px] font-bold text-emerald-600 mt-1 mb-1.5">Score: {s.score} / {s.max}</div>
                  <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-2.5">
                    <div className="text-[9px] font-bold text-emerald-700 mb-0.5">✅ Book Answer</div>
                    <div className="text-[10px] text-emerald-800 leading-relaxed"><FractionText text={s.modelAnswer} /></div>
                    <div className="text-[9px] text-emerald-600 mt-1">📖 {s.source}</div>
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
                      <div className="text-[9px] font-bold text-emerald-700 mb-0.5">✅ Book Answer</div>
                      <div className="text-[10px] text-emerald-800 leading-relaxed"><FractionText text={s.modelAnswer} /></div>
                      <div className="text-[9px] text-emerald-600 mt-1">📖 {s.source}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button onClick={() => navigate(-1)} className="w-full bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all">
            Back to Chapter
          </button>
        </div>
      </div>
    )
  }

  return null
}
