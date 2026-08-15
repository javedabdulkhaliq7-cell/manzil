import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import FractionText from '../components/FractionText'
import DiagramRenderer from '../components/DiagramRenderer'
import { groupMultiPartQuestions } from '../lib/multiPartQuestion'

interface BookExercise {
  id: string
  chapter_id: string
  section_type: string
  question_number: number
  question: string
  options: { A: string; B: string; C: string; D: string } | null
  answer: string
  source_citation: string
  // Math-only fields — null/undefined for Bio/Chem/Physics, which keeps
  // this component's behavior for those subjects completely unchanged.
  unit_label?: string | null
  sub_part?: string | null
  // Diagram fields — null/undefined for the vast majority of rows, which
  // keeps this component's rendering unchanged wherever no diagram exists.
  diagram_type?: string | null
  diagram_data?: any
}

interface Props {
  chapterId: string
}

// Sort real sub-unit labels ("1.1", "1.2", ...) numerically, with "REVIEW"
// always pinned last — matches how the book itself orders a chapter.
function sortUnitLabels(a: string, b: string): number {
  if (a === 'REVIEW') return 1
  if (b === 'REVIEW') return -1
  const na = parseFloat(a)
  const nb = parseFloat(b)
  if (!isNaN(na) && !isNaN(nb)) return na - nb
  return a.localeCompare(b)
}

export default function ChapterExerciseTab({ chapterId }: Props) {
  const navigate = useNavigate()
  const [exercises, setExercises] = useState<BookExercise[]>([])
  const [loading, setLoading] = useState(true)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [activeUnit, setActiveUnit] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('book_exercises')
        .select('*')
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

  if (exercises.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-gray-400 dark:text-slate-500">
        Book exercise for this chapter is coming soon.
      </div>
    )
  }

  // Sub-unit tabs only appear when unit_label is actually populated (Math
  // so far). For Bio/Chem/Physics, where every row's unit_label is
  // null/undefined, hasUnits is false and everything below behaves
  // exactly as it did before this change — same flat section_type list.
  const unitLabels = Array.from(new Set(exercises.map(ex => ex.unit_label).filter((u): u is string => !!u))).sort(sortUnitLabels)
  const hasUnits = unitLabels.length > 0
  const currentUnit = activeUnit ?? unitLabels[0] ?? null
  const scopedExercises = hasUnits ? exercises.filter(ex => ex.unit_label === currentUnit) : exercises

  // Group by section_type within the current scope, preserving query order
  const sections = scopedExercises.reduce<Record<string, BookExercise[]>>((acc, ex) => {
    if (!acc[ex.section_type]) acc[ex.section_type] = []
    acc[ex.section_type].push(ex)
    return acc
  }, {})

  const toggle = (id: string) => setRevealed(r => ({ ...r, [id]: !r[id] }))

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate(`/exercise-test/${chapterId}${hasUnits && currentUnit ? `?unit=${currentUnit}` : ''}`)}
        className="w-full bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all"
      >
        📝 {hasUnits && currentUnit ? `Test Yourself on ${currentUnit === 'REVIEW' ? 'Review' : `Ex ${currentUnit}`}` : 'Test Yourself on This Exercise'}
      </button>
      {hasUnits && (
        <button
          onClick={() => navigate(`/exercise-test/${chapterId}`)}
          className="w-full text-center text-xs font-semibold text-brand-600 -mt-4"
        >
          or test the whole chapter instead
        </button>
      )}

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
            {groupMultiPartQuestions(items).map(group => {
              // Single, ungrouped item — unchanged from before.
              if ('single' in group) {
                const ex = group.single
                return (
                  <div key={ex.id} className="bg-white border border-gray-200 rounded-xl p-3 dark:bg-slate-800 dark:border-slate-700">
                    <div className="text-sm font-medium text-gray-800 dark:text-slate-100">
                      Q{ex.question_number}{ex.sub_part ? `(${ex.sub_part})` : ''}. <FractionText text={ex.question} />
                    </div>

                    {ex.options && (
                      <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-gray-600 dark:text-slate-300">
                        <div>A) <FractionText text={ex.options.A} /></div>
                        <div>B) <FractionText text={ex.options.B} /></div>
                        <div>C) <FractionText text={ex.options.C} /></div>
                        <div>D) <FractionText text={ex.options.D} /></div>
                      </div>
                    )}

                    <button onClick={() => toggle(ex.id)} className="mt-2 text-xs font-bold text-brand-600">
                      {revealed[ex.id] ? 'Hide answer' : 'Show answer'}
                    </button>

                    {revealed[ex.id] && (
                      <div className="mt-2 pt-2 border-t border-gray-100 dark:border-slate-700">
                        <div className="text-sm text-gray-700 dark:text-slate-300"><FractionText text={ex.answer} /></div>
                        {ex.diagram_type && ex.diagram_data && (
                          <div className="mt-2">
                            <DiagramRenderer diagramType={ex.diagram_type} diagramData={ex.diagram_data} />
                          </div>
                        )}
                        <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-brand-500 bg-brand-50 px-2 py-0.5 rounded-full dark:bg-brand-950/40">
                          📖 {ex.source_citation}
                        </div>
                      </div>
                    )}
                  </div>
                )
              }

              // Grouped multi-part question — shared intro shown once,
              // parts laid out as compact wrapping chips (MCQ-style)
              // instead of repeating the intro per part.
              const groupKey = `group-${group.question_number}`
              return (
                <div key={groupKey} className="bg-white border border-gray-200 rounded-xl p-3 dark:bg-slate-800 dark:border-slate-700">
                  <div className="text-sm font-medium text-gray-800 dark:text-slate-100">
                    Q{group.question_number}{group.intro ? '. ' : ''}<FractionText text={group.intro} />
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {group.parts.map(({ item, label, text }) => (
                      <div key={item.id} className="border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-700 bg-gray-50 dark:bg-slate-950 dark:text-slate-300 dark:border-slate-700">
                        <span className="font-bold text-brand-700 dark:text-brand-400">({label})</span> <FractionText text={text} />
                      </div>
                    ))}
                  </div>

                  <button onClick={() => toggle(groupKey)} className="mt-2 text-xs font-bold text-brand-600">
                    {revealed[groupKey] ? 'Hide answers' : 'Show answers'}
                  </button>

                  {revealed[groupKey] && (
                    <div className="mt-2 pt-2 border-t border-gray-100 space-y-1 dark:border-slate-700">
                      {group.parts.map(({ item, label }) => (
                        <div key={item.id} className="text-sm text-gray-700 dark:text-slate-300">
                          <span className="font-bold text-brand-700 dark:text-brand-400">({label})</span> <FractionText text={item.answer} />
                          {item.diagram_type && item.diagram_data && (
                            <div className="mt-1">
                              <DiagramRenderer diagramType={item.diagram_type} diagramData={item.diagram_data} />
                            </div>
                          )}
                        </div>
                      ))}
                      <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-brand-500 bg-brand-50 px-2 py-0.5 rounded-full dark:bg-brand-950/40">
                        📖 {group.parts[0].item.source_citation}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
