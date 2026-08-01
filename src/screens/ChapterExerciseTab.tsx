import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import FractionText from '../components/FractionText'

interface BookExercise {
  id: string
  chapter_id: string
  section_type: string
  question_number: number
  question: string
  options: { A: string; B: string; C: string; D: string } | null
  answer: string
  source_citation: string
}

interface Props {
  chapterId: string
}

export default function ChapterExerciseTab({ chapterId }: Props) {
  const navigate = useNavigate()
  const [exercises, setExercises] = useState<BookExercise[]>([])
  const [loading, setLoading] = useState(true)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})

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
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (exercises.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-gray-400">
        Book exercise for this chapter is coming soon.
      </div>
    )
  }

  // Group by section_type, preserving order already applied by the query
  const sections = exercises.reduce<Record<string, BookExercise[]>>((acc, ex) => {
    if (!acc[ex.section_type]) acc[ex.section_type] = []
    acc[ex.section_type].push(ex)
    return acc
  }, {})

  const toggle = (id: string) => setRevealed(r => ({ ...r, [id]: !r[id] }))

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate(`/exercise-test/${chapterId}`)}
        className="w-full bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all"
      >
        📝 Test Yourself on This Exercise
      </button>

      {Object.entries(sections).map(([sectionType, items]) => (
        <div key={sectionType}>
          <h3 className="text-sm font-bold text-emerald-700 uppercase tracking-wide mb-2">
            {sectionType}
          </h3>
          <div className="space-y-3">
            {items.map(ex => (
              <div key={ex.id} className="bg-white border border-gray-200 rounded-xl p-3">
                <div className="text-sm font-medium text-gray-800">
                  Q{ex.question_number}. <FractionText text={ex.question} />
                </div>

                {ex.options && (
                  <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-gray-600">
                    <div>A) <FractionText text={ex.options.A} /></div>
                    <div>B) <FractionText text={ex.options.B} /></div>
                    <div>C) <FractionText text={ex.options.C} /></div>
                    <div>D) <FractionText text={ex.options.D} /></div>
                  </div>
                )}

                <button
                  onClick={() => toggle(ex.id)}
                  className="mt-2 text-xs font-bold text-emerald-600"
                >
                  {revealed[ex.id] ? 'Hide answer' : 'Show answer'}
                </button>

                {revealed[ex.id] && (
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <div className="text-sm text-gray-700"><FractionText text={ex.answer} /></div>
                    <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-500 bg-emerald-50 px-2 py-0.5 rounded-full">
                      📖 {ex.source_citation}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
