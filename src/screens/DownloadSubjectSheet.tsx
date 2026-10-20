import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Check } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import GreenHero from '../components/GreenHero'
import { estimateSubject, downloadSubject, formatBytes, lastDownloadReason, Progress, SubjectEstimate } from '../lib/downloadManager'
import { storageAvailable, isQuotaError, lastStorageError, BUILD_TAG } from '../lib/offlineStore'

type Props = {
  subjectId: string
  subjectName: string
  onClose: () => void
  onChanged: () => void
}

type Phase = 'info' | 'running' | 'done' | 'cancelled' | 'failed'

const CAN_DO = [
  'Open every past paper and the model paper, with model answers',
  'Print any paper',
  'Sit a paper as an exam, with the timer, marking and your result',
  'Generate new practice papers, full or chapter-wise',
  'See the Most Important Chapters',
]

const SAVED = [
  'All the published papers for this subject',
  'The question bank, chapters and chapter importance used to generate papers',
  'The list of questions you have already been given, so new papers do not repeat them',
]

const HOW = [
  'Everything is saved inside the IQRA app only. It is not in your gallery or Downloads, cannot be shared, and other apps cannot open it.',
  'It works without internet for one year. Each time you open the app with internet, it renews for another year and brings any corrections to the papers.',
  'Papers you generate and exams you finish offline upload by themselves when the internet is back.',
  'If the phone\'s date is moved back, or a year passes with no internet, you will be asked to connect once before using the downloads.',
  'Signing out removes the saved papers from this phone. You can also delete them any time from Downloaded papers.',
]

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4">
      <div className="text-sm font-black text-slate-900 dark:text-slate-100 mb-2">{title}</div>
      <ul className="flex flex-col gap-2">
        {items.map(t => (
          <li key={t} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            <span className="mt-0.5 w-4 h-4 rounded-full bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-400 flex-shrink-0 flex items-center justify-center">
              <Check size={10} />
            </span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// "Download all" for ONE subject. First a page that explains what it switches on and how it works;
// nothing is downloaded until the student taps Start download.
export default function DownloadSubjectSheet({ subjectId, subjectName, onClose, onChanged }: Props) {
  const { user } = useAuth()
  const uid = user?.id
  const [phase, setPhase] = useState<Phase>('info')
  const [estimate, setEstimate] = useState<SubjectEstimate | null>(null)
  const [progress, setProgress] = useState<Progress>({ done: 0, total: 0 })
  const [message, setMessage] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  // The size is shown quietly once known. It is not needed to start.
  useEffect(() => {
    if (!uid || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
    let cancelled = false
    estimateSubject(uid, subjectId).then(e => { if (!cancelled) setEstimate(e) }).catch(() => { /* optional */ })
    return () => { cancelled = true }
  }, [uid, subjectId])

  async function start() {
    if (!uid) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setMessage('Connect to the internet to download.')
      setPhase('failed')
      return
    }
    // Check that this browser or phone can save anything at all, before downloading a single byte.
    const probe = await storageAvailable()
    if (!probe.ok) {
      setMessage(`This browser cannot save papers on the device right now (${probe.reason}). Use a normal, non-private window and make sure site data is allowed, then try again. [${BUILD_TAG}]`)
      setPhase('failed')
      return
    }
    const ac = new AbortController()
    abortRef.current = ac
    setPhase('running')
    setMessage('')
    try {
      const res = await downloadSubject(uid, subjectId, { signal: ac.signal, onProgress: setProgress })
      onChanged()
      if (res.cancelled) { setPhase('cancelled'); return }
      if (res.error === 'offline') { setMessage('The connection was lost. What was saved is kept. Start again to continue.'); setPhase('failed'); return }
      if (res.error === 'storage') {
        setMessage(isQuotaError()
          ? `The browser's storage for this app is full (${lastStorageError()}). What was saved is kept. [${BUILD_TAG}]`
          : `Could not save on this device (${lastStorageError()}). What was saved is kept. Start again to continue. [${BUILD_TAG}]`)
        setPhase('failed')
        return
      }
      if (res.failed > 0) { setMessage(`${res.failed} item${res.failed === 1 ? '' : 's'} could not be saved (${lastDownloadReason()}). Start again to finish. [${BUILD_TAG}]`); setPhase('failed'); return }
      setPhase('done')
    } catch {
      onChanged()
      setMessage('The download stopped. What was saved is kept. Start again to continue.')
      setPhase('failed')
    }
  }

  function cancel() { abortRef.current?.abort() }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  const running = phase === 'running'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-50 dark:bg-slate-950 max-w-sm mx-auto" role="dialog" aria-modal="true" aria-label={`Download ${subjectName}`}>
      <GreenHero>
        <button onClick={onClose} disabled={running} className="text-brand-200 mb-2 flex items-center gap-1 text-xs disabled:opacity-50">
          <ChevronLeft size={14} /> Back
        </button>
        <h1 className="text-xl font-black">Download {subjectName}</h1>
        <p className="text-brand-100 text-xs">Use {subjectName} past papers without internet</p>
      </GreenHero>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {phase === 'info' && (
          <>
            <List title="What you can do offline" items={CAN_DO} />
            <List title="What gets saved on this phone" items={SAVED} />
            <List title="How it works" items={HOW} />
            {estimate && (
              <div className="text-[11px] text-gray-500 dark:text-slate-400 text-center">
                About {formatBytes(estimate.bytes)} in total.
                {estimate.papersToGet === 0 ? ' Your papers are already saved, so this only refreshes the question bank.' : ''}
              </div>
            )}
          </>
        )}

        {running && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4">
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">Saving {subjectName}…</div>
            <div className="text-xs text-slate-600 dark:text-slate-300 mb-2">{progress.done} of {progress.total}</div>
            <div className="h-2 rounded-full bg-gray-100 dark:bg-slate-700" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-2 rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {phase === 'done' && (
          <div role="status" className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 text-sm font-semibold text-brand-700 dark:text-brand-400">
            Done. {subjectName} now works offline. You can find everything under Downloaded papers.
          </div>
        )}
        {phase === 'cancelled' && (
          <div role="status" className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 text-sm text-slate-700 dark:text-slate-300">
            Cancelled. What was already saved is kept. Start again to continue where you stopped.
          </div>
        )}
        {phase === 'failed' && (
          <div role="alert" className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 text-sm font-semibold text-red-600 dark:text-red-400">{message}</div>
        )}
      </div>

      <div className="px-4 pb-5 pt-2 flex flex-col gap-2 border-t border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-950">
        {phase === 'info' && (
          <button onClick={start} className="w-full bg-brand-600 text-white font-bold rounded-2xl py-3">Start download</button>
        )}
        {running && (
          <button onClick={cancel} className="w-full text-sm font-bold rounded-2xl py-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">Cancel</button>
        )}
        {(phase === 'cancelled' || phase === 'failed') && (
          <button onClick={start} className="w-full bg-brand-600 text-white font-bold rounded-2xl py-3">Start again</button>
        )}
        {phase === 'done' && (
          <button onClick={onClose} className="w-full bg-brand-600 text-white font-bold rounded-2xl py-3">Close</button>
        )}
        {(phase === 'cancelled' || phase === 'failed') && (
          <button onClick={onClose} className="w-full text-sm font-bold rounded-xl py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">Not now</button>
        )}
      </div>
    </div>
  )
}
