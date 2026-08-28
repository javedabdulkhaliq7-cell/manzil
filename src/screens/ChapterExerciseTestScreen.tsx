import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { updateProfileAfterAttempt, updateChapterProgress } from '../lib/progress'
import FractionText from '../components/FractionText'
import TileAnswerInput from '../components/TileAnswerInput'
import { pickDecoyTiles, tokenizeAnswer } from '../lib/tileAnswer'
import { drawCustomExerciseTest, type ExerciseSectionType } from '../lib/exerciseTestEngine'

// ============================================================
// Marks per item type — the book exercise itself has a fixed number of
// questions (whatever the textbook printed), so unlike the Mock Test
// there's no "attempt X of Y" selection: every item is included.
// Update these mark values if you have the book's actual marking scheme.
// ============================================================
export const MARKS = { mcq: 1, short: 2, extended: 4, numerical: 4 }
export const TIME_MINUTES = 60

// Book exercise MCQ answers are stored verbatim as e.g. "(c) Botany" —
// extract just the letter to check against the student's selection.

interface RubricConcept { concept: string; keywords: string[]; points: number }

// Real step shape (confirmed live, Aug 2026) — an array of step OBJECTS,
// not plain strings. This is now the real source of per-step content for
// Numericals; `rubric` has become just a one-line summary note
// ({"note": "1 mark per step..."}) with no keywords/points anymore.
export interface SolutionStep {
  step_text: string
  step_number?: number
  what_next?: string
  what_happened?: string
}

// ============================================================
// Numericals are answered step by step, one real solution step at a
// time — the student ARRANGES tiles into that step's exact text rather
// than typing it (math notation is painful to type on a phone keyboard).
// Each step unlocks only once the previous one is checked. Falls back to
// a single tile-arrangement of the whole answer when a numerical has no
// solution_steps at all (should be rare — coverage is ~100% as of the
// last audit, but not guaranteed for every future row).
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

// Book exercise MCQ answers are stored verbatim as e.g. "(c) Botany" —
// extract just the letter to check against the student's selection.
export function extractCorrectLetter(answer: string): string | null {
  const m = answer.match(/^\(([a-dA-D])\)/)
  return m ? m[1].toUpperCase() : null
}

export interface ShuffledOption { label: string; text: string; isCorrect: boolean }

// Same shuffle-and-relabel approach as shuffleMcqOptions.ts, adapted for
// book_exercises' {A,B,C,D} option shape instead of the mcqs table's shape.
export function shuffleBookExerciseOptions(options: { A: string; B: string; C: string; D: string }, correctLetter: string | null): ShuffledOption[] {
  const raw = (['A', 'B', 'C', 'D'] as const).map(label => ({ text: options[label], isCorrect: label === correctLetter }))
  for (let i = raw.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[raw[i], raw[j]] = [raw[j], raw[i]]
  }
  return raw.map((opt, idx) => ({ label: ['A', 'B', 'C', 'D'][idx], text: opt.text, isCorrect: opt.isCorrect }))
}

export interface BookExercise {
  id: string
  section_type: string
  question_number: number
  question: string
  options: { A: string; B: string; C: string; D: string } | null
  answer: string
  source_citation: string
  rubric: RubricConcept[] | null
  solution_steps?: SolutionStep[] | null
  shuffledOptions?: ShuffledOption[]
  // Math-only — null/undefined for Bio/Chem/Physics
  unit_label?: string | null
}

type Phase = 'intro' | 'customize' | 'mcq' | 'short' | 'extended' | 'numerical' | 'results'

// ============================================================
// Numericals are answered step by step, one real solution step at a
// time — tiles arranged into that step's exact text, checked
// immediately before the next step unlocks. Falls back to a single
// tile-arrangement of the whole answer when a numerical has no
// solution_steps at all (should be rare).
// ============================================================
function NumericalCard({
  item, marks, progress, onProgressChange,
}: {
  item: BookExercise
  marks: number
  progress: NumericalProgress
  onProgressChange: (next: NumericalProgress) => void
}) {
  const steps = item.solution_steps ?? []

  if (steps.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100 dark:bg-slate-800 dark:border-slate-700">
        <div className="text-[10px] text-gray-400 font-semibold mb-1 dark:text-slate-500">{marks} marks</div>
        <p className="text-sm font-semibold text-slate-900 mb-2 dark:text-slate-100"><FractionText text={item.question} /></p>
        <TileAnswerInput
          correctAnswer={item.answer}
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
      <p className="text-sm font-semibold text-slate-900 mb-3 dark:text-slate-100"><FractionText text={item.question} /></p>

      <div className="flex gap-1 mb-3">
        {steps.map((_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${
            progress.stepChecked[i] ? (progress.stepCorrect[i] ? 'bg-brand-500' : 'bg-red-300') : i === currentIndex ? 'bg-brand-200' : 'bg-gray-100 dark:bg-slate-700'
          }`} />
        ))}
      </div>

      {steps.map((step, i) => {
        if (i > currentIndex) return null
        const checked = progress.stepChecked[i]
        return (
          <div key={i} className="mb-3 last:mb-0">
            <div className="text-xs font-semibold text-gray-500 mb-1.5 dark:text-slate-400">Step {i + 1}</div>
            {!checked ? (
              <TileAnswerInput
                correctAnswer={step.step_text}
                decoyTiles={pickDecoyTiles(tokenizeAnswer(step.step_text), steps, 2)}
                feedback="onSubmit"
                allowRetry={false}
                onResult={correct => checkStep(i, correct)}
              />
            ) : (
              <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl ${progress.stepCorrect[i] ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400' : 'bg-red-50 text-red-600 dark:bg-red-950/40'}`}>
                <span>{progress.stepCorrect[i] ? '✓' : '✗'}</span>
                <span className="flex-1"><FractionText text={step.step_text} /></span>
                <span className="font-bold">{progress.stepCorrect[i] ? `+${Math.round(perStep)}` : '+0'}</span>
              </div>
            )}
          </div>
        )
      })}

      {allDone && (
        <div className="bg-brand-50 border border-brand-100 rounded-xl p-2.5 mt-2 dark:bg-brand-950/40">
          <div className="text-[9px] font-bold text-brand-700 mb-0.5 dark:text-brand-400">✅ Full Worked Solution</div>
          <div className="text-[10px] text-brand-800 leading-relaxed dark:text-brand-300"><FractionText text={item.answer} /></div>
          <div className="text-[9px] text-brand-600 mt-1">📖 {item.source_citation}</div>
        </div>
      )}
    </div>
  )
}

export default function ChapterExerciseTestScreen() {
  const { chapterId } = useParams<{ chapterId: string }>()
  const [searchParams] = useSearchParams()
  const { user, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()

  // Optional sub-unit scope, e.g. ?unit=1.1 or ?unit=REVIEW. Absent for
  // Bio/Chem/Physics links (they never send this param) and absent when a
  // Math student picks "Whole Chapter" — both cases fall through to the
  // exact old chapter-wide behavior, unchanged.
  const unitScope = searchParams.get('unit')

  const [chapterTitle, setChapterTitle] = useState('')
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [chapterNumber, setChapterNumber] = useState<number | null>(null)

  // Full pool — every book_exercises row for this chapter, loaded once on
  // mount. This IS Full Exercise Test's content, and also the source for
  // Custom's counter max values (its .length), so no second query is needed.
  const [allMcqItems, setAllMcqItems] = useState<BookExercise[]>([])
  const [allShortItems, setAllShortItems] = useState<BookExercise[]>([])
  const [allExtendedItems, setAllExtendedItems] = useState<BookExercise[]>([])
  const [allNumericalItems, setAllNumericalItems] = useState<BookExercise[]>([])

  // Active test set — whatever the student is actually attempting right
  // now. Full mode: a copy of the all* arrays. Custom mode: the drawn
  // subset from drawCustomExerciseTest. Everything below this point
  // (submitTest, phase rendering, etc) reads ONLY these, unchanged from
  // before this file had a mode choice at all.
  const [mcqItems, setMcqItems] = useState<BookExercise[]>([])
  const [shortItems, setShortItems] = useState<BookExercise[]>([])
  const [extendedItems, setExtendedItems] = useState<BookExercise[]>([])
  const [numericalItems, setNumericalItems] = useState<BookExercise[]>([])
  const [loading, setLoading] = useState(true)

  const [customCounts, setCustomCounts] = useState<Record<ExerciseSectionType, number>>({ MCQ: 0, Short: 0, Extended: 0, Numerical: 0 })
  const [drawing, setDrawing] = useState(false)
  const [drawError, setDrawError] = useState<string | null>(null)

  const [phase, setPhase] = useState<Phase>('intro')
  const [mcqIndex, setMcqIndex] = useState(0)
  const [mcqAnswers, setMcqAnswers] = useState<Record<number, string>>({})
  const [tileCorrect, setTileCorrect] = useState<Record<string, boolean>>({})
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
        supabase.from('chapters').select('title, subject_id, number').eq('id', chapterId).single(),
        supabase.from('book_exercises').select('*').eq('chapter_id', chapterId).order('section_type').order('question_number'),
      ])
      if (ch) { setChapterTitle(ch.title); setSubjectId(ch.subject_id); setChapterNumber(ch.number) }
      if (items) {
        // Scope to the requested sub-unit if one was passed in — otherwise
        // (unitScope === null) this is the exact same full-chapter list as
        // before this change, byte-for-byte the same for every other subject.
        const scoped = unitScope ? (items as BookExercise[]).filter(i => i.unit_label === unitScope) : (items as BookExercise[])
        setAllMcqItems(scoped.filter(i => i.section_type.toLowerCase() === 'mcq').map(item => ({
          ...item,
          shuffledOptions: item.options ? shuffleBookExerciseOptions(item.options, extractCorrectLetter(item.answer)) : undefined,
        })))
        setAllShortItems(scoped.filter(i => i.section_type.toLowerCase() === 'short'))
        setAllExtendedItems(scoped.filter(i => i.section_type.toLowerCase() === 'extended'))
        setAllNumericalItems(scoped.filter(i => i.section_type.toLowerCase() === 'numerical'))
      }
      setLoading(false)
    }
    load()
  }, [chapterId, unitScope])

  // Full Exercise Test — just point the active set at the full pool.
  function startFull() {
    setMcqItems(allMcqItems)
    setShortItems(allShortItems)
    setExtendedItems(allExtendedItems)
    setNumericalItems(allNumericalItems)
    const firstPhase = (['mcq', 'short', 'extended', 'numerical'] as Phase[]).find(p =>
      p === 'mcq' ? allMcqItems.length > 0 : p === 'short' ? allShortItems.length > 0 : p === 'extended' ? allExtendedItems.length > 0 : allNumericalItems.length > 0
    ) ?? 'results'
    setPhase(firstPhase)
  }

  // Custom Exercise Test — draw via the Phase 1 engine (book_exercises
  // only, gated + capped for free tier, uncapped for premium), then point
  // the active set at whatever came back.
  async function startCustomTest() {
    if (!user || !chapterId || !subjectId) return
    setDrawing(true)
    setDrawError(null)
    try {
      const result = await drawCustomExerciseTest({ userId: user.id, subjectId, chapterId, counts: customCounts, unitLabel: unitScope ?? undefined })
      const drawnMcq = (result.MCQ ?? []).map((item: BookExercise) => ({
        ...item,
        shuffledOptions: item.options ? shuffleBookExerciseOptions(item.options, extractCorrectLetter(item.answer)) : undefined,
      }))
      const drawnShort = result.Short ?? []
      const drawnExtended = result.Extended ?? []
      const drawnNumerical = result.Numerical ?? []

      setMcqItems(drawnMcq)
      setShortItems(drawnShort)
      setExtendedItems(drawnExtended)
      setNumericalItems(drawnNumerical)

      const firstPhase = (['mcq', 'short', 'extended', 'numerical'] as Phase[]).find(p =>
        p === 'mcq' ? drawnMcq.length > 0 : p === 'short' ? drawnShort.length > 0 : p === 'extended' ? drawnExtended.length > 0 : drawnNumerical.length > 0
      ) ?? null

      if (!firstPhase) {
        setDrawError('Select at least one question — all counters are at 0.')
        setDrawing(false)
        return
      }
      setPhase(firstPhase)
    } catch (e: any) {
      setDrawError(e?.message ?? 'Something went wrong drawing your custom test.')
    } finally {
      setDrawing(false)
    }
  }

  const maxMarks = mcqItems.length * MARKS.mcq + shortItems.length * MARKS.short + extendedItems.length * MARKS.extended + numericalItems.length * MARKS.numerical

  const submitTest = useCallback(async () => {
    const mcqBreakdown = mcqItems.map((item, i) => {
      const correctLetter = item.shuffledOptions?.find(o => o.isCorrect)?.label ?? null
      const chosen = mcqAnswers[i] ?? ''
      return { question: item.question, chosen, correctLetter, answer: item.answer, source: item.source_citation, correct: chosen !== '' && chosen === correctLetter }
    })
    const mcqScore = mcqBreakdown.filter(m => m.correct).length * MARKS.mcq

    const shortBreakdown = shortItems.map(item => {
      const correct = tileCorrect[item.id] ?? false
      return { question: item.question, answer: correct ? item.answer : '', modelAnswer: item.answer, source: item.source_citation, score: correct ? MARKS.short : 0, max: MARKS.short }
    })
    const shortScore = shortBreakdown.reduce((s, b) => s + b.score, 0)

    const extendedBreakdown = extendedItems.map(item => {
      const correct = tileCorrect[item.id] ?? false
      return { question: item.question, answer: correct ? item.answer : '', modelAnswer: item.answer, source: item.source_citation, score: correct ? MARKS.extended : 0, max: MARKS.extended }
    })
    const extendedScore = extendedBreakdown.reduce((s, b) => s + b.score, 0)

    const numericalBreakdown = numericalItems.map(item => {
      const progress = numericalAnswers[item.id]
      const steps = item.solution_steps ?? []
      if (steps.length > 0) {
        const perStep = MARKS.numerical / steps.length
        const score = progress ? progress.stepCorrect.reduce((sum, correct) => sum + (correct ? perStep : 0), 0) : 0
        const answer = progress ? steps.filter((_, i) => progress.stepCorrect[i]).map(s => s.step_text).join(' | ') : ''
        return { question: item.question, answer, modelAnswer: item.answer, source: item.source_citation, score: Math.round(Math.min(score, MARKS.numerical)), max: MARKS.numerical }
      }
      const correct = progress?.freeformCorrect ?? false
      return { question: item.question, answer: correct ? item.answer : '', modelAnswer: item.answer, source: item.source_citation, score: correct ? MARKS.numerical : 0, max: MARKS.numerical }
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
  }, [mcqItems, mcqAnswers, shortItems, extendedItems, numericalItems, tileCorrect, numericalAnswers, timeLeft, user, profile, chapterId, subjectId, refreshProfile, maxMarks])

  useEffect(() => {
    if (phase === 'intro' || phase === 'customize' || phase === 'results') return
    const timer = setInterval(() => {
      setTimeLeft(t => { if (t <= 1) { submitTest(); return 0 } return t - 1 })
    }, 1000)
    return () => clearInterval(timer)
  }, [phase, submitTest])

  const mins = Math.floor(timeLeft / 60)
  const secs = timeLeft % 60

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-slate-950">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (allMcqItems.length === 0 && allShortItems.length === 0 && allExtendedItems.length === 0 && allNumericalItems.length === 0) {
    return (
      <div className="flex flex-col h-screen items-center justify-center bg-gray-50 gap-3 px-4 dark:bg-slate-950">
        <div className="text-sm text-gray-400 text-center dark:text-slate-500">Book exercise for this chapter isn't loaded yet.</div>
        <button onClick={() => navigate(-1)} className="text-brand-600 text-sm font-bold">← Back</button>
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
    const previewMax = allMcqItems.length * MARKS.mcq + allShortItems.length * MARKS.short + allExtendedItems.length * MARKS.extended + allNumericalItems.length * MARKS.numerical
    const isPremium = profile?.plan === 'premium'
    const customLocked = !isPremium && chapterNumber !== 1
    // Custom Test's draw now supports unit scoping end-to-end —
    // randomDrawEngine's SourceRequest.unitLabel and
    // drawCustomExerciseTest()'s CustomExerciseRequest.unitLabel both
    // exist, and startCustomTest() above passes unitScope through. So
    // Custom no longer needs to be force-disabled while scoped. Left as a
    // named constant (always false) rather than removed outright, so the
    // button JSX below doesn't need restructuring.
    const customDisabledForScope = false
    return (
      <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
        <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 pt-8 pb-8 text-white flex-shrink-0">
          <button onClick={() => navigate(-1)} className="text-brand-200 text-xs mb-3">✕ Cancel</button>
          <div className="text-4xl mb-2">📖</div>
          <h1 className="text-2xl font-black">{chapterTitle}{unitScope ? ` — ${unitScope === 'REVIEW' ? 'Review' : `Ex ${unitScope}`}` : ''} — Book Exercise Test</h1>
          <p className="text-brand-100 text-sm mt-1">Straight from your textbook's own exercise — nothing else</p>
        </div>
        <div className="flex-1 px-4 py-6 flex flex-col gap-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3 dark:text-slate-500">What's in this chapter</div>
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-300">MCQs</span><span className="font-bold text-slate-900 dark:text-slate-100">{allMcqItems.length} × {MARKS.mcq} = {allMcqItems.length * MARKS.mcq} marks</span></div>
              <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-300">Short Response</span><span className="font-bold text-slate-900 dark:text-slate-100">{allShortItems.length} × {MARKS.short} = {allShortItems.length * MARKS.short} marks</span></div>
              <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-300">Extended Response</span><span className="font-bold text-slate-900 dark:text-slate-100">{allExtendedItems.length} × {MARKS.extended} = {allExtendedItems.length * MARKS.extended} marks</span></div>
              {allNumericalItems.length > 0 && (
                <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-300">Numericals</span><span className="font-bold text-slate-900 dark:text-slate-100">{allNumericalItems.length} × {MARKS.numerical} = {allNumericalItems.length * MARKS.numerical} marks</span></div>
              )}
              <div className="flex justify-between border-t border-gray-100 pt-2 mt-1 dark:border-slate-700"><span className="font-bold text-slate-900 dark:text-slate-100">Full Test Total</span><span className="font-black text-brand-600">{previewMax} marks · {TIME_MINUTES} min</span></div>
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 dark:bg-amber-950/30">
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
        <div className="px-4 py-3 bg-white border-t border-gray-100 flex-shrink-0 flex flex-col gap-2 dark:bg-slate-800 dark:border-slate-700">
          <button onClick={startFull} className="w-full bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">
            Full Exercise Test ▶
          </button>
          {/* ASSUMPTION: route path mirrors Mock Test's own printable route
              (seen as /mock-test/chapter/:id/print) — adjust if your
              Exercise Test print route is registered differently. */}
          <button
            onClick={() => navigate(`/exercise-test/${chapterId}/print?mode=full${unitScope ? `&unit=${unitScope}` : ''}`)}
            className="w-full text-center text-xs font-semibold text-gray-500 py-1 dark:text-slate-400"
          >
            🖨 Print Full Exercise Test
          </button>
          <button
            onClick={() => !customLocked && !customDisabledForScope && setPhase('customize')}
            disabled={customLocked || customDisabledForScope}
            className={`w-full font-bold py-4 rounded-2xl text-sm active:scale-95 transition-all border-2 ${(customLocked || customDisabledForScope) ? 'border-gray-200 text-gray-400 dark:text-slate-500 dark:border-slate-700' : 'border-brand-600 text-brand-700 dark:text-brand-400'}`}
          >
            {customLocked ? '🔒 Custom Exercise Test — Premium' : customDisabledForScope ? 'Custom Test — switch to Whole Chapter first' : 'Custom Exercise Test ⚙'}
          </button>
        </div>
      </div>
    )
  }

  // ---------------- CUSTOM COUNTER SELECTION ----------------
  if (phase === 'customize') {
    const rows: { key: ExerciseSectionType; label: string; max: number }[] = [
      { key: 'MCQ', label: 'MCQs', max: allMcqItems.length },
      { key: 'Short', label: 'Short Response', max: allShortItems.length },
      { key: 'Extended', label: 'Extended Response', max: allExtendedItems.length },
      { key: 'Numerical', label: 'Numericals', max: allNumericalItems.length },
    ]
    const totalSelected = Object.values(customCounts).reduce((a, b) => a + b, 0)

    function setCount(key: ExerciseSectionType, next: number, max: number) {
      const clamped = Math.max(0, Math.min(next, max))
      setCustomCounts(prev => ({ ...prev, [key]: clamped }))
    }

    return (
      <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
        <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 pt-8 pb-8 text-white flex-shrink-0">
          <button onClick={() => setPhase('intro')} className="text-brand-200 text-xs mb-3">← Back</button>
          <div className="text-4xl mb-2">⚙</div>
          <h1 className="text-2xl font-black">Build Your Custom Test</h1>
          <p className="text-brand-100 text-sm mt-1">Pick how many of each type — random pull from this chapter's book exercises</p>
        </div>
        <div className="flex-1 px-4 py-6 flex flex-col gap-3 overflow-y-auto">
          {rows.map(r => (
            <div key={r.key} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100 flex items-center justify-between dark:bg-slate-800 dark:border-slate-700">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{r.label}</div>
                <div className="text-[10px] text-gray-400 dark:text-slate-500">{r.max} available in this chapter</div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCount(r.key, customCounts[r.key] - 1, r.max)}
                  disabled={r.max === 0}
                  className="w-8 h-8 rounded-xl bg-gray-100 text-gray-600 font-bold disabled:opacity-30 active:scale-95 transition-all dark:bg-slate-700 dark:text-slate-300"
                >−</button>
                <span className="w-6 text-center font-black text-slate-900 dark:text-slate-100">{customCounts[r.key]}</span>
                <button
                  onClick={() => setCount(r.key, customCounts[r.key] + 1, r.max)}
                  disabled={r.max === 0 || customCounts[r.key] >= r.max}
                  className="w-8 h-8 rounded-xl bg-brand-600 text-white font-bold disabled:opacity-30 active:scale-95 transition-all"
                >+</button>
              </div>
            </div>
          ))}
          {drawError && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-3 text-xs text-red-600 font-semibold dark:bg-red-950/40">{drawError}</div>
          )}
        </div>
        <div className="px-4 py-3 bg-white border-t border-gray-100 flex-shrink-0 flex flex-col gap-2 dark:bg-slate-800 dark:border-slate-700">
          <button
            onClick={startCustomTest}
            disabled={totalSelected === 0 || drawing}
            className="w-full bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all disabled:opacity-50"
          >
            {drawing ? 'Building your test…' : `Start Custom Test (${totalSelected}) ▶`}
          </button>
          <button
            onClick={() => {
              const params = new URLSearchParams({
                mode: 'custom',
                mcq: String(customCounts.MCQ),
                short: String(customCounts.Short),
                extended: String(customCounts.Extended),
                numerical: String(customCounts.Numerical),
                ...(unitScope ? { unit: unitScope } : {}),
              })
              navigate(`/exercise-test/${chapterId}/print?${params.toString()}`)
            }}
            disabled={totalSelected === 0}
            className="w-full text-center text-xs font-semibold text-gray-500 py-1 disabled:opacity-40 dark:text-slate-400"
          >
            🖨 Print This Custom Test
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
      <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
        <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 py-3 text-white flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-black">Multiple Choice Questions</div>
            <Timer />
          </div>
          <div className="text-xs text-brand-100">{answeredCount} of {mcqItems.length} answered</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          <div className="text-[10px] text-gray-400 font-semibold dark:text-slate-500">QUESTION {mcqIndex + 1} OF {mcqItems.length}</div>
          <p className="text-base font-bold text-slate-900 leading-snug dark:text-slate-100"><FractionText text={item.question} /></p>
          <div className="flex flex-col gap-2.5">
            {(item.shuffledOptions ?? []).map(opt => {
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
            {mcqItems.map((_, i) => (
              <button key={i} onClick={() => setMcqIndex(i)} className={`w-7 h-7 rounded-lg text-[10px] font-bold transition-all ${i === mcqIndex ? 'bg-slate-900 text-brand-400' : mcqAnswers[i] ? 'bg-brand-500 text-white' : 'bg-gray-200 text-gray-400 dark:bg-slate-600 dark:text-slate-500'}`}>{i + 1}</button>
            ))}
          </div>
        </div>
        <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0 dark:bg-slate-800 dark:border-slate-700">
          <button onClick={() => mcqIndex > 0 && setMcqIndex(mcqIndex - 1)} disabled={mcqIndex === 0} className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm disabled:opacity-40 active:scale-95 transition-all dark:text-slate-400 dark:border-slate-700">← Previous</button>
          {mcqIndex + 1 < mcqItems.length ? (
            <button onClick={() => setMcqIndex(mcqIndex + 1)} className="flex-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">Next →</button>
          ) : (
            <button onClick={() => setPhase(nextPhase)} className="flex-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">
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
      <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
        <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 py-3 text-white flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-black">Short Response Questions</div>
            <Timer />
          </div>
          <div className="text-xs text-brand-100">Answer all {shortItems.length}</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {shortItems.map((item, i) => (
            <div key={item.id} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100 dark:bg-slate-800 dark:border-slate-700">
              <div className="text-[10px] text-gray-400 font-semibold mb-1 dark:text-slate-500">Q{i + 1} · {MARKS.short} marks</div>
              <p className="text-sm font-semibold text-slate-900 mb-2 dark:text-slate-100"><FractionText text={item.question} /></p>
              <TileAnswerInput correctAnswer={item.answer} feedback="onSubmit" allowRetry={false} onResult={correct => setTileCorrect(prev => ({ ...prev, [item.id]: correct }))} />
            </div>
          ))}
        </div>
        <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0 dark:bg-slate-800 dark:border-slate-700">
          <button onClick={() => setPhase('mcq')} className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm active:scale-95 transition-all dark:text-slate-400 dark:border-slate-700">← MCQs</button>
          <button onClick={() => setPhase(nextPhase)} className="flex-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">
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
      <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
        <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 py-3 text-white flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-black">Extended Response Questions</div>
            <Timer />
          </div>
          <div className="text-xs text-brand-100">Answer all {extendedItems.length}</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {extendedItems.map((item, i) => (
            <div key={item.id} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100 dark:bg-slate-800 dark:border-slate-700">
              <div className="text-[10px] text-gray-400 font-semibold mb-1 dark:text-slate-500">Q{i + 1} · {MARKS.extended} marks</div>
              <p className="text-sm font-semibold text-slate-900 mb-2 dark:text-slate-100"><FractionText text={item.question} /></p>
              <TileAnswerInput correctAnswer={item.answer} feedback="onSubmit" allowRetry={false} onResult={correct => setTileCorrect(prev => ({ ...prev, [item.id]: correct }))} />
            </div>
          ))}
        </div>
        <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0 dark:bg-slate-800 dark:border-slate-700">
          <button onClick={() => setPhase(shortItems.length > 0 ? 'short' : 'mcq')} className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm active:scale-95 transition-all dark:text-slate-400 dark:border-slate-700">← Back</button>
          {nextPhase === 'numerical' ? (
            <button onClick={() => setPhase('numerical')} className="flex-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">Numericals →</button>
          ) : (
            <button onClick={submitTest} className="flex-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">Submit Test ✓</button>
          )}
        </div>
      </div>
    )
  }

  // ---------------- NUMERICAL SECTION ----------------
  if (phase === 'numerical') {
    const backPhase = extendedItems.length > 0 ? 'extended' : shortItems.length > 0 ? 'short' : 'mcq'
    return (
      <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
        <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 py-3 text-white flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-black">Numerical Problems</div>
            <Timer />
          </div>
          <div className="text-xs text-brand-100">Answer all {numericalItems.length}</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {numericalItems.map(item => (
            <NumericalCard
              key={item.id}
              item={item}
              marks={MARKS.numerical}
              progress={numericalAnswers[item.id] ?? initNumericalProgress(item.solution_steps?.length ?? 0)}
              onProgressChange={next => setNumericalAnswers(prev => ({ ...prev, [item.id]: next }))}
            />
          ))}
        </div>
        <div className="px-4 py-3 flex gap-3 bg-white border-t border-gray-100 flex-shrink-0 dark:bg-slate-800 dark:border-slate-700">
          <button onClick={() => setPhase(backPhase)} className="flex-1 border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-2xl text-sm active:scale-95 transition-all dark:text-slate-400 dark:border-slate-700">← Back</button>
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
          <div className="text-4xl mb-2">📖</div>
          <div className="text-3xl font-black">{results.total} / {results.max}</div>
          <div className="text-brand-100 text-sm mt-1">+{results.xpEarned} XP earned</div>
        </div>
        <div className="p-4 flex flex-col gap-4">
          <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3 dark:text-slate-500">Section Breakdown</div>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between"><span>MCQs</span><span className="font-bold">{results.mcqScore} / {mcqItems.length * MARKS.mcq}</span></div>
              <div className="flex justify-between"><span>Short Response</span><span className="font-bold">{results.shortScore} / {shortItems.length * MARKS.short}</span></div>
              <div className="flex justify-between"><span>Extended Response</span><span className="font-bold">{results.extendedScore} / {extendedItems.length * MARKS.extended}</span></div>
              {numericalItems.length > 0 && (
                <div className="flex justify-between"><span>Numericals</span><span className="font-bold">{results.numericalScore} / {numericalItems.length * MARKS.numerical}</span></div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3 dark:text-slate-500">MCQ Review</div>
            <div className="flex flex-col gap-3">
              {results.mcqBreakdown.map((m, i) => (
                <div key={i} className="border-b border-gray-50 pb-2 last:border-0">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-100"><FractionText text={m.question} /></div>
                  <div className="text-[10px] mt-1">
                    <span className={m.correct ? 'text-brand-600 font-bold' : 'text-red-500 font-bold'}>
                      {m.correct ? '✓ Correct' : `✗ You chose ${m.chosen || '(skipped)'}`}
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5 dark:text-slate-400">Book answer: <FractionText text={m.answer} /></div>
                  <div className="text-[9px] text-gray-400 mt-0.5 dark:text-slate-500">📖 {m.source}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3 dark:text-slate-500">Written Answer Review</div>
            <div className="flex flex-col gap-3">
              {results.textBreakdown.map((s, i) => (
                <div key={i} className="border-b border-gray-50 pb-3 last:border-0">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-100"><FractionText text={s.question} /></div>
                  <div className="text-[10px] text-gray-500 mt-1 dark:text-slate-400">Your answer: {s.answer || '(not attempted)'}</div>
                  <div className="text-[10px] font-bold text-brand-600 mt-1 mb-1.5">Score: {s.score} / {s.max}</div>
                  <div className="bg-brand-50 border border-brand-100 rounded-xl p-2.5 dark:bg-brand-950/40">
                    <div className="text-[9px] font-bold text-brand-700 mb-0.5 dark:text-brand-400">✅ Book Answer</div>
                    <div className="text-[10px] text-brand-800 leading-relaxed dark:text-brand-300"><FractionText text={s.modelAnswer} /></div>
                    <div className="text-[9px] text-brand-600 mt-1">📖 {s.source}</div>
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
                      <div className="text-[9px] font-bold text-brand-700 mb-0.5 dark:text-brand-400">✅ Book Answer</div>
                      <div className="text-[10px] text-brand-800 leading-relaxed dark:text-brand-300"><FractionText text={s.modelAnswer} /></div>
                      <div className="text-[9px] text-brand-600 mt-1">📖 {s.source}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button onClick={() => navigate(-1)} className="w-full bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">
            Back to Chapter
          </button>
        </div>
      </div>
    )
  }

  return null
}
