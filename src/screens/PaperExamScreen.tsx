import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Check, Minus, Plus, LayoutGrid } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import GreenHero from '../components/GreenHero'
import LogoWatermark from '../components/LogoWatermark'
import { useAuth } from '../contexts/AuthContext'
import FractionText from '../components/FractionText'
import { enableScreenProtection, disableScreenProtection } from '../lib/screenProtection'
import { saveAttempt, flushAttemptQueue, newId, AnswerRow } from '../lib/attemptQueue'
import { loadPaperBundle, kindFromPath, paperBase, SourcePaper } from '../lib/paperSource'
import {
  ExamQuestion, ExamSection, Slot, SlotAnswer, Awards,
  buildSlots, computeResult, weakChapters, isPracticalSection, sectionPlan,
  isAttempted, isMarkableMcq, chosenQuestion, awardedFor, correctLetter, letterOf,
  marksOf, parseRubric, marksFromTicks, slotMarks,
} from '../lib/examLogic'

type Paper = SourcePaper

type Phase = 'start' | 'exam' | 'review' | 'result'
type ChapterInfo = { id: string; number: number; title: string }

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function tidyTitle(title: string): string {
  const letters = title.replace(/[^A-Za-z]/g, '')
  if (letters.length > 0 && letters === letters.toUpperCase()) {
    return title.toLowerCase().replace(/(^|\s)([a-z])/g, (_, s, c) => s + c.toUpperCase())
  }
  return title
}

export default function PaperExamScreen() {
  const navigate = useNavigate()
  const { paperId } = useParams<{ paperId: string }>()
  const kind = kindFromPath(useLocation().pathname)
  const { user } = useAuth()
  const base = paperBase(kind)

  const [paper, setPaper] = useState<Paper | null>(null)
  const [subjectName, setSubjectName] = useState('')
  const [sections, setSections] = useState<ExamSection[]>([])
  const [questions, setQuestions] = useState<ExamQuestion[]>([])
  const [chapters, setChapters] = useState<Record<string, ChapterInfo>>({})
  const [loading, setLoading] = useState(true)
  const [loadState, setLoadState] = useState<'ok' | 'notfound' | 'error' | 'reconnect'>('ok')

  const [phase, setPhase] = useState<Phase>('start')
  const [answers, setAnswers] = useState<Record<string, SlotAnswer>>({})
  const [awards, setAwards] = useState<Awards>({})
  const [ticks, setTicks] = useState<Record<string, number[]>>({})
  const [startedAt, setStartedAt] = useState<number>(0)
  const [endAt, setEndAt] = useState<number>(0)
  const [remaining, setRemaining] = useState<number>(0)
  const [showPalette, setShowPalette] = useState(false)
  const [confirm, setConfirm] = useState<null | 'submit' | 'leave'>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'queued'>('idle')
  const [timeUp, setTimeUp] = useState(false)
  const attemptIdRef = useRef<string>('')

  // Load the paper (published papers only, enforced by the database)
  useEffect(() => {
    if (!paperId) { setLoadState('notfound'); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    async function load() {
      const res = await loadPaperBundle(kind, paperId as string)
      if (cancelled) return
      if (res.status !== 'ok') { setLoadState(res.status); setLoading(false); return }
      const { paper: p, sections: secs, questions: qs0 } = res.bundle
      const qs = qs0 as ExamQuestion[]
      const chapterMap: Record<string, ChapterInfo> = {}
      for (const c of res.bundle.chapters) chapterMap[c.id] = c

      setPaper(p)
      setSubjectName(res.bundle.subject?.name ?? '')
      setSections(secs as ExamSection[])
      setQuestions(qs)
      setChapters(chapterMap)
      setLoading(false)
    }
    load().catch(() => { if (!cancelled) { setLoadState('error'); setLoading(false) } })
    return () => { cancelled = true }
  }, [paperId, kind])

  // Upload any attempt that was kept on the phone earlier
  useEffect(() => { flushAttemptQueue(user?.id) }, [user?.id])

  // The practical part is outside the paper's marks, so it is not part of the exam
  const examSections = useMemo(() => sections.filter(s => !isPracticalSection(s)), [sections])
  const slots = useMemo(() => buildSlots(examSections, questions), [examSections, questions])
  const sectionsWithSlots = useMemo(
    () => examSections.filter(s => slots.some(sl => sl.sectionId === s.id)),
    [examSections, slots],
  )
  const hasPractical = sections.some(isPracticalSection)

  const result = useMemo(
    () => computeResult(sectionsWithSlots, slots, answers, awards),
    [sectionsWithSlots, slots, answers, awards],
  )
  const weak = useMemo(
    () => weakChapters(sectionsWithSlots, slots, answers, awards),
    [sectionsWithSlots, slots, answers, awards],
  )

  const slotIndex = useMemo(() => {
    const m: Record<string, number> = {}
    slots.forEach((s, i) => { m[s.key] = i + 1 })
    return m
  }, [slots])

  // ---- Screenshot block: on only while the exam is running ----
  useEffect(() => {
    if (phase !== 'exam') return
    enableScreenProtection()
    const onVisibility = () => {
      if (document.hidden) disableScreenProtection()
      else enableScreenProtection()
    }
    const onHide = () => { disableScreenProtection() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onHide)
      disableScreenProtection()
    }
  }, [phase])

  // ---- Timer: based on the clock, so it stays right if the app is paused ----
  const goToReview = useCallback((byTime: boolean) => {
    setTimeUp(byTime)
    setConfirm(null)
    setShowPalette(false)
    setPhase('review')
  }, [])

  useEffect(() => {
    if (phase !== 'exam') return
    const tick = () => {
      const left = endAt - Date.now()
      setRemaining(left)
      if (left <= 0) goToReview(true)
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [phase, endAt, goToReview])

  function startExam() {
    if (!paper) return
    const now = Date.now()
    const minutes = paper.time_minutes ?? 180
    attemptIdRef.current = newId()
    setAnswers({})
    setAwards({})
    setTicks({})
    setTimeUp(false)
    setSaveState('idle')
    setStartedAt(now)
    setEndAt(now + minutes * 60 * 1000)
    setRemaining(minutes * 60 * 1000)
    setPhase('exam')
  }

  function pickOption(slot: Slot, index: number) {
    setAnswers(a => ({ ...a, [slot.key]: { option: a[slot.key]?.option === index ? undefined : index } }))
  }

  function pickWritten(slot: Slot, index: number) {
    setAnswers(a => ({ ...a, [slot.key]: { choice: a[slot.key]?.choice === index ? undefined : index } }))
  }

  function setAward(q: ExamQuestion, value: number) {
    const v = Math.min(Math.max(value, 0), marksOf(q))
    setAwards(a => ({ ...a, [q.id]: v }))
  }

  function toggleTick(q: ExamQuestion, i: number) {
    const rubric = parseRubric(q.rubric)
    if (i < 0 || i >= rubric.length) return
    const cur = ticks[q.id] ?? []
    const next = cur.includes(i) ? cur.filter(x => x !== i) : [...cur, i].sort((x, y) => x - y)
    setTicks(t => ({ ...t, [q.id]: next }))
    setAwards(a => ({ ...a, [q.id]: marksFromTicks(rubric, next, marksOf(q)) }))
  }

  async function finish() {
    if (!paper) return
    const attemptId = attemptIdRef.current || newId()
    const rows: AnswerRow[] = []
    for (const s of slots) {
      const a = answers[s.key]
      if (!isAttempted(s, a)) continue
      const q = chosenQuestion(s, a)
      if (!q) continue
      rows.push({
        id: newId(),
        attempt_id: attemptId,
        question_ref: q.id,
        or_choice: s.alts.length === 2 ? (a!.choice === 0 ? 'a' : 'b') : null,
        selected_option: s.kind === 'mcq' ? letterOf(a!.option!) : null,
        ticked_points: s.kind === 'written' ? (ticks[q.id] ?? null) : null,
        marks_awarded: s.kind === 'mcq' && !isMarkableMcq(s) ? null : awardedFor(s, a, awards),
      })
    }
    setPhase('result')
    const outcome = await saveAttempt({
      attempt: {
        id: attemptId,
        user_id: user?.id,
        paper_kind: kind,
        paper_id: paper.id,
        mode: 'exam',
        started_at: new Date(startedAt || Date.now()).toISOString(),
        submitted_at: new Date().toISOString(),
        total_marks: result.total,
        obtained_marks: result.obtained,
      },
      answers: rows,
    })
    setSaveState(outcome)
  }

  const answeredCount = slots.filter(s => isAttempted(s, answers[s.key])).length

  // Leaving during an exam asks first; elsewhere it just goes back
  function onBack() {
    if (phase === 'exam' || phase === 'review') setConfirm('leave')
    else navigate(-1)
  }

  // ------------------------------------------------------------------ views

  function renderStart() {
    if (!paper) return null
    const minutes = paper.time_minutes ?? 0
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    const dur = h > 0 ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`
    // Questions with no stored answer (MCQ without a correct option, written without a model answer)
    const missingAnswers = slots.filter(sl => (sl.kind === 'mcq' ? !isMarkableMcq(sl) : sl.alts.some(a => !a.answer || !a.answer.trim()))).length
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-5 text-center">
        <div className="text-lg font-black text-slate-900 dark:text-slate-100">{paper.title}</div>
        <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">{subjectName} · {paper.is_generated ? 'IQRA Test Paper' : paper.is_model_paper ? 'Model Paper' : 'Past Paper'} {paper.year}</div>
        <div className="grid grid-cols-2 gap-3 my-5">
          <div className="rounded-xl bg-brand-50 dark:bg-brand-950/40 py-3">
            <div className="text-xl font-black text-brand-700 dark:text-brand-400">{dur}</div>
            <div className="text-[11px] text-gray-500 dark:text-slate-400">Time</div>
          </div>
          <div className="rounded-xl bg-brand-50 dark:bg-brand-950/40 py-3">
            <div className="text-xl font-black text-brand-700 dark:text-brand-400">{fmt(result.total)}</div>
            <div className="text-[11px] text-gray-500 dark:text-slate-400">Marks</div>
          </div>
        </div>
        <ul className="text-xs text-left text-slate-600 dark:text-slate-300 flex flex-col gap-1.5 mb-5">
          <li>• Tap an option for each MCQ.</li>
          <li>• For written questions, write on paper, then tap "I answered this".</li>
          <li>• Where there is an OR, pick the one you answered.</li>
          <li>• When you submit, you check your written answers against the model answer and give yourself marks.</li>
          {hasPractical && <li>• The practical part is not included in this exam.</li>}
        </ul>
        {missingAnswers > 0 && (
          <div role="status" className="text-xs text-left text-amber-900 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-200 rounded-xl px-3 py-2 mb-4">
            {missingAnswers} of {slots.length} questions have no model answer yet, so some MCQs cannot be marked. Written answers are self-marked with your textbook. For a fully marked exam, generate a paper.
          </div>
        )}
        <button
          onClick={startExam}
          disabled={slots.length === 0}
          className="w-full bg-brand-600 text-white font-bold rounded-2xl py-3 disabled:opacity-50"
        >
          Start exam
        </button>
        {slots.length === 0 && (
          <div className="text-xs text-gray-500 mt-2 dark:text-slate-400">This paper has no questions yet.</div>
        )}
      </div>
    )
  }

  function renderSlotExam(slot: Slot) {
    const a = answers[slot.key]
    const num = slotIndex[slot.key]
    const attempted = isAttempted(slot, a)
    return (
      <div
        id={`slot-${slot.key}`}
        key={slot.key}
        className={`rounded-xl border p-3 mb-2 ${attempted ? 'border-brand-300 bg-brand-50/50 dark:border-brand-700 dark:bg-brand-950/20' : 'border-slate-200 dark:border-slate-700'}`}
      >
        {slot.kind === 'mcq' ? (
          <>
            <div className="flex gap-2 text-sm text-slate-900 dark:text-slate-100">
              <span className="font-bold flex-shrink-0">{num}.</span>
              <span className="whitespace-pre-line"><FractionText text={slot.alts[0].question} /></span>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-1.5">
              {(slot.alts[0].options ?? []).map((opt, i) => (
                <button
                  key={i}
                  onClick={() => pickOption(slot, i)}
                  aria-pressed={a?.option === i}
                  className={`text-left text-sm rounded-lg px-3 py-2 border transition-colors ${
                    a?.option === i
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-200'
                  }`}
                >
                  ({letterOf(i)}) <FractionText text={String(opt)} />
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {slot.alts.map((q, i) => (
              <div key={q.id}>
                {i === 1 && <div className="text-center font-bold text-sm my-2 text-slate-700 dark:text-slate-300">-OR-</div>}
                <div className="flex gap-2 text-sm text-slate-900 dark:text-slate-100">
                  <span className="font-bold flex-shrink-0 w-6">{i === 0 ? `${num}.` : ''}</span>
                  <span className="flex-1 whitespace-pre-line"><FractionText text={q.question} /></span>
                  <span className="flex-shrink-0 text-xs font-semibold text-slate-500">[{fmt(marksOf(q))}]</span>
                </div>
                <button
                  onClick={() => pickWritten(slot, i)}
                  aria-pressed={a?.choice === i}
                  className={`mt-2 ml-8 text-xs font-bold rounded-lg px-3 py-1.5 border transition-colors flex items-center gap-1 ${
                    a?.choice === i
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {a?.choice === i && <Check size={12} />}
                  {slot.alts.length === 2 ? 'I answered this one' : 'I answered this'}
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    )
  }

  function renderExam() {
    return (
      <>
        {sectionsWithSlots.map(section => {
          const plan = sectionPlan(section, slots)
          const mine = slots.filter(s => s.sectionId === section.id)
          const done = mine.filter(s => isAttempted(s, answers[s.key])).length
          return (
            <div key={section.id} className="mb-5">
              <div className="text-center text-sm font-bold underline underline-offset-2 text-slate-900 dark:text-slate-100">{section.part_name}</div>
              {section.instruction && (
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mt-1 mb-2 whitespace-pre-line">{section.instruction}</div>
              )}
              {plan.limit !== null && (
                <div className={`text-[11px] mb-2 ${done > plan.limit ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>
                  Answered {done}. Only your best {plan.limit} count.
                </div>
              )}
              {mine.map(renderSlotExam)}
            </div>
          )
        })}
        <button
          onClick={() => setConfirm('submit')}
          className="w-full bg-brand-600 text-white font-bold rounded-2xl py-3 mb-6"
        >
          Submit paper
        </button>
      </>
    )
  }

  function renderReview() {
    const mcqSlots = slots.filter(s => s.kind === 'mcq')
    const markableMcq = mcqSlots.filter(isMarkableMcq)
    const rightMcq = markableMcq.filter(s => awardedFor(s, answers[s.key], awards) > 0)
    const mcqMarks = rightMcq.reduce((x, s) => x + slotMarks(s), 0)
    const mcqMax = markableMcq.reduce((x, s) => x + slotMarks(s), 0)

    // Written questions the student answered, grouped by whether they count
    const written = slots.filter(s => s.kind === 'written' && isAttempted(s, answers[s.key]))
    const notAttempted = slots.filter(s => s.kind === 'written' && !isAttempted(s, answers[s.key])).length

    return (
      <>
        {timeUp && (
          <div role="status" className="mb-3 text-xs font-semibold text-amber-800 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300 rounded-xl px-3 py-2">
            Time is up. Your paper was submitted.
          </div>
        )}

        {/* 1. MCQ score first */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 mb-4">
          <div className="text-sm font-black text-slate-900 dark:text-slate-100">MCQ score</div>
          {mcqSlots.length === 0 ? (
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">This paper has no MCQs.</div>
          ) : (
            <>
              <div className="text-2xl font-black text-brand-700 dark:text-brand-400 mt-1">
                {fmt(mcqMarks)} <span className="text-sm font-semibold text-gray-500">/ {fmt(mcqMax)}</span>
              </div>
              {mcqSlots.length > markableMcq.length && (
                <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">
                  {mcqSlots.length - markableMcq.length} MCQ{mcqSlots.length - markableMcq.length === 1 ? '' : 's'} could not be marked because the correct answer is not added yet.
                </div>
              )}
              <div className="mt-3 flex flex-col gap-2">
                {mcqSlots.map(s => {
                  const a = answers[s.key]
                  const q = s.alts[0]
                  const right = correctLetter(q.answer)
                  const mine = a?.option !== undefined ? letterOf(a.option) : null
                  const state = !right ? 'unknown' : mine === right ? 'right' : 'wrong'
                  return (
                    <div key={s.key} className="text-xs flex gap-2">
                      <span className="font-bold w-6 flex-shrink-0">{slotIndex[s.key]}.</span>
                      <span className="flex-1 text-slate-700 dark:text-slate-300">
                        <span className="line-clamp-2"><FractionText text={q.question} /></span>
                        <span className={
                          state === 'right' ? 'text-green-700 dark:text-green-400 font-semibold'
                          : state === 'wrong' ? 'text-red-600 dark:text-red-400 font-semibold'
                          : 'text-gray-500'
                        }>
                          {' '}Your answer: {mine ?? 'none'}
                          {right ? ` · Correct: ${right}` : ' · Correct answer not added yet'}
                        </span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* 2. Written questions: model answer and self-marking */}
        <div className="text-sm font-black text-slate-900 dark:text-slate-100 mb-1">Check your written answers</div>
        <div className="text-xs text-gray-500 dark:text-slate-400 mb-3">
          Be honest. Compare what you wrote on paper with the model answer, then tick the points you covered.
        </div>
        {written.length === 0 && (
          <div className="text-xs text-gray-500 dark:text-slate-400 mb-4">You did not mark any written question as answered.</div>
        )}
        {written.map(s => {
          const q = chosenQuestion(s, answers[s.key])!
          const rubric = parseRubric(q.rubric)
          const ticked = ticks[q.id] ?? []
          const got = awards[q.id] ?? 0
          const max = marksOf(q)
          return (
            <div key={s.key} className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 mb-3">
              <div className="flex gap-2 text-sm text-slate-900 dark:text-slate-100">
                <span className="font-bold flex-shrink-0">{slotIndex[s.key]}.</span>
                <span className="flex-1 whitespace-pre-line"><FractionText text={q.question} /></span>
                <span className="flex-shrink-0 text-xs font-bold text-brand-700 dark:text-brand-400">{fmt(got)} / {fmt(max)}</span>
              </div>

              {q.answer && q.answer.trim() !== '' ? (
                <div className="mt-2 rounded-xl bg-brand-50 dark:bg-brand-950/40 px-3 py-2">
                  <div className="text-xs font-bold text-brand-700 dark:text-brand-400 mb-0.5">Model answer</div>
                  <div className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-line"><FractionText text={q.answer} /></div>
                </div>
              ) : (
                <div className="mt-2 text-xs text-gray-500 dark:text-slate-400">The model answer is not added yet. Mark yourself with your textbook.</div>
              )}

              {rubric.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {rubric.map((r, i) => (
                    <li key={i}>
                      <button
                        onClick={() => toggleTick(q, i)}
                        aria-pressed={ticked.includes(i)}
                        className="w-full flex items-start gap-2 text-left text-xs text-slate-700 dark:text-slate-300"
                      >
                        <span className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${ticked.includes(i) ? 'bg-brand-600 border-brand-600 text-white' : 'border-slate-400'}`}>
                          {ticked.includes(i) && <Check size={11} />}
                        </span>
                        <span className="flex-1"><FractionText text={r.concept ?? ''} /></span>
                        <span className="font-bold text-brand-700 dark:text-brand-400">{fmt(Number(r.points ?? 1))}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-slate-600 dark:text-slate-300">Your marks</span>
                  <div className="flex items-center gap-3">
                    <button aria-label="Less" onClick={() => setAward(q, got - 0.5)} className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center"><Minus size={14} /></button>
                    <span className="w-10 text-center font-bold text-slate-900 dark:text-slate-100">{fmt(got)}</span>
                    <button aria-label="More" onClick={() => setAward(q, got + 0.5)} className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center"><Plus size={14} /></button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {notAttempted > 0 && (
          <div className="text-xs text-gray-500 dark:text-slate-400 mb-4">
            {notAttempted} written question{notAttempted === 1 ? '' : 's'} not answered (these earn 0).
          </div>
        )}

        <button onClick={finish} className="w-full bg-brand-600 text-white font-bold rounded-2xl py-3 mb-6">
          Finish and see result
        </button>
      </>
    )
  }

  function renderResult() {
    const pct = result.total > 0 ? Math.round((result.obtained / result.total) * 100) : 0
    const markedOut = result.total - result.unmarkableMarks
    return (
      <>
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-5 text-center mb-4">
          <div className="text-xs text-gray-500 dark:text-slate-400">Your score</div>
          <div className="text-4xl font-black text-brand-700 dark:text-brand-400 mt-1">
            {fmt(result.obtained)} <span className="text-lg font-semibold text-gray-500">/ {fmt(result.total)}</span>
          </div>
          <div className="text-sm font-bold text-slate-700 dark:text-slate-200 mt-1">{pct}%</div>
          {result.unmarkableCount > 0 && (
            <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-2">
              {result.unmarkableCount} MCQ{result.unmarkableCount === 1 ? '' : 's'} ({fmt(result.unmarkableMarks)} marks) could not be marked yet, so this score is out of {fmt(markedOut)} marked marks.
            </div>
          )}
          <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-2">
            {saveState === 'saved' && 'Attempt saved.'}
            {saveState === 'queued' && 'Saved on this phone. It will upload when you are online.'}
            {saveState === 'idle' && 'Saving…'}
          </div>
          <div className="text-[11px] text-gray-400 dark:text-slate-500">Practice marks only. They do not change your leaderboard score.</div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 mb-4">
          <div className="text-sm font-black text-slate-900 dark:text-slate-100 mb-2">By section</div>
          <div className="flex flex-col gap-2">
            {result.sections.map(r => (
              <div key={r.section.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-700 dark:text-slate-300">{r.section.part_name}</span>
                <span className="font-bold text-slate-900 dark:text-slate-100">{fmt(r.obtained)} / {fmt(r.total)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 mb-4">
          <div className="text-sm font-black text-slate-900 dark:text-slate-100">Weak chapters</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400 mb-3">Where you lost the most marks, worst first.</div>
          {weak.length === 0 ? (
            <div className="text-xs text-gray-500 dark:text-slate-400">No marks lost in tagged chapters. Well done.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {weak.slice(0, 5).map(w => {
                const ch = chapters[w.chapterId]
                return (
                  <div key={w.chapterId}>
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 min-w-0">
                        {ch ? `Ch ${ch.number}. ` : ''}<FractionText text={ch ? tidyTitle(ch.title) : 'Chapter'} />
                      </div>
                      <div className="text-xs font-bold text-red-600 dark:text-red-400 flex-shrink-0">−{fmt(w.lost)} marks</div>
                    </div>
                    <div className="flex gap-2 mt-1.5">
                      <button onClick={() => navigate(`/chapter/${w.chapterId}`)} className="flex-1 text-xs font-bold rounded-lg py-1.5 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400">Study notes</button>
                      <button onClick={() => navigate(`/quiz/${w.chapterId}`)} className="flex-1 text-xs font-bold rounded-lg py-1.5 bg-brand-600 text-white">Practise MCQs</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex gap-2 mb-6">
          <button onClick={() => navigate(`${base}/${paperId}`)} className="flex-1 text-sm font-bold rounded-2xl py-3 bg-white dark:bg-slate-800 text-brand-700 dark:text-brand-400 shadow-sm">Review paper</button>
          <button onClick={() => navigate('/past-papers')} className="flex-1 text-sm font-bold rounded-2xl py-3 bg-brand-600 text-white">All papers</button>
        </div>
      </>
    )
  }

  // ------------------------------------------------------------------ shell

  const titleLine = phase === 'exam' ? 'Exam in progress' : phase === 'review' ? 'Check your answers' : phase === 'result' ? 'Result' : 'Exam mode'

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      <GreenHero>
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="text-brand-200 flex items-center gap-1 text-xs">
            <ChevronLeft size={14} /> {phase === 'exam' || phase === 'review' ? 'Leave' : 'Back'}
          </button>
          {phase === 'exam' && (
            <div
              role="timer"
              aria-label="Time left"
              className={`text-base font-black tabular-nums px-3 py-1 rounded-lg ${remaining <= 5 * 60 * 1000 ? 'bg-red-500 text-white' : 'bg-white/20 text-white'}`}
            >
              {clock(remaining)}
            </div>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <h1 className="text-lg font-black">{titleLine}</h1>
          {phase === 'exam' && (
            <button onClick={() => setShowPalette(true)} className="flex items-center gap-1 text-xs font-bold bg-white/20 rounded-lg px-2.5 py-1.5">
              <LayoutGrid size={14} /> {answeredCount}/{slots.length}
            </button>
          )}
        </div>
      </GreenHero>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {loading && (
          <div className="flex justify-center py-10" role="status" aria-label="Loading paper">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!loading && loadState === 'notfound' && (
          <div className="text-center text-sm text-gray-500 py-12 dark:text-slate-400">This paper is not available.</div>
        )}
        {!loading && loadState === 'reconnect' && (
          <div role="alert" className="text-center text-sm text-gray-500 py-12 dark:text-slate-400">Connect to the internet once to keep using your downloaded papers.</div>
        )}
        {!loading && loadState === 'error' && (
          <div className="text-center text-sm text-gray-500 py-12 dark:text-slate-400">Could not load this paper. Check your connection and go back to try again.</div>
        )}
        {!loading && loadState === 'ok' && paper && (
          <>
            {phase === 'start' && renderStart()}
            {phase === 'exam' && (
              <div className="relative">
                <LogoWatermark />
                <div className="relative">{renderExam()}</div>
              </div>
            )}
            {phase === 'review' && renderReview()}
            {phase === 'result' && renderResult()}
          </>
        )}
      </div>

      {/* Question palette */}
      {showPalette && phase === 'exam' && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={() => setShowPalette(false)}>
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-t-2xl p-4 max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-black text-slate-900 dark:text-slate-100">Questions</div>
              <div className="text-xs text-gray-500 dark:text-slate-400">{answeredCount} of {slots.length} answered</div>
            </div>
            <div className="grid grid-cols-6 gap-2">
              {slots.map(s => {
                const done = isAttempted(s, answers[s.key])
                return (
                  <button
                    key={s.key}
                    onClick={() => {
                      setShowPalette(false)
                      window.setTimeout(() => document.getElementById(`slot-${s.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
                    }}
                    className={`h-9 rounded-lg text-xs font-bold ${done ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}
                  >
                    {slotIndex[s.key]}
                  </button>
                )
              })}
            </div>
            <button onClick={() => setShowPalette(false)} className="w-full mt-4 text-sm font-bold rounded-xl py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">Close</button>
          </div>
        </div>
      )}

      {/* Confirmations */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6" role="dialog" aria-modal="true">
          <div className="w-full max-w-xs bg-white dark:bg-slate-900 rounded-2xl p-5">
            {confirm === 'submit' ? (
              <>
                <div className="text-base font-black text-slate-900 dark:text-slate-100">Submit the paper?</div>
                <div className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                  {slots.length - answeredCount > 0
                    ? `${slots.length - answeredCount} question${slots.length - answeredCount === 1 ? ' is' : 's are'} not answered.`
                    : 'All questions are answered.'}
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={() => setConfirm(null)} className="flex-1 text-sm font-bold rounded-xl py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">Keep going</button>
                  <button onClick={() => goToReview(false)} className="flex-1 text-sm font-bold rounded-xl py-2.5 bg-brand-600 text-white">Submit</button>
                </div>
              </>
            ) : (
              <>
                <div className="text-base font-black text-slate-900 dark:text-slate-100">Leave this exam?</div>
                <div className="text-sm text-slate-600 dark:text-slate-300 mt-1">Your answers will be lost and this attempt will not be saved.</div>
                <div className="flex gap-2 mt-4">
                  <button onClick={() => setConfirm(null)} className="flex-1 text-sm font-bold rounded-xl py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">Stay</button>
                  <button onClick={() => { disableScreenProtection(); navigate(`${base}/${paperId}`, { replace: true }) }} className="flex-1 text-sm font-bold rounded-xl py-2.5 bg-red-600 text-white">Leave</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
