import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, Printer, Lock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { drawCustomExerciseTest, PlanGateError, DailyCapError, type ExerciseSectionType } from '../lib/exerciseTestEngine'
import {
  MARKS, TIME_MINUTES, extractCorrectLetter, shuffleBookExerciseOptions,
  type BookExercise,
  // ASSUMPTION: adjust this import path to wherever ChapterExerciseTestScreen.tsx
  // actually lives in your project (e.g. '../screens/ChapterExerciseTestScreen').
} from './ChapterExerciseTestScreen'
import { PrintStyles, PaperHeader, Section } from '../components/printLayout'
import FractionText from '../components/FractionText'
import { groupMultiPartQuestions, type GroupedItem } from '../lib/multiPartQuestion'

type GateState = 'checking' | 'blocked-free-tier' | 'blocked-daily-cap' | 'ready'
/** Answer-key counterpart to GroupedQuestionList — numbering must match
 *  it exactly (one number per GROUP, not per part), so a printed
 *  question "2. Verify: (i)... (ii)..." maps to the same "2." in the
 *  key, with each part's answer listed on its own line underneath. */
function GroupedAnswerList({ items }: { items: BookExercise[] }) {
  const groups = groupMultiPartQuestions(items) as GroupedItem<BookExercise>[]
  let n = 0
  return (
    <>
      {groups.map(group => {
        if ('single' in group) {
          n++
          const q = group.single
          return (
            <div key={q.id} className="compact-q mb-1">
              <span className="font-semibold">{n}.</span> <FractionText text={q.answer} />
              <span className="text-gray-400"> ({q.source_citation})</span>
            </div>
          )
        }
        n++
        return (
          <div key={`g${group.question_number}`} className="compact-q mb-1">
            <span className="font-semibold">{n}.</span>
            <div className="grid gap-x-4 gap-y-0.5 pl-2 grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
              {group.parts.map(({ item, label }) => (
                <div key={item.id}>
                  <span className="font-semibold">({label})</span> <FractionText text={item.answer} />
                </div>
              ))}
            </div>
            <span className="text-gray-400"> ({group.parts[0].item.source_citation})</span>
          </div>
        )
      })}
    </>
  )
}

type Mode = 'full' | 'custom'

/** Renders a list of book_exercises rows, grouping sibling multi-part
 *  rows under their shared intro (shown once) with parts laid out as
 *  compact wrapping chips instead of repeating the intro per line.
 *  Falls back to plain "N. text" for rows with no real grouping. */
function GroupedQuestionList({ items }: { items: BookExercise[] }) {
  const groups = groupMultiPartQuestions(items) as GroupedItem<BookExercise>[]
  let n = 0
  return (
    <>
      {groups.map(group => {
        if ('single' in group) {
          n++
          return (
            <div key={group.single.id} className="compact-q mb-1.5">
              <FractionText text={`${n}. ${group.single.question}`} />
            </div>
          )
        }
        n++
        return (
          <div key={`g${group.question_number}`} className="compact-q mb-1.5">
            <div className="font-semibold">
              <FractionText text={`${n}. ${group.intro}`} />
            </div>
            <div className="grid gap-x-4 gap-y-0.5 pl-2 grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
              {group.parts.map(({ item, label, text }) => (
                <div key={item.id}>
                  <span className="font-semibold">({label})</span> <FractionText text={text} />
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}

export default function ExerciseTestPrintView() {
  const { chapterId } = useParams<{ chapterId: string }>()
  const [searchParams] = useSearchParams()
  const { user, profile } = useAuth()
  const navigate = useNavigate()

  const mode: Mode = searchParams.get('mode') === 'custom' ? 'custom' : 'full'
  // Optional sub-unit scope, e.g. ?unit=1.1 or ?unit=REVIEW — sent by
  // ChapterExerciseTestScreen.tsx's print links when a Math sub-unit is
  // active. Absent for Bio/Chem/Physics and for whole-chapter Math, in
  // which case behavior is byte-for-byte the same as before this change.
  const unitScope = searchParams.get('unit')

  const [gate, setGate] = useState<GateState>('checking')
  const [includeAnswerKey, setIncludeAnswerKey] = useState(true)
  const [chapterTitle, setChapterTitle] = useState('')

  const [mcqs, setMcqs] = useState<BookExercise[]>([])
  const [shortQs, setShortQs] = useState<BookExercise[]>([])
  const [extendedQs, setExtendedQs] = useState<BookExercise[]>([])
  const [numericalQs, setNumericalQs] = useState<BookExercise[]>([])

  useEffect(() => {
    async function run() {
      if (!chapterId || !user || !profile) return

      const { data: ch } = await supabase.from('chapters').select('title, subject_id, number').eq('id', chapterId).single()
      if (!ch) { setGate('blocked-free-tier'); return }
      setChapterTitle(unitScope ? `${ch.title} — ${unitScope === 'REVIEW' ? 'Review' : `Ex ${unitScope}`}` : ch.title)

      function bucket(items: BookExercise[]) {
        setMcqs(items.filter(i => i.section_type.toLowerCase() === 'mcq').map(item => ({
          ...item,
          shuffledOptions: item.options ? shuffleBookExerciseOptions(item.options, extractCorrectLetter(item.answer)) : undefined,
        })))
        setShortQs(items.filter(i => i.section_type.toLowerCase() === 'short'))
        setExtendedQs(items.filter(i => i.section_type.toLowerCase() === 'extended'))
        setNumericalQs(items.filter(i => i.section_type.toLowerCase() === 'numerical'))
      }

      if (mode === 'full') {
        // Full Exercise Test print: ungated, uncapped — matches the
        // in-app Full mode's existing rule exactly. No plan/cap check.
        const { data: items } = await supabase
          .from('book_exercises')
          .select('*')
          .eq('chapter_id', chapterId)
          .order('section_type')
          .order('question_number')
        // Scope to the requested sub-unit if one was passed in — otherwise
        // (unitScope === null) this is the exact same full-chapter list as
        // before this change, byte-for-byte the same for every other subject.
        const scoped = unitScope ? ((items ?? []) as BookExercise[]).filter(i => i.unit_label === unitScope) : ((items ?? []) as BookExercise[])
        bucket(scoped)
        setGate('ready')
        return
      }

      // mode === 'custom': gated + capped, same shared cap as Mock Test
      // printable. drawCustomExerciseTest owns the gating/cap check —
      // no duplicate check here, single source of truth.
      const counts: Partial<Record<ExerciseSectionType, number>> = {
        MCQ: parseInt(searchParams.get('mcq') ?? '0', 10),
        Short: parseInt(searchParams.get('short') ?? '0', 10),
        Extended: parseInt(searchParams.get('extended') ?? '0', 10),
        Numerical: parseInt(searchParams.get('numerical') ?? '0', 10),
      }

      try {
        const result = await drawCustomExerciseTest({ userId: user.id, subjectId: ch.subject_id, chapterId, counts, unitLabel: unitScope ?? undefined })
        setMcqs((result.MCQ ?? []).map((item: BookExercise) => ({
          ...item,
          shuffledOptions: item.options ? shuffleBookExerciseOptions(item.options, extractCorrectLetter(item.answer)) : undefined,
        })))
        setShortQs(result.Short ?? [])
        setExtendedQs(result.Extended ?? [])
        setNumericalQs(result.Numerical ?? [])
        setGate('ready')
      } catch (e) {
        if (e instanceof DailyCapError) setGate('blocked-daily-cap')
        else if (e instanceof PlanGateError) setGate('blocked-free-tier')
        else setGate('blocked-free-tier') // NoSelectionError or anything unexpected — safest fallback, shouldn't happen if the counter screen validated first
      }
    }
    run()
  }, [chapterId, user, profile, mode, unitScope])

  const maxMarks = mcqs.length * MARKS.mcq + shortQs.length * MARKS.short + extendedQs.length * MARKS.extended + numericalQs.length * MARKS.numerical
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  if (gate === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (gate === 'blocked-free-tier') {
    return (
      <div className="flex flex-col h-screen bg-gray-50 items-center justify-center gap-4 px-6 text-center no-print">
        <button onClick={() => navigate(-1)} className="absolute top-4 left-4 text-gray-400 flex items-center gap-1 text-xs">
          <ChevronLeft size={14} /> Back
        </button>
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
          <Lock size={26} className="text-gray-400" />
        </div>
        <div>
          <div className="font-bold text-slate-900 mb-1">Printable Custom Exercise Test is Premium</div>
          <div className="text-xs text-gray-400">Free plan includes this for Chapter 1 of every subject. Upgrade to print every chapter.</div>
        </div>
        <button onClick={() => navigate('/profile')} className="bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold px-8 py-3.5 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">
          Upgrade to Premium
        </button>
      </div>
    )
  }

  if (gate === 'blocked-daily-cap') {
    return (
      <div className="flex flex-col h-screen bg-gray-50 items-center justify-center gap-4 px-6 text-center no-print">
        <button onClick={() => navigate(-1)} className="absolute top-4 left-4 text-gray-400 flex items-center gap-1 text-xs">
          <ChevronLeft size={14} /> Back
        </button>
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
          <Lock size={26} className="text-gray-400" />
        </div>
        <div>
          <div className="font-bold text-slate-900 mb-1">Daily Limit Reached</div>
          <div className="text-xs text-gray-400">Free plan includes 3 printable tests per subject per day, shared across Mock Test and Exercise Test. Resets at midnight (Pakistan time), or upgrade for unlimited.</div>
        </div>
        <button onClick={() => navigate('/profile')} className="bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold px-8 py-3.5 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">
          Upgrade to Premium
        </button>
      </div>
    )
  }

  return (
    <div className="bg-gray-100 min-h-screen">
      <PrintStyles />

      <div className="no-print sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm">
        <button onClick={() => navigate(-1)} className="text-gray-500 flex items-center gap-1 text-xs font-semibold">
          <ChevronLeft size={16} /> Back
        </button>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 font-semibold select-none">
          <input
            type="checkbox"
            checked={includeAnswerKey}
            onChange={e => setIncludeAnswerKey(e.target.checked)}
            className="accent-brand-600 w-3.5 h-3.5"
          />
          Include Answer Key
        </label>
        <button onClick={() => window.print()} className="bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-lg shadow-brand-200 active:scale-95 transition-all flex items-center gap-1.5">
          <Printer size={14} /> Print / Save PDF
        </button>
      </div>

      {/* ===== PAGE 1: QUESTIONS ===== */}
      <div className="print-sheet print-page bg-white shadow-lg my-4 p-6 text-slate-900">
        <PaperHeader kind="Exercise Test" chapterTitle={chapterTitle} today={today} maxMarks={maxMarks} time={TIME_MINUTES} />

        {mcqs.length > 0 && (
          <Section title={`Section A — MCQs (${mcqs.length} × ${MARKS.mcq})`}>
            {mcqs.map((q, i) => (
              <div key={q.id} className="compact-q mb-1.5">
                <div className="font-semibold"><FractionText text={`${i + 1}. ${q.question}`} /></div>
                <div className="pl-2">
                  {q.shuffledOptions?.map(opt => (
                    <span key={opt.label} className="mr-3">({opt.label.toLowerCase()}) <FractionText text={opt.text} /></span>
                  ))}
                </div>
              </div>
            ))}
          </Section>
        )}

        {shortQs.length > 0 && (
          <Section title={`Section B — Short Response (${shortQs.length} × ${MARKS.short})`}>
            <GroupedQuestionList items={shortQs} />
          </Section>
        )}

        {extendedQs.length > 0 && (
          <Section title={`Section C — Extended Response (${extendedQs.length} × ${MARKS.extended})`}>
            <GroupedQuestionList items={extendedQs} />
          </Section>
        )}

        {numericalQs.length > 0 && (
          <Section title={`Section D — Numericals (${numericalQs.length} × ${MARKS.numerical})`}>
            <GroupedQuestionList items={numericalQs} />
          </Section>
        )}
      </div>

      {/* ===== PAGE 2: ANSWER KEY — from the book itself, with page citations ===== */}
      {includeAnswerKey && (
        <div className="print-sheet print-page answer-key-page bg-white shadow-lg my-4 p-6 text-slate-900">
          <PaperHeader kind="Exercise Test" chapterTitle={chapterTitle} today={today} maxMarks={maxMarks} time={TIME_MINUTES} subtitle="Answer Key" />

          {mcqs.length > 0 && (
            <Section title="Section A — MCQ Answers">
              <div className="grid grid-cols-6 gap-1 compact-q">
                {mcqs.map((q, i) => (
                  <div key={q.id}>{i + 1}. {q.shuffledOptions?.find(o => o.isCorrect)?.label ?? '—'}</div>
                ))}
              </div>
            </Section>
          )}

          {shortQs.length > 0 && (
            <Section title="Section B — Short Response Answers">
              <GroupedAnswerList items={shortQs} />
            </Section>
          )}

          {extendedQs.length > 0 && (
            <Section title="Section C — Extended Response Answers">
              <GroupedAnswerList items={extendedQs} />
            </Section>
          )}

          {numericalQs.length > 0 && (
            <Section title="Section D — Numerical Solutions">
              <GroupedAnswerList items={numericalQs} />
            </Section>
          )}
        </div>
      )}
    </div>
  )
}
