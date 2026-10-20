import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import GreenHero from '../components/GreenHero'
import FractionText from '../components/FractionText'
import { disableScreenProtection } from '../lib/screenProtection'
import { flushAttemptQueue } from '../lib/attemptQueue'
import { useAuth } from '../contexts/AuthContext'
import PaperDownloadButton from './PaperDownloadButton'
import { BUILD_TAG } from '../lib/offlineStore'
import LogoWatermark from '../components/LogoWatermark'
import {
  loadPaperBundle, kindFromPath, paperBase,
  SourcePaper, SourceSection, SourceQuestion, SourceGroup,
} from '../lib/paperSource'

type Paper = SourcePaper
type Section = SourceSection

type RubricPoint = { points?: number; concept?: string; keywords?: string[] }

type Question = SourceQuestion
type Group = SourceGroup

type Mode = 'view' | 'study'

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

function formatTime(minutes: number | null): string | null {
  if (!minutes) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} minutes`
  return m === 0 ? `${h} hours` : `${h} hours ${m} minutes`
}

function formatMarks(n: number | null | undefined): string {
  if (n === null || n === undefined) return ''
  const v = Number(n)
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

// "a-01" -> "1", "07" -> "7", "2" -> "2". Anything else: null.
function subPartNumber(sub: string | null): string | null {
  if (!sub) return null
  const m = sub.match(/(\d+)\s*$/)
  return m ? String(parseInt(m[1], 10)) : null
}

function questionLabel(q: Question): string {
  const n = subPartNumber(q.sub_part)
  if (n) return `${n}.`
  return `Q${q.question_number}.`
}

// "Class 9" -> "9TH", "Class 10" -> "10TH"
function classOrdinal(level: string): string {
  const m = level.match(/(\d+)/)
  return m ? `${m[1]}TH` : ''
}

function hasText(s: string | null | undefined): s is string {
  return typeof s === 'string' && s.trim().length > 0
}

function parseRubric(raw: unknown): RubricPoint[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(r => r && typeof r === 'object' && typeof (r as RubricPoint).concept === 'string') as RubricPoint[]
}

// MCQ answers are stored like "B) option text". Returns the letter, or null.
function correctLetter(answer: string | null): string | null {
  if (!answer) return null
  const m = answer.trim().match(/^\(?([A-Fa-f])[)\].:\s]/)
  return m ? m[1].toUpperCase() : null
}

function sortQuestions(a: Question, b: Question): number {
  if (a.question_number !== b.question_number) return a.question_number - b.question_number
  const altA = a.is_alternate ? 1 : 0
  const altB = b.is_alternate ? 1 : 0
  if (altA !== altB) return altA - altB
  return (a.sub_part ?? '').localeCompare(b.sub_part ?? '', undefined, { numeric: true })
}

export default function PaperViewerScreen() {
  const navigate = useNavigate()
  const { paperId } = useParams<{ paperId: string }>()
  const kind = kindFromPath(useLocation().pathname)
  const base = paperBase(kind)

  const [mode, setMode] = useState<Mode>('view')
  const [paper, setPaper] = useState<Paper | null>(null)
  const [subjectName, setSubjectName] = useState('')
  const [classLevel, setClassLevel] = useState('')
  const [sections, setSections] = useState<Section[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [groups, setGroups] = useState<Record<string, Group>>({})
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<'ok' | 'notfound' | 'error' | 'reconnect'>('ok')
  const [version, setVersion] = useState<number | null>(null)
  const { user } = useAuth()
  const [printing, setPrinting] = useState(false)
  const [printMsg, setPrintMsg] = useState('')

  // Screenshot block is only for exams. Make sure it is off here, and upload any waiting attempts.
  useEffect(() => {
    disableScreenProtection()
    flushAttemptQueue(user?.id)
  }, [user?.id])

  useEffect(() => {
    if (!paperId) { setState('notfound'); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setState('ok')

    async function load() {
      const res = await loadPaperBundle(kind, paperId as string)
      if (cancelled) return
      if (res.status !== 'ok') { setState(res.status); setLoading(false); return }
      const { paper: p, sections: secs, questions: qs0, groups: groupMap, subject, version: v } = res.bundle

      setPaper(p)
      setSubjectName(subject?.name ?? '')
      setClassLevel(subject?.class_level ?? '')
      // Only a copy loaded from the server can say whether a saved copy is out of date.
      setVersion(res.fromLocal ? null : v)
      setSections(secs)
      setQuestions(qs0.slice().sort(sortQuestions))
      setGroups(groupMap)
      setLoading(false)
    }
    load().catch(() => { if (!cancelled) { setState('error'); setLoading(false) } })
    return () => { cancelled = true }
  }, [paperId, kind])

  // Questions per section. A question with no section falls back to the first section of the same part.
  const bySection = useMemo(() => {
    const map: Record<string, Question[]> = {}
    for (const s of sections) map[s.id] = []
    const orphans: Question[] = []
    for (const q of questions) {
      if (q.section_id && map[q.section_id]) {
        map[q.section_id].push(q)
      } else {
        const fallback = sections.find(s => s.part_name === q.part_name)
        if (fallback) map[fallback.id].push(q)
        else orphans.push(q)
      }
    }
    return { map, orphans }
  }, [sections, questions])

  const answeredCount = useMemo(() => questions.filter(q => hasText(q.answer)).length, [questions])

  const headerTitle = paper?.exam_title?.trim() || paper?.title || ''
  const subtitle = paper ? `${subjectName ? subjectName + ' · ' : ''}${paper.is_generated ? 'IQRA Test Paper' : paper.is_model_paper ? 'Model Paper' : 'Past Paper'} ${paper.year}` : ''

  // Print: build the PDF on the device (works offline), then hand it to the phone's print dialog.
  async function onPrint() {
    if (!paper || printing) return
    setPrinting(true)
    setPrintMsg('')
    try {
      const [{ buildPaperPdf }, { printPdf, loadLogo }] = await Promise.all([import('../lib/paperPdf'), import('../lib/printPaper')])
      const logo = await loadLogo()
      const bytes = await buildPaperPdf({ paper, sections, questions, subjectName, classLevel, logo })
      const label = paper.is_generated ? `IQRA-Test-Paper-${subjectName}` : `${subjectName}-${paper.is_model_paper ? 'Model-Paper' : 'Paper'}-${paper.year}`
      await printPdf(bytes, label)
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      setPrintMsg(why === 'PRINT_PLUGINS_MISSING'
        ? `Printing on this phone needs the app update that includes the Filesystem and Share plugins. [${BUILD_TAG}]`
        : `Could not prepare the paper for printing (${why}) [${BUILD_TAG}]`)
    } finally {
      setPrinting(false)
    }
  }

  function renderQuestion(q: Question) {
    const isAlt = !!q.or_pair_key && !!q.is_alternate
    const opts = Array.isArray(q.options) ? q.options : []
    const letter = mode === 'study' && q.section_type === 'mcq' ? correctLetter(q.answer) : null
    const group = q.group_id ? groups[q.group_id] : undefined
    const repeatYears = group && group.repeat_count > 1 && group.years
      ? [...group.years].sort((a, b) => b - a)
      : null
    const rubric = mode === 'study' ? parseRubric(q.rubric) : []

    return (
      <div key={q.id}>
        {isAlt && (
          <div className="text-center font-bold text-sm my-3 text-slate-700 dark:text-slate-300">-OR-</div>
        )}
        <div className="flex gap-2 py-1.5">
          <div className="w-8 flex-shrink-0 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {isAlt ? '' : questionLabel(q)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2">
              <div className="flex-1 text-sm leading-relaxed text-slate-900 dark:text-slate-100 whitespace-pre-line">
                <FractionText text={q.question} />
              </div>
              {q.marks !== null && q.section_type !== 'mcq' && (
                <div className="flex-shrink-0 text-xs font-semibold text-slate-600 dark:text-slate-400">
                  [{formatMarks(q.marks)}]
                </div>
              )}
            </div>

            {opts.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                {opts.map((opt, i) => {
                  const L = OPTION_LETTERS[i] ?? String(i + 1)
                  const isCorrect = letter === L
                  return (
                    <div
                      key={i}
                      className={`text-sm ${isCorrect ? 'font-bold text-brand-700 dark:text-brand-400' : 'text-slate-800 dark:text-slate-200'}`}
                    >
                      ({L}) <FractionText text={String(opt)} />
                    </div>
                  )
                })}
              </div>
            )}

            {mode === 'study' && repeatYears && (
              <div className="mt-1.5 inline-block text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-0.5 rounded-full">
                Asked {group!.repeat_count} times: {repeatYears.join(', ')}
              </div>
            )}

            {mode === 'study' && q.chapter_id && (
              <button
                onClick={() => navigate(`/chapter/${q.chapter_id}`)}
                className="mt-2 text-[11px] font-bold text-brand-700 dark:text-brand-400 underline underline-offset-2"
              >
                Study this chapter
              </button>
            )}

            {mode === 'study' && hasText(q.answer) && (
              <div className="mt-2 rounded-xl bg-brand-50 dark:bg-brand-950/40 px-3 py-2">
                <div className="text-xs font-bold text-brand-700 dark:text-brand-400 mb-0.5">
                  {q.section_type === 'mcq' ? 'Correct answer' : 'Model answer'}
                </div>
                <div className="text-sm leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-line">
                  <FractionText text={q.answer} />
                </div>
                {rubric.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {rubric.map((r, i) => (
                      <li key={i} className="text-xs text-slate-700 dark:text-slate-300 flex gap-2">
                        <span className="flex-shrink-0 font-bold text-brand-700 dark:text-brand-400">
                          {formatMarks(r.points ?? 1)}
                        </span>
                        <span><FractionText text={r.concept ?? ''} /></span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      <GreenHero>
        <button onClick={() => navigate(-1)} className="text-brand-200 mb-2 flex items-center gap-1 text-xs">
          <ChevronLeft size={14} /> Back
        </button>
        <div className="mb-3">
          <h1 className="text-lg font-black leading-tight">{paper ? paper.title : 'Past paper'}</h1>
          {subtitle && <p className="text-brand-100 text-xs mt-0.5">{subtitle}</p>}
        </div>
        {/* Mode switch */}
        <div className="flex bg-white/20 rounded-xl p-1" role="tablist" aria-label="Paper mode">
          {([['view', 'View only'], ['study', 'Read & study']] as [Mode, string][]).map(([m, label]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`flex-1 text-xs font-bold py-1.5 rounded-lg transition-all ${
                mode === m ? 'bg-white text-brand-700 dark:bg-slate-800 dark:text-brand-400' : 'text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <button
            onClick={() => navigate(`${base}/${paperId}/exam`)}
            disabled={!paper}
            className="text-xs font-bold py-2 rounded-xl bg-white text-brand-700 disabled:opacity-60"
          >
            Sit as an exam
          </button>
          <button
            onClick={onPrint}
            disabled={!paper || printing}
            className="text-xs font-bold py-2 rounded-xl bg-white/20 text-white disabled:opacity-60"
          >
            {printing ? 'Preparing…' : 'Print'}
          </button>
        </div>
        {printMsg && <div role="alert" className="mt-2 text-[11px] font-semibold text-white">{printMsg}</div>}
        {paper && (
          <div className="mt-2">
            <PaperDownloadButton kind={kind} paperId={paper.id} serverVersion={version} />
          </div>
        )}
      </GreenHero>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {loading && (
          <div className="flex justify-center py-10" role="status" aria-label="Loading paper">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && state === 'notfound' && (
          <div className="text-center text-sm text-gray-500 py-12 dark:text-slate-400">
            This paper is not available.
          </div>
        )}

        {!loading && state === 'reconnect' && (
          <div role="alert" className="text-center text-sm text-gray-500 py-12 dark:text-slate-400">
            Connect to the internet once to keep using your downloaded papers.
          </div>
        )}

        {!loading && state === 'error' && (
          <div className="text-center text-sm text-gray-500 py-12 dark:text-slate-400">
            Could not load this paper. Check your connection and go back to try again.
          </div>
        )}

        {!loading && state === 'ok' && paper && (
          <>
            {mode === 'study' && questions.length > 0 && answeredCount < questions.length && (
              <div role="status" className="mb-3 text-xs text-slate-600 bg-white rounded-xl px-3 py-2 dark:bg-slate-800 dark:text-slate-300">
                {answeredCount === 0
                  ? 'Model answers for this paper are being added. Repeat tags are shown below.'
                  : 'Model answers are being added. Questions without one show only the question.'}
              </div>
            )}

            {/* The paper, laid out like the printed board paper */}
            <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-sm px-4 py-5 overflow-hidden" style={{ fontFamily: '"Times New Roman", Times, serif' }}>
              {/* Faint IQRA logo behind the paper (works offline) */}
              <LogoWatermark />
              <div className="relative">
                {/* Header block as printed on the board paper */}
                <div className="mb-4 text-slate-900 dark:text-slate-100">
                  <div className="text-center text-[11px] sm:text-xs font-bold leading-snug">
                    BALOCHISTAN BOARD OF INTERMEDIATE &amp; SECONDARY EDUCATION QUETTA
                  </div>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-2 mt-2 text-xs">
                    <div className="font-bold">{formatTime(paper.time_minutes) ? `TIME: ${formatTime(paper.time_minutes)}` : ''}</div>
                    <div className="text-center font-semibold">{headerTitle}</div>
                    <div className="text-right font-bold">{paper.total_marks !== null ? `MARKS: ${formatMarks(paper.total_marks)}` : ''}</div>
                  </div>
                  {paper.pattern === 'legacy' ? (
                    <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-2 mt-1 text-xs">
                      <div className="font-bold">{hasText(paper.group_label) ? paper.group_label : ''}</div>
                      <div className="text-center text-sm font-bold">
                        SUBJECT: {subjectName.toUpperCase()}{classOrdinal(classLevel) ? ` – ${classOrdinal(classLevel)}` : ''}
                      </div>
                      <div className="text-right font-bold">
                        {paper.passing_marks !== null ? `PASSING MARKS: ${formatMarks(paper.passing_marks)}` : ''}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-sm font-bold mt-1">
                      SUBJECT: {subjectName.toUpperCase()}{classOrdinal(classLevel) ? ` – ${classOrdinal(classLevel)}` : ''}
                    </div>
                  )}
                  {hasText(paper.paper_note) && (
                    <div className="text-[11px] italic text-slate-600 dark:text-slate-400 mt-2">{paper.paper_note}</div>
                  )}
                  <div className="border-b border-slate-300 dark:border-slate-600 mt-2" />
                </div>

                {sections.map((s, idx) => {
                  const qs = bySection.map[s.id] ?? []
                  if (qs.length === 0) return null
                  const prev = idx > 0 ? sections[idx - 1] : null
                  const showPart = !prev || prev.part_name !== s.part_name
                  return (
                    <div key={s.id} className="mb-4">
                      {showPart && (
                        <div className="text-center text-sm font-bold underline underline-offset-2 mb-2 text-slate-900 dark:text-slate-100">
                          {s.part_name}
                        </div>
                      )}
                      {hasText(s.instruction) && (
                        <div className="text-sm font-semibold mb-2 text-slate-900 dark:text-slate-100 whitespace-pre-line">
                          {s.instruction}
                        </div>
                      )}
                      {qs.map(renderQuestion)}
                    </div>
                  )
                })}

                {bySection.orphans.length > 0 && (
                  <div className="mb-4">{bySection.orphans.map(renderQuestion)}</div>
                )}

                {/* Closing line: printed on legacy board papers only */}
                {paper.pattern === 'legacy' && (
                  <div className="text-center text-xs font-bold text-slate-800 dark:text-slate-200 mt-6">The End</div>
                )}

                {/* Reserved for a future "Report a mistake" button */}
                <div data-slot="report-mistake" />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
