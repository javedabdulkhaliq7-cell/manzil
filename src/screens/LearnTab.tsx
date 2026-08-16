import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import FractionText from '../components/FractionText'
import DiagramRenderer from '../components/DiagramRenderer'
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
  solution_steps?: string[] | null
  // Diagram fields — null/undefined for the vast majority of rows
  // (text-only chapters), which keeps rendering unchanged wherever no
  // diagram exists. Matches ChapterExerciseTab.tsx's convention:
  // rendered alongside the answer/solution, not the bare question.
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

function LearnCard({ ex }: { ex: BookExercise }) {
  const lc = ex.learn_content?.[0]
  const [mode, setMode] = useState<Mode>('closed')

  // Teach mode state
  const [teachInput, setTeachInput] = useState('')
  const [teachChecked, setTeachChecked] = useState<'correct' | 'wrong' | null>(null)
  const [teachRevealed, setTeachRevealed] = useState(false)

  // Try mode state
  const [tryInput, setTryInput] = useState('')
  const [tryChecked, setTryChecked] = useState<'correct' | 'wrong' | null>(null)
  const [hintsShown, setHintsShown] = useState(0)
  const [trySolutionRevealed, setTrySolutionRevealed] = useState(false)

  const reset = () => {
    setMode('closed')
    setTeachInput(''); setTeachChecked(null); setTeachRevealed(false)
    setTryInput(''); setTryChecked(null); setHintsShown(0); setTrySolutionRevealed(false)
  }

  if (!lc) return null // no learn_content yet for this question — skip silently

  const steps = ex.solution_steps ?? []
  const beforePivotal = lc.pivotal_step && lc.pivotal_step > 1 ? steps.slice(0, lc.pivotal_step - 1) : []
  const fromPivotalOn = lc.pivotal_step ? steps.slice(lc.pivotal_step - 1) : steps

  const checkTeach = () => {
    const ok = looseMatch(teachInput, lc.teach_acceptable_answers)
    setTeachChecked(ok ? 'correct' : 'wrong')
    if (ok) setTeachRevealed(true)
  }

  const checkTry = () => {
    const ok = looseMatch(tryInput, [ex.answer])
    setTryChecked(ok ? 'correct' : 'wrong')
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
              <div className="mt-2 flex gap-1.5">
                <input
                  value={teachInput}
                  onChange={e => { setTeachInput(e.target.value); setTeachChecked(null) }}
                  placeholder="Type your answer..."
                  className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                />
                <button onClick={checkTeach} className="text-xs font-bold text-white bg-brand-600 px-3 py-1.5 rounded-lg">
                  Check
                </button>
              </div>
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

          <button onClick={reset} className="text-xs font-semibold text-gray-400">← Back</button>
        </div>
      )}

      {mode === 'try' && (
        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-slate-700 space-y-2">
          <div className="flex gap-1.5">
            <input
              value={tryInput}
              onChange={e => { setTryInput(e.target.value); setTryChecked(null) }}
              placeholder="Type your full answer..."
              className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
            />
            <button onClick={checkTry} className="text-xs font-bold text-white bg-brand-600 px-3 py-1.5 rounded-lg">
              Check
            </button>
          </div>

          {tryChecked === 'correct' && (
            <div className="text-xs font-bold text-emerald-600">✓ Correct!</div>
          )}

          {tryChecked === 'wrong' && (
            <div className="space-y-1.5">
              <div className="text-xs text-red-500">Not quite — want a hint?</div>
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
  const [exercises, setExercises] = useState<BookExercise[]>([])
  const [loading, setLoading] = useState(true)
  const [activeUnit, setActiveUnit] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('book_exercises')
        .select('*, learn_content(*)')
        .eq('chapter_id', chapterId)
        .order('section_type')
        .order('question_number')
      if (data) setExercises(data as BookExercise[])
      setLoading(false)
    }
    load()
  }, [chapterId])

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Only questions with a real learn_content entry are learnable — the
  // tab quietly filters down to those rather than showing dead cards.
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
  const scopedExercises = hasUnits ? learnable.filter(ex => ex.unit_label === currentUnit) : learnable

  const sections = scopedExercises.reduce<Record<string, BookExercise[]>>((acc, ex) => {
    if (!acc[ex.section_type]) acc[ex.section_type] = []
    acc[ex.section_type].push(ex)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {hasUnits && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {unitLabels.map(label => (
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
      )}

      {Object.entries(sections).map(([sectionType, items]) => (
        <div key={sectionType}>
          <h3 className="text-sm font-bold text-brand-700 uppercase tracking-wide mb-2 dark:text-brand-400">
            {sectionType}
          </h3>
          <div className="space-y-3">
            {/* Note: groupMultiPartQuestions groups the QUESTION display
                only (shared intro shown once) — each part still gets its
                own independent Teach/Try card underneath, since each has
                its own learn_content row. */}
            {groupMultiPartQuestions(items).map(group => {
              if ('single' in group) return <LearnCard key={group.single.id} ex={group.single} />
              return (
                <div key={`g${group.question_number}`} className="space-y-2">
                  <div className="text-xs font-semibold text-gray-500 dark:text-slate-400 px-1">
                    Q{group.question_number}. <FractionText text={group.intro} />
                  </div>
                  {group.parts.map(({ item }) => <LearnCard key={item.id} ex={item} />)}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
