import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronDown, ChevronUp, FileX, Sparkles, Download } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Subject } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import BottomNav from '../components/BottomNav'
import GreenHero from '../components/GreenHero'
import FractionText from '../components/FractionText'
import GeneratePaperSheet from './GeneratePaperSheet'
import DownloadSubjectSheet from './DownloadSubjectSheet'
import { loadSubjects, loadListData, loadSavedVersions, MyGenerated } from '../lib/listData'

type Paper = {
  id: string
  subject_id: string
  title: string
  year: number
  board: string
  is_free: boolean
  is_predicted: boolean
  mcq_count: number
  time_minutes: number | null
  total_marks: number | null
  is_model_paper: boolean
  status: string
  version?: number | null
}

type ChapterImportance = {
  chapter_id: string
  chapter_number: number
  title: string
  percentage: number
  rank: number
}

// Phase 7 adds the viewer route. Flip this to true once /past-papers/:id exists,
// so students never tap a row that leads nowhere.
const VIEWER_READY = true

const LAST_SUBJECT_KEY = 'iqra_past_papers_last_subject'
const TOP_COUNT = 4

function readLastSubject(): string | null {
  try { return localStorage.getItem(LAST_SUBJECT_KEY) } catch { return null }
}
function saveLastSubject(id: string) {
  try { localStorage.setItem(LAST_SUBJECT_KEY, id) } catch { /* storage unavailable */ }
}

// Some chapter titles are stored in capitals. Show them in normal case.
function tidyTitle(title: string): string {
  const letters = title.replace(/[^A-Za-z]/g, '')
  if (letters.length > 0 && letters === letters.toUpperCase()) {
    return title.toLowerCase().replace(/(^|\s)([a-z])/g, (_, s, c) => s + c.toUpperCase())
  }
  return title
}

function formatTime(minutes: number | null): string | null {
  if (!minutes) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

function formatMarks(marks: number | null): string | null {
  if (marks === null || marks === undefined) return null
  const n = Number(marks)
  return `${Number.isInteger(n) ? n : n.toFixed(1)} marks`
}

export default function PastPapersScreen() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const classLevel = profile?.class_level ?? 'Class 9'

  const [subjects, setSubjects] = useState<Subject[]>([])
  const [activeSubjectId, setActiveSubjectId] = useState<string | null>(null)
  const [papers, setPapers] = useState<Paper[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [chapters, setChapters] = useState<ChapterImportance[]>([])
  const [showAllChapters, setShowAllChapters] = useState(false)
  const [showGenerate, setShowGenerate] = useState(false)
  const [myPapers, setMyPapers] = useState<MyGenerated[]>([])
  const [showDownload, setShowDownload] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [saved, setSaved] = useState<Record<string, number | null>>({})
  const [notice, setNotice] = useState('')
  const [fromDevice, setFromDevice] = useState(false)

  const activeSubject = subjects.find(s => s.id === activeSubjectId) ?? null

  // Subjects for the student's own class only (from the saved list when offline)
  useEffect(() => {
    let cancelled = false
    async function load() {
      const data = await loadSubjects(classLevel)
      if (cancelled) return
      if (data.length > 0) {
        setSubjects(data)
        const savedId = readLastSubject()
        const start = data.find((s: Subject) => s.id === savedId) ?? data[0]
        setActiveSubjectId(start.id)
      } else {
        setSubjects([])
        setActiveSubjectId(null)
        setLoading(false)
      }
    }
    load().catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [classLevel])

  // Published papers and chapter importance for the active subject: from the server when online,
  // from the saved copies when not. The cleanup flag drops answers from tabs the student has left.
  useEffect(() => {
    if (!activeSubjectId) return
    let cancelled = false
    setLoading(true)
    setFailed(false)
    setNotice('')
    setShowAllChapters(false)

    async function load() {
      const [data, savedVersions] = await Promise.all([loadListData(activeSubjectId as string), loadSavedVersions()])
      if (cancelled) return
      setFromDevice(data.source === 'device')
      setSaved(savedVersions)
      setPapers(data.papers as Paper[])
      setChapters(data.importance as ChapterImportance[])
      setMyPapers(data.my)
      setFailed(data.status === 'error')
      if (data.status === 'not-downloaded') setNotice('This subject is not saved on this phone. Connect to the internet to see its papers, or download it when you are online.')
      else if (data.status === 'reconnect') setNotice('Connect to the internet once to keep using your downloaded papers.')
      setLoading(false)
    }
    load().catch(() => { if (!cancelled) { setFailed(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [activeSubjectId, reloadKey])

  function selectSubject(id: string) {
    if (id === activeSubjectId) return
    saveLastSubject(id)
    setActiveSubjectId(id)
  }

  function openPaper(paper: Paper) {
    if (VIEWER_READY) navigate(`/past-papers/${paper.id}`)
  }

  const visibleChapters = showAllChapters ? chapters : chapters.slice(0, TOP_COUNT)
  const subjectName = activeSubject?.name ?? 'Paper'

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      <GreenHero>
        <button onClick={() => navigate(-1)} className="text-brand-200 mb-2 flex items-center gap-1 text-xs">
          <ChevronLeft size={14} /> Back
        </button>
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl">📄</span>
          <div>
            <h1 className="text-xl font-black">Past Papers</h1>
            <p className="text-brand-100 text-xs">Balochistan Board · {classLevel}</p>
          </div>
        </div>
        {/* Subject tabs */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {subjects.map(sub => (
            <button
              key={sub.id}
              onClick={() => selectSubject(sub.id)}
              className={`flex-shrink-0 text-[10px] font-bold px-3 py-1.5 rounded-xl transition-all ${
                activeSubjectId === sub.id
                  ? 'bg-white text-brand-700 dark:bg-slate-800 dark:text-brand-400'
                  : 'bg-white/20 text-white'
              }`}
            >
              {sub.emoji} <FractionText text={sub.name} />
            </button>
          ))}
        </div>
      </GreenHero>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {/* Generate a new paper */}
        <button
          onClick={() => setShowGenerate(true)}
          disabled={!activeSubject}
          className="w-full flex items-center justify-center gap-2 bg-brand-600 text-white text-sm font-bold rounded-2xl py-3 active:scale-[0.99] transition-transform disabled:opacity-60"
        >
          <Sparkles size={16} /> Generate a new paper
        </button>

        {/* Save to this phone */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setShowDownload(true)}
            disabled={!activeSubject}
            className="flex items-center justify-center gap-1.5 bg-white text-brand-700 text-xs font-bold rounded-2xl py-2.5 shadow-sm dark:bg-slate-800 dark:text-brand-400 disabled:opacity-60"
          >
            <Download size={14} /> Download all
          </button>
          <button
            onClick={() => navigate('/downloads')}
            className="flex items-center justify-center bg-white text-slate-700 text-xs font-bold rounded-2xl py-2.5 shadow-sm dark:bg-slate-800 dark:text-slate-200"
          >
            Downloaded papers
          </button>
        </div>

        {fromDevice && !notice && (
          <div role="status" className="text-[11px] text-gray-500 dark:text-slate-400">Showing the papers saved on this phone.</div>
        )}
        {notice && (
          <div role="status" className="text-xs text-slate-700 bg-white rounded-2xl px-4 py-3 dark:bg-slate-800 dark:text-slate-300">{notice}</div>
        )}

        {/* Most important chapters */}
        {chapters.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
            <div className="text-sm font-black text-slate-900 dark:text-slate-100">Most important chapters</div>
            <div className="text-[11px] text-gray-400 mb-3 dark:text-slate-500">
              Based on marks in past papers, with recent years counted more
            </div>
            <div className="flex flex-col gap-3">
              {visibleChapters.map(ch => (
                <div key={ch.chapter_id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 min-w-0">
                      <span className="text-gray-400 dark:text-slate-500">{ch.rank}.</span>{' '}
                      <FractionText text={tidyTitle(ch.title)} />
                    </div>
                    <div className="text-xs font-bold text-brand-700 dark:text-brand-400 flex-shrink-0">
                      {Number(ch.percentage).toFixed(1)}%
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-100 mt-1.5 dark:bg-slate-700">
                    <div
                      className="h-1.5 rounded-full bg-brand-500"
                      style={{ width: `${Math.min(100, Math.max(0, Number(ch.percentage)))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            {chapters.length > TOP_COUNT && (
              <button
                onClick={() => setShowAllChapters(v => !v)}
                className="mt-3 flex items-center gap-1 text-xs font-bold text-brand-600 dark:text-brand-400"
              >
                {showAllChapters ? <>Show fewer <ChevronUp size={14} /></> : <>See all chapters <ChevronDown size={14} /></>}
              </button>
            )}
          </div>
        )}

        {/* Paper list */}
        <div className="text-xs font-bold text-gray-500 dark:text-slate-400">Papers</div>

        {loading && (
          <div className="flex justify-center py-6" role="status" aria-label="Loading papers">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && failed && (
          <div className="text-center text-xs text-gray-500 py-6 dark:text-slate-400">
            Could not load papers. Check your connection and switch subjects to try again.
          </div>
        )}

        {!loading && !failed && papers.map(paper => {
          const meta = [paper.board === 'balochistan' ? 'Balochistan Board' : paper.board, formatMarks(paper.total_marks), formatTime(paper.time_minutes)]
            .filter(Boolean)
            .join(' · ')
          const label = paper.is_model_paper ? `${subjectName} Model Paper ${paper.year}` : `${subjectName} Paper ${paper.year}`
          return (
            <button
              key={paper.id}
              onClick={() => openPaper(paper)}
              disabled={!VIEWER_READY}
              className="w-full text-left bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3 dark:bg-slate-800 disabled:cursor-default"
            >
              <div className="w-10 h-12 bg-gradient-to-br from-brand-100 to-brand-50 dark:from-brand-950/50 dark:to-brand-900/30 rounded-lg flex items-center justify-center text-xl flex-shrink-0">📄</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  <FractionText text={label} />
                </div>
                <div className="text-xs text-gray-400 mt-0.5 dark:text-slate-500">{meta}</div>
              </div>
              {paper.is_model_paper && (
                <span className="text-[10px] bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300 font-bold px-2 py-0.5 rounded-full flex-shrink-0">
                  Model Paper
                </span>
              )}
              {saved[paper.id] !== undefined && (
                <span className="text-[10px] bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300 font-bold px-2 py-0.5 rounded-full flex-shrink-0">
                  {!fromDevice && paper.version != null && saved[paper.id] !== paper.version ? 'Update' : 'Saved'}
                </span>
              )}
            </button>
          )
        })}

        {!loading && !failed && !notice && papers.length === 0 && (
          <div className="flex flex-col items-center text-center py-14 px-6">
            <div className="w-16 h-16 rounded-2xl bg-brand-50 flex items-center justify-center mb-4 dark:bg-brand-950/40">
              <FileX className="text-brand-400" size={28} />
            </div>
            <div className="text-sm font-semibold text-gray-700 mb-1 dark:text-slate-300">No past papers here yet</div>
            <div className="text-xs text-gray-400 max-w-[220px] dark:text-slate-500">Check back soon. More papers are added regularly.</div>
          </div>
        )}

        {/* My generated papers */}
        <div className="text-xs font-bold text-gray-500 mt-2 dark:text-slate-400">My generated papers</div>
        {myPapers.length === 0 ? (
          <div className="text-xs text-gray-400 bg-white rounded-2xl p-4 dark:bg-slate-800 dark:text-slate-500">
            Papers you generate will be saved here so you can open them again.
          </div>
        ) : (
          myPapers.map(g => (
            <button
              key={g.id}
              onClick={() => navigate(`/generated-papers/${g.id}`)}
              className="w-full text-left bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3 dark:bg-slate-800"
            >
              <div className="w-10 h-12 bg-gradient-to-br from-brand-100 to-brand-50 dark:from-brand-950/50 dark:to-brand-900/30 rounded-lg flex items-center justify-center text-xl flex-shrink-0">📝</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{subjectName} practice paper</div>
                <div className="text-xs text-gray-400 mt-0.5 dark:text-slate-500">
                  {new Date(g.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' · '}
                  {g.scope === 'full' ? 'Full paper' : g.scope === 'chapters' ? `${g.chapter_ids?.length ?? 0} chapter${(g.chapter_ids?.length ?? 0) === 1 ? '' : 's'}` : 'Practice paper'}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {showDownload && activeSubject && (
        <DownloadSubjectSheet
          subjectId={activeSubject.id}
          subjectName={activeSubject.name}
          onClose={() => setShowDownload(false)}
          onChanged={() => setReloadKey(k => k + 1)}
        />
      )}

      {showGenerate && activeSubject && (
        <GeneratePaperSheet
          subjectId={activeSubject.id}
          subjectName={activeSubject.name}
          onClose={() => setShowGenerate(false)}
          onCreated={id => { setShowGenerate(false); navigate(`/generated-papers/${id}`) }}
        />
      )}

      <BottomNav />
    </div>
  )
}
