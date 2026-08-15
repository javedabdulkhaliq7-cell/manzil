import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Printer, Lock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { drawMergedQuestions } from '../lib/randomDrawEngine'
import { checkAndConsumeCap, SHARED_PRINTABLE_FEATURE } from '../lib/dailyCap'
import { shuffleMcqOptions, ShuffledMcq } from '../lib/shuffleMcqOptions'
import { normalizeMcqRow } from '../lib/normalizeMcq'
import { CONFIG, getMaxMarks } from '../lib/mockTestConfig'
import FractionText from '../components/FractionText'
import DiagramRenderer from '../components/DiagramRenderer'
import { PrintStyles, PaperHeader, Section } from '../components/printLayout'

interface FillBlankQ { id: string; question: string; answer: string }
interface ShortQ { id: string; question: string; answer: string; diagram_type?: string | null; diagram_data?: any }
interface LongQ { id: string; question: string; answer: string; diagram_type?: string | null; diagram_data?: any }
interface NumericalQ { id: string; question: string; answer: string; diagram_type?: string | null; diagram_data?: any }

type GateState = 'checking' | 'blocked-free-tier' | 'blocked-daily-cap' | 'ready'

export default function MockTestPrintView() {
  const { chapterId } = useParams<{ chapterId: string }>()
  const { user, profile } = useAuth()
  const navigate = useNavigate()

  const [gate, setGate] = useState<GateState>('checking')
  const [includeAnswerKey, setIncludeAnswerKey] = useState(true)
  const [chapterTitle, setChapterTitle] = useState('')

  const [mcqs, setMcqs] = useState<ShuffledMcq[]>([])
  const [fibQs, setFibQs] = useState<FillBlankQ[]>([])
  const [shortQs, setShortQs] = useState<ShortQ[]>([])
  const [longQs, setLongQs] = useState<LongQ[]>([])
  const [numericalQs, setNumericalQs] = useState<NumericalQ[]>([])

  useEffect(() => {
    async function run() {
      if (!chapterId || !user || !profile) return

      const { data: ch } = await supabase.from('chapters').select('title, number, subject_id').eq('id', chapterId).single()
      if (!ch) { setGate('blocked-free-tier'); return }
      setChapterTitle(ch.title)

      const isPremium = profile.plan === 'premium'
      if (!isPremium && ch.number !== 1) {
        setGate('blocked-free-tier')
        return
      }

      // Free tier only ever reaches here on chapter 1 — cap it at
      // DAILY_CAP/subject/day. Premium falls through with zero cap
      // calls, same as before this change: genuinely unlimited.
      if (!isPremium) {
        try {
          await checkAndConsumeCap(user.id, ch.subject_id, SHARED_PRINTABLE_FEATURE)
        } catch {
          setGate('blocked-daily-cap')
          return
        }
      }

      // Numericals section is data-driven, not subject-name-driven — see
      // the same fix in ChapterMockTestScreen.tsx for the full rationale.
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
      setGate('ready')
    }
    run()
  }, [chapterId, user, profile])

  const maxMarks = getMaxMarks(numericalQs.length > 0)
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
          <div className="font-bold text-slate-900 mb-1">Printable Mock Test is Premium</div>
          <div className="text-xs text-gray-400">Free plan includes printable tests for Chapter 1 of every subject. Upgrade to print every chapter.</div>
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
          <div className="text-xs text-gray-400">Free plan includes 3 printable tests per subject per day. Resets at midnight (Pakistan time), or upgrade for unlimited.</div>
        </div>
        <button onClick={() => navigate('/profile')} className="bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold px-8 py-3.5 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">
          Upgrade to Premium
        </button>
      </div>
    )
  }

  return (
    <div className="bg-gray-100 min-h-screen">
      {/*
        Print CSS tuned to fit questions on ONE A4 page and the answer key
        on a SECOND — deliberately dense (small type, tight spacing,
        2-column MCQ/FIB grid) to keep printing cost down.

        HONEST LIMIT: this is a target, not a guarantee. Font size and
        spacing are controllable; the actual LENGTH of your Short/Long
        question text and model answers is not — a chapter with unusually
        long questions or long model answers can still spill onto a 3rd
        page despite this CSS. If that happens routinely, the fix is
        shortening the stored question/answer text or reducing section
        counts, not tighter CSS (there's a floor below which it stops
        being legible/printable).
      */}
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

      {/* ===== PAGE 1: QUESTIONS (target: fits on one A4 page) ===== */}
      <div className="print-sheet print-page bg-white shadow-lg my-4 p-6 text-slate-900">
        <PaperHeader kind="Mock Test" chapterTitle={chapterTitle} today={today} maxMarks={maxMarks} time={CONFIG.TIME_MINUTES} />

        <Section title={`Section A — MCQs (${mcqs.length} × ${CONFIG.MCQ_MARKS}) & Fill in the Blanks (${fibQs.length} × ${CONFIG.FIB_MARKS})`}>
          <div className="flex flex-col">
            {mcqs.map((q, i) => (
              <div key={q.id} className="compact-q mb-1.5">
                <div className="font-semibold"><FractionText text={`${i + 1}. ${q.question}`} /></div>
                {q.diagram_type && q.diagram_data && (
                  <div className="pl-2 my-1"><DiagramRenderer diagramType={q.diagram_type} diagramData={q.diagram_data} /></div>
                )}
                <div className="pl-2">
                  {q.options.map(opt => (
                    <span key={opt.label} className="mr-3">({opt.label.toLowerCase()}) <FractionText text={opt.text} /></span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-x-3 mt-1.5">
            {fibQs.map((q, i) => (
              <div key={q.id} className="compact-q mb-1">
                <FractionText text={`${mcqs.length + i + 1}. ${q.question}`} />
              </div>
            ))}
          </div>
        </Section>

        <Section title={`Section B — Short Questions (attempt any ${CONFIG.SHORT_ATTEMPT} of ${shortQs.length}, ${CONFIG.SHORT_MARKS} marks each)`}>
          {shortQs.map((q, i) => (
            <div key={q.id} className="compact-q mb-1"><FractionText text={`${i + 1}. ${q.question}`} /></div>
          ))}
        </Section>

        <Section title={`Section C — Long Questions (attempt any ${CONFIG.LONG_ATTEMPT} of ${longQs.length}, ${CONFIG.LONG_MARKS} marks each)`}>
          {longQs.map((q, i) => (
            <div key={q.id} className="compact-q mb-1"><FractionText text={`${i + 1}. ${q.question}`} /></div>
          ))}
        </Section>

        {numericalQs.length > 0 && (
          <Section title={`Section D — Numericals (attempt both, ${CONFIG.NUMERICAL_MARKS} marks each)`}>
            {numericalQs.map((q, i) => (
              <div key={q.id} className="compact-q mb-1"><FractionText text={`${i + 1}. ${q.question}`} /></div>
            ))}
          </Section>
        )}
      </div>

      {/* ===== PAGE 2: ANSWER KEY (target: fits on one A4 page) — optional ===== */}
      {includeAnswerKey && (
        <div className="print-sheet print-page answer-key-page bg-white shadow-lg my-4 p-6 text-slate-900">
          <PaperHeader kind="Mock Test" chapterTitle={chapterTitle} today={today} maxMarks={maxMarks} time={CONFIG.TIME_MINUTES} subtitle="Answer Key" />

          <Section title="Section A — MCQ &amp; Fill in the Blank Answers">
            <div className="grid grid-cols-6 gap-1 compact-q mb-1.5">
              {mcqs.map((q, i) => (
                <div key={q.id}>{i + 1}. {q.options.find(o => o.isCorrect)?.label ?? '—'}</div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-3 compact-q">
              {fibQs.map((q, i) => (
                <div key={q.id}>{mcqs.length + i + 1}. <FractionText text={q.answer} /></div>
              ))}
            </div>
          </Section>

          <Section title="Section B — Short Question Model Answers">
            {shortQs.map((q, i) => (
              <div key={q.id} className="compact-q mb-1">
                <span className="font-semibold">{i + 1}.</span> <FractionText text={q.answer} />
                {q.diagram_type && q.diagram_data && (
                  <div className="my-1"><DiagramRenderer diagramType={q.diagram_type} diagramData={q.diagram_data} /></div>
                )}
              </div>
            ))}
          </Section>

          <Section title="Section C — Long Question Model Answers">
            {longQs.map((q, i) => (
              <div key={q.id} className="compact-q mb-1">
                <span className="font-semibold">{i + 1}.</span> <FractionText text={q.answer} />
                {q.diagram_type && q.diagram_data && (
                  <div className="my-1"><DiagramRenderer diagramType={q.diagram_type} diagramData={q.diagram_data} /></div>
                )}
              </div>
            ))}
          </Section>

          {numericalQs.length > 0 && (
            <Section title="Section D — Numerical Solutions">
              {numericalQs.map((q, i) => (
                <div key={q.id} className="compact-q mb-1">
                  <span className="font-semibold">{i + 1}.</span> <FractionText text={q.answer} />
                  {q.diagram_type && q.diagram_data && (
                    <div className="my-1"><DiagramRenderer diagramType={q.diagram_type} diagramData={q.diagram_data} /></div>
                  )}
                </div>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  )
}
