import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import FractionText from '../components/FractionText'

interface ShortQuestion {
  id: string
  chapter_id: string
  question: string
  answer: string
}

interface LongQuestion {
  id: string
  chapter_id: string
  question: string
  answer: string
}

interface FillBlank {
  id: string
  chapter_id: string
  question: string
  answer: string
}

interface Props {
  chapterId: string
}

export default function ChapterPracticeTab({ chapterId }: Props) {
  const navigate = useNavigate()
  const [shortQs, setShortQs] = useState<ShortQuestion[]>([])
  const [longQs, setLongQs] = useState<LongQuestion[]>([])
  const [fillBlanks, setFillBlanks] = useState<FillBlank[]>([])
  const [loading, setLoading] = useState(true)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [activeSection, setActiveSection] = useState<'short' | 'long' | 'fib'>('short')
  const [fibInputs, setFibInputs] = useState<Record<string, string>>({})
  const [fibChecked, setFibChecked] = useState<Record<string, boolean>>({})

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: sq }, { data: lq }, { data: fb }] = await Promise.all([
        supabase.from('short_questions').select('*').eq('chapter_id', chapterId),
        supabase.from('long_questions').select('*').eq('chapter_id', chapterId),
        supabase.from('fill_in_blanks').select('*').eq('chapter_id', chapterId),
      ])
      if (sq) setShortQs(sq as ShortQuestion[])
      if (lq) setLongQs(lq as LongQuestion[])
      if (fb) setFillBlanks(fb as FillBlank[])
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

  const toggle = (id: string) => setRevealed(r => ({ ...r, [id]: !r[id] }))
  const activeList = activeSection === 'short' ? shortQs : longQs

  function checkBlank(id: string) {
    setFibChecked(c => ({ ...c, [id]: true }))
  }
  function isBlankCorrect(fb: FillBlank): boolean {
    const typed = (fibInputs[fb.id] ?? '').trim().toLowerCase()
    return typed === fb.answer.trim().toLowerCase()
  }

  const hasAnyContent = shortQs.length > 0 || longQs.length > 0 || fillBlanks.length > 0
  // Note: MCQ availability isn't known here (Practice tab never loads mcqs — see
  // decision log: MCQs are excluded from casual Practice browsing). The Mock
  // Test screen itself checks total available content and shows its own
  // "not enough content" message if truly nothing exists, so this button is
  // safe to always show whenever any Short/Long/Fill Blank content exists.

  if (!hasAnyContent) {
    return (
      <div className="text-center py-10 text-sm text-gray-400">
        Practice questions for this chapter are coming soon.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Persistent Start Mock Test entry point — always visible above the sub-tabs */}
      <button
        onClick={() => navigate(`/mock-test/chapter/${chapterId}`)}
        className="w-full bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all flex items-center justify-center gap-2"
      >
        📝 Start Mock Test
      </button>

      {/* Section toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveSection('short')}
          className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
            activeSection === 'short' ? 'bg-emerald-600 text-white' : 'bg-white border border-gray-200 text-gray-500'
          }`}
        >
          Short ({shortQs.length})
        </button>
        <button
          onClick={() => setActiveSection('long')}
          className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
            activeSection === 'long' ? 'bg-emerald-600 text-white' : 'bg-white border border-gray-200 text-gray-500'
          }`}
        >
          Long ({longQs.length})
        </button>
        <button
          onClick={() => setActiveSection('fib')}
          className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
            activeSection === 'fib' ? 'bg-emerald-600 text-white' : 'bg-white border border-gray-200 text-gray-500'
          }`}
        >
          Fill Blanks ({fillBlanks.length})
        </button>
      </div>

      {activeSection === 'fib' ? (
        <div className="space-y-3">
          <div className="text-[10px] text-gray-400 text-center">Check answers casually below — no timer or score. Use "Start Mock Test" above for the timed, scored version.</div>
          {fillBlanks.map((fb, i) => {
            const checked = fibChecked[fb.id]
            const correct = checked && isBlankCorrect(fb)
            return (
              <div key={fb.id} className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
                <div className="text-[10px] text-gray-400 font-semibold mb-2">Q{i + 1}</div>
                <p className="text-sm font-semibold text-slate-900 leading-snug mb-3"><FractionText text={fb.question} /></p>
                <div className="flex gap-2">
                  <input
                    value={fibInputs[fb.id] ?? ''}
                    onChange={e => { setFibInputs(prev => ({ ...prev, [fb.id]: e.target.value })); setFibChecked(c => ({ ...c, [fb.id]: false })) }}
                    placeholder="Type the missing word..."
                    className={`flex-1 text-sm border rounded-xl px-3 py-2 focus:outline-none ${
                      checked ? (correct ? 'border-emerald-400 bg-emerald-50' : 'border-red-400 bg-red-50') : 'border-gray-200 focus:border-emerald-400'
                    }`}
                  />
                  <button
                    onClick={() => checkBlank(fb.id)}
                    className="bg-emerald-600 text-white text-xs font-bold px-4 rounded-xl active:scale-95 transition-all"
                  >
                    Check
                  </button>
                </div>
                {checked && (
                  <div className={`mt-2 text-xs font-semibold ${correct ? 'text-emerald-600' : 'text-red-500'}`}>
                    {correct ? '✓ Correct!' : <>✗ Correct answer: <FractionText text={fb.answer} /></>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {activeList.map((q, i) => (
            <div key={q.id} className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
              <div className="text-[10px] text-gray-400 font-semibold mb-2">Q{i + 1}</div>
              <p className="text-sm font-semibold text-slate-900 leading-snug"><FractionText text={q.question} /></p>

              <button
                onClick={() => toggle(q.id)}
                className="mt-3 text-xs font-bold text-emerald-600"
              >
                {revealed[q.id] ? 'Hide answer' : 'Show answer'}
              </button>

              {revealed[q.id] && (
                <div className="mt-2 bg-emerald-50 rounded-xl p-3">
                  <p className="text-xs text-emerald-800 leading-relaxed"><FractionText text={q.answer} /></p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
