import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import FractionText from '../components/FractionText'
import DiagramRenderer from '../components/DiagramRenderer'
import TileAnswerInput from '../components/TileAnswerInput'
import { groupMultiPartQuestions } from '../lib/multiPartQuestion'

interface LearnContent {
  id: string
  book_exercise_id: string
  pivotal_step: number | null
  interactive_prompt: string
  teach_hint: string
  teach_acceptable_answers: string[]
  try_it_step_hints: string[]
}

interface BookExercise {
  id: string
  chapter_id: string
  section_type: string
  question_number: number
  question: string
  options: { A: string; B: string; C: string; D: string } | null
  answer: string
  source_citation: string
  unit_label?: string | null
  sub_part?: string | null
  // Real shape: an array of step OBJECTS, not plain strings — each
  // step's actual math content is in step_text. what_next/what_happened
  // carry additional teaching scaffolding not yet used here.
  solution_steps?: { step_text: string; step_number?: number; what_next?: string; what_happened?: string }[] | null
  diagram_type?: string | null
  diagram_data?: any
  learn_content: LearnContent[]
}

interface Props {
  chapterId: string
}

function sortUnitLabels(a: string, b: string): number {
  if (a === 'REVIEW') return 1
  if (b === 'REVIEW') return -1
  const na = parseFloat(a)
  const nb = parseFloat(b)
  if (!isNaN(na) && !isNaN(nb)) return na - nb
  return a.localeCompare(b)
}

/** Loose match — case/whitespace-insensitive substring check, since
 *  acceptable answers are short phrases/terms, not exact strings a
 *  student would type character-for-character. */
function looseMatch(input: string, candidates: string[]): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  const a = norm(input)
  if (!a) return false
  return candidates.some(c => {
    const b = norm(c)
    return a === b || a.includes(b) || b.includes(a)
  })
}

type Mode = 'closed' | 'teach' | 'try'
type Confidence = 'sure' | 'guessing'

const REVIEW_COOLDOWN_MS = 2 * 24 * 60 * 60 * 1000 // 2 days

/** Logs one attempt — best-effort, never blocks the UI on failure. */
async function logAttempt(userId: string | undefined, bookExerciseId: string, mode: 'teach' | 'try', correct: boolean, confidence: Confidence | null) {
  if (!userId) return
  try {
    await supabase.from('learn_attempts').insert({
      user_id: userId, book_exercise_id: bookExerciseId, mode, correct, confidence,
    })
  } catch {
    // best-effort — a failed log shouldn't interrupt learning
  }
}

function ConfidenceButtons({ onPick, disabled }: { onPick: (c: Confidence) => void; disabled?: boolean }) {
  return (
    <div className="flex gap-1.5 mt-1.5">
      <button
        disabled={disabled}
        onClick={() => onPick('sure')}
        className="flex-1 text-xs font-bold text-white bg-brand-600 px-2 py-1.5 rounded-lg disabled:opacity-50"
      >
        I'm sure ✓
      </button>
      <button
        disabled={disabled}
        onClick={() => onPick('guessing')}
        className="flex-1 text-xs font-bold text-gray-600 bg-gray-100 px-2 py-1.5 rounded-lg dark:bg-slate-700 dark:text-slate-300 disabled:opacity-50"
      >
        Just guessing 🤔
      </button>
    </div>
  )
}

function LearnCard({ ex, userId }: { ex: BookExercise; userId: string | undefined }) {
  const lc = ex.learn_content?.[0]
  const [mode, setMode] = useState<Mode>('closed')

  const [teachInput, setTeachInput] = useState('')
  const [teachChecked, setTeachChecked] = useState<'correct' | 'wrong' | null>(null)
  const [teachRevealed, setTeachRevealed] = useState(false)
  const [explainInput, setExplainInput] = useState('')
  const [explainSubmitted, setExplainSubmitted] = useState(false)

  const [tryChecked, setTryChecked] = useState<'correct' | 'wrong' | null>(null)
  const [tryAttempts, setTryAttempts] = useState(0)
  const [hintsShown, setHintsShown] = useState(0)
  const [trySolutionRevealed, setTrySolutionRevealed] = useState(false)

  const reset = () => {
    setMode('closed')
    setTeachInput(''); setTeachChecked(null); setTeachRevealed(false)
    setExplainInput(''); setExplainSubmitted(false)
    setTryChecked(null); setTryAttempts(0); setHintsShown(0); setTrySolutionRevealed(false)
  }

  if (!lc) return null

  const steps = (ex.solution_steps ?? []).map(s => s.step_text)
  const beforePivotal = lc.pivotal_step && lc.pivotal_step > 1 ? steps.slice(0, lc.pivotal_step - 1) : []
  const fromPivotalOn = lc.pivotal_step ? steps.slice(lc.pivotal_step - 1) : steps

  const checkTeach = (confidence: Confidence) => {
    const ok = looseMatch(teachInput, lc.teach_acceptable_answers)
    setTeachChecked(ok ? 'correct' : 'wrong')
    if (ok) setTeachRevealed(true)
    logAttempt(userId, ex.id, 'teach', ok, confidence)
  }

  // Confidence capture isn't wired into tile mode yet — the tile widget
  // has its own built-in Check button, which doesn't combine cleanly
  // with a pre-check confidence prompt. Logs with confidence: null for
  // now rather than forcing an awkward fit; worth a fast-follow once
  // there's a clear UX for it.
  const checkTry = (ok: boolean) => {
    setTryChecked(ok ? 'correct' : 'wrong')
    setTryAttempts(n => n + 1)
    logAttempt(userId, ex.id, 'try', ok, null)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 dark:bg-slate-800 dark:border-slate-700">
      <div className="text-sm font-medium text-gray-800 dark:text-slate-100">
        Q{ex.question_number}{ex.sub_part ? `(${ex.sub_part})` : ''}. <FractionText text={ex.question} />
      </div>

      {mode === 'closed' && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => setMode('teach')}
            className="flex-1 bg-brand-50 text-brand-700 font-bold text-xs py-2 rounded-lg dark:bg-brand-950/40 dark:text-brand-400"
          >
            🎓 Teach me
          </button>
          <button
            onClick={() => setMode('try')}
            className="flex-1 bg-gray-50 text-gray-700 font-bold text-xs py-2 rounded-lg dark:bg-slate-950 dark:text-slate-300"
          >
            ✏️ Try it myself
          </button>
        </div>
      )}

      {mode === 'teach' && (
        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-slate-700 space-y-2">
          {beforePivotal.length > 0 && (
            <div className="space-y-0.5 text-sm text-gray-700 dark:text-slate-300">
              {beforePivotal.map((s, i) => <div key={i}><FractionText text={s} /></div>)}
            </div>
          )}

          <div className="bg-brand-50 dark:bg-brand-950/30 rounded-lg p-2.5">
            <div className="text-sm font-semibold text-brand-800 dark:text-brand-300">
              <FractionText text={lc.interactive_prompt} />
            </div>

            {!teachRevealed && (
              <>
                <input
                  value={teachInput}
                  onChange={e => { setTeachInput(e.target.value); setTeachChecked(null) }}
                  placeholder="Type your answer..."
                  className="mt-2 w-full text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                />
                <ConfidenceButtons onPick={checkTeach} disabled={!teachInput.trim()} />
              </>
            )}

            {teachChecked === 'wrong' && !teachRevealed && (
              <div className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                💡 <FractionText text={lc.teach_hint} />
                <button onClick={() => setTeachRevealed(true)} className="block mt-1 font-bold text-brand-600">
                  Show me instead
                </button>
              </div>
            )}

            {teachChecked === 'correct' && (
              <div className="mt-2 text-xs font-bold text-emerald-600">✓ That's it!</div>
            )}
          </div>

          {teachRevealed && (
            <div className="space-y-0.5 text-sm text-gray-700 dark:text-slate-300">
              {fromPivotalOn.length > 0
                ? fromPivotalOn.map((s, i) => <div key={i}><FractionText text={s} /></div>)
                : <div><FractionText text={ex.answer} /></div>}
              {ex.diagram_type && ex.diagram_data && (
                <div className="mt-2">
                  <DiagramRenderer diagramType={ex.diagram_type} diagramData={ex.diagram_data} />
                </div>
              )}
            </div>
          )}

          {teachRevealed && !explainSubmitted && (
            <div className="bg-gray-50 dark:bg-slate-950 rounded-lg p-2.5">
              <div className="text-xs font-semibold text-gray-600 dark:text-slate-300">
                In your own words — why does this work?
              </div>
              <div className="flex gap-1.5 mt-1.5">
                <input
                  value={explainInput}
                  onChange={e => setExplainInput(e.target.value)}
                  placeholder="Type a quick explanation..."
                  className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                />
                <button
                  disabled={!explainInput.trim()}
                  onClick={() => setExplainSubmitted(true)}
                  className="text-xs font-bold text-white bg-brand-600 px-3 py-1.5 rounded-lg disabled:opacity-50"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {explainSubmitted && (
            <div className="text-xs font-bold text-emerald-600">
              ✓ {looseMatch(explainInput, lc.teach_acceptable_answers.concat(lc.teach_hint))
                ? 'Nice — that lines up with the idea.'
                : "Good effort — putting it in your own words is what makes it stick, even if it's not exact."}
            </div>
          )}

          <button onClick={reset} className="text-xs font-semibold text-gray-400">← Back</button>
        </div>
      )}

      {mode === 'try' && (
        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-slate-700 space-y-2">
          <TileAnswerInput
            correctAnswer={ex.answer}
            feedback="immediate"
            allowRetry
            onResult={checkTry}
          />

          {tryChecked === 'wrong' && (
            <div className="space-y-1.5">
              <div className="text-xs text-red-500">
                Not quite {tryAttempts > 1 ? '— try again after the hint below' : '— want a hint?'}
              </div>
              {Array.from({ length: hintsShown }).map((_, i) => (
                <div key={i} className="text-xs text-gray-600 bg-gray-50 dark:bg-slate-950 dark:text-slate-300 rounded-lg p-2">
                  💡 <FractionText text={lc.try_it_step_hints[i]} />
                </div>
              ))}
              {hintsShown < lc.try_it_step_hints.length && (
                <button onClick={() => setHintsShown(h => h + 1)} className="text-xs font-bold text-brand-600">
                  Give me a hint ({hintsShown + 1}/{lc.try_it_step_hints.length})
                </button>
              )}
              {hintsShown >= lc.try_it_step_hints.length && !trySolutionRevealed && (
                <button onClick={() => setTrySolutionRevealed(true)} className="text-xs font-bold text-brand-600 block">
                  Show full solution
                </button>
              )}
            </div>
          )}

          {trySolutionRevealed && (
            <div className="space-y-0.5 text-sm text-gray-700 dark:text-slate-300 pt-1">
              {steps.length > 0
                ? steps.map((s, i) => <div key={i}><FractionText text={s} /></div>)
                : <div><FractionText text={ex.answer} /></div>}
              {ex.diagram_type && ex.diagram_data && (
                <div className="mt-2">
                  <DiagramRenderer diagramType={ex.diagram_type} diagramData={ex.diagram_data} />
                </div>
              )}
            </div>
          )}

          <button onClick={reset} className="text-xs font-semibold text-gray-400">← Back</button>
        </div>
      )}
    </div>
  )
}

export default function LearnTab({ chapterId }: Props) {
  const { user } = useAuth()
  const [exercises, setExercises] = useState<BookExercise[]>([])
  const [commonMistakes, setCommonMistakes] = useState<string[]>([])
  const [mistakesOpen, setMistakesOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeUnit, setActiveUnit] = useState<string | 'REVIEW_DUE' | null>(null)
  const [dueIds, setDueIds] = useState<Set<string> | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: beData }, { data: chData }] = await Promise.all([
        supabase.from('book_exercises').select('*, learn_content(*)').eq('chapter_id', chapterId)
          .order('section_type').order('question_number'),
        supabase.from('chapters').select('common_mistakes').eq('id', chapterId).single(),
      ])
      if (beData) setExercises(beData as BookExercise[])
      if (chData?.common_mistakes) {
        const raw = chData.common_mistakes as any[]
        setCommonMistakes(raw.map(m => typeof m === 'string' ? m : (m.text ?? m.mistake ?? JSON.stringify(m))))
      }
      setLoading(false)
    }
    load()
  }, [chapterId])

  // Compute the spaced-review queue: this user's most recent attempt per
  // question in this chapter, filtered to ones never gotten right, or
  // gotten right while "just guessing" more than 2 days ago.
  useEffect(() => {
    async function loadDue() {
      if (!user || exercises.length === 0) { setDueIds(new Set()); return }
      const ids = exercises.filter(ex => ex.learn_content?.length > 0).map(ex => ex.id)
      if (ids.length === 0) { setDueIds(new Set()); return }
      const { data } = await supabase
        .from('learn_attempts')
        .select('book_exercise_id, correct, confidence, attempted_at')
        .eq('user_id', user.id)
        .in('book_exercise_id', ids)
        .order('attempted_at', { ascending: false })
      const latest = new Map<string, { correct: boolean; confidence: string | null; attempted_at: string }>()
      for (const row of data ?? []) {
        if (!latest.has(row.book_exercise_id)) latest.set(row.book_exercise_id, row)
      }
      const due = new Set<string>()
      const now = Date.now()
      for (const [id, row] of latest) {
        if (!row.correct) { due.add(id); continue }
        if (row.confidence === 'guessing' && now - new Date(row.attempted_at).getTime() > REVIEW_COOLDOWN_MS) {
          due.add(id)
        }
      }
      setDueIds(due)
    }
    loadDue()
  }, [user, exercises])

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const learnable = exercises.filter(ex => ex.learn_content && ex.learn_content.length > 0)

  if (learnable.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-gray-400 dark:text-slate-500">
        Learn content for this chapter is coming soon.
      </div>
    )
  }

  const unitLabels = Array.from(new Set(learnable.map(ex => ex.unit_label).filter((u): u is string => !!u))).sort(sortUnitLabels)
  const hasUnits = unitLabels.length > 0
  const currentUnit = activeUnit ?? unitLabels[0] ?? null
  const dueCount = dueIds?.size ?? 0

  const scopedExercises =
    currentUnit === 'REVIEW_DUE' ? learnable.filter(ex => dueIds?.has(ex.id))
    : hasUnits ? learnable.filter(ex => ex.unit_label === currentUnit)
    : learnable

  const sections = scopedExercises.reduce<Record<string, BookExercise[]>>((acc, ex) => {
    if (!acc[ex.section_type]) acc[ex.section_type] = []
    acc[ex.section_type].push(ex)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {commonMistakes.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl overflow-hidden">
          <button
            onClick={() => setMistakesOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-bold text-amber-800 dark:text-amber-300"
          >
            <span>⚠️ Common mistakes to avoid</span>
            <span>{mistakesOpen ? '−' : '+'}</span>
          </button>
          {mistakesOpen && (
            <div className="px-3 pb-3 space-y-1.5">
              {commonMistakes.map((m, i) => (
                <div key={i} className="text-xs text-amber-800 dark:text-amber-300">
                  • <FractionText text={m} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {dueCount > 0 && (
          <button
            onClick={() => setActiveUnit('REVIEW_DUE')}
            className={`flex-shrink-0 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              currentUnit === 'REVIEW_DUE' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900'
            }`}
          >
            🔁 Review ({dueCount})
          </button>
        )}
        {hasUnits && unitLabels.map(label => (
          <button
            key={label}
            onClick={() => setActiveUnit(label)}
            className={`flex-shrink-0 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              currentUnit === label ? 'bg-brand-600 text-white' : 'bg-white border border-gray-200 text-gray-500 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
            }`}
          >
            {label === 'REVIEW' ? 'Review' : `Ex ${label}`}
          </button>
        ))}
      </div>

      {currentUnit === 'REVIEW_DUE' && scopedExercises.length === 0 && (
        <div className="text-center py-6 text-sm text-gray-400 dark:text-slate-500">
          Nothing due right now — nice work.
        </div>
      )}

      {Object.entries(sections).map(([sectionType, items]) => (
        <div key={sectionType}>
          <h3 className="text-sm font-bold text-brand-700 uppercase tracking-wide mb-2 dark:text-brand-400">
            {sectionType}
          </h3>
          <div className="space-y-3">
            {groupMultiPartQuestions(items).map(group => {
              if ('single' in group) return <LearnCard key={group.single.id} ex={group.single} userId={user?.id} />
              return (
                <div key={`g${group.question_number}`} className="space-y-2">
                  <div className="text-xs font-semibold text-gray-500 dark:text-slate-400 px-1">
                    Q{group.question_number}. <FractionText text={group.intro} />
                  </div>
                  {group.parts.map(({ item }) => <LearnCard key={item.id} ex={item} userId={user?.id} />)}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
