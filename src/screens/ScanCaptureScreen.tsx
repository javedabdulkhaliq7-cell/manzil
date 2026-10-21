import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ScanLine, Loader2 } from 'lucide-react'
import GreenHero from '../components/GreenHero'
import { useScanProfile } from '../lib/scanner/useScanProfile'
import { saveScan } from '../lib/scanner/savePipeline'
import type { ScanQuality } from '../lib/scanner/scanDb'
import type { ScanMode } from '../lib/scanner/enhancePage'
import { enqueueOcr } from '../lib/scanner/ocr'
import { getFreeSpaceBytes, openAppSettings } from '../lib/scanner/nativeBridge'
import { loadSubjects, loadChapters, type ScanSubject } from '../lib/scanner/subjects'
import {
  ensureScannerModule, scanPages, previewSrc, scannerSupported,
  SOFT_WARN_PAGES, type ScannerModuleStatus,
} from '../lib/scanner/scannerService'

// IQRA Scanner — capture + save sheet (route /scan/new; S4).
// Optional query params pre-fill the sheet (used by the chapter-header camera in S7):
//   /scan/new?subject=<subjectId>&chapter=<chapterId>
export default function ScanCaptureScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const profile = useScanProfile()
  const supported = scannerSupported()

  const [status, setStatus] = useState<ScannerModuleStatus>(supported ? 'checking' : 'unsupported')
  const [progress, setProgress] = useState(0)
  const [pages, setPages] = useState<string[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [mode, setMode] = useState<ScanMode>('text')
  const [quality, setQuality] = useState<ScanQuality>('high')

  // Save sheet state
  const [subjects, setSubjects] = useState<ScanSubject[]>([])
  const [subjectId, setSubjectId] = useState<string | null>(params.get('subject'))
  const [chapters, setChapters] = useState<{ id: string; title: string }[]>([])
  const [chapterId, setChapterId] = useState<string | null>(params.get('chapter'))
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)

  useEffect(() => {
    if (!supported) return
    let alive = true
    ensureScannerModule((p) => { if (alive) { setStatus('downloading'); setProgress(p) } })
      .then((s) => { if (alive) setStatus(s) })
    return () => { alive = false }
  }, [supported])

  useEffect(() => {
    if (profile?.id && profile.class_level) loadSubjects(profile.id, profile.class_level).then(setSubjects)
  }, [profile?.id, profile?.class_level])

  const subject = subjects.find((s) => s.id === subjectId) ?? null
  useEffect(() => {
    setChapters([])
    if (subject && !subject.custom) loadChapters(subject.id).then(setChapters)
    else setChapterId(null)
  }, [subject?.id])

  // Name auto-fills as Subject_Chapter_Date until the student edits it.
  const autoName = useMemo(() => {
    const date = new Date().toISOString().slice(0, 10)
    const chapter = chapters.find((c) => c.id === chapterId)?.title
    const parts = [subject?.label ?? 'Scan', chapter ? chapter.slice(0, 24) : null, date].filter(Boolean) as string[]
    return parts.join('_').replace(/\s+/g, '_')
  }, [subject?.label, chapters, chapterId])
  useEffect(() => { if (!nameTouched) setName(autoName) }, [autoName, nameTouched])

  async function onScan() {
    setMessage(null)
    setBusy(true)
    const out = await scanPages()
    setBusy(false)
    if (out.kind === 'pages') setPages((prev) => [...prev, ...out.uris]) // scanning again adds more pages before saving
    else if (out.kind === 'error') {
      if (out.permission) setPermissionDenied(true)
      else setMessage(out.message)
    }
  }

  async function onSave() {
    if (!profile) return
    setMessage(null)
    // Warn (never silently fail) when the phone is nearly out of space.
    const free = await getFreeSpaceBytes()
    const needed = pages.length * 1.5 * 1024 * 1024 + 30 * 1024 * 1024
    if (free !== null && free < needed &&
        !window.confirm('Your phone is almost out of storage, so saving this scan may fail. Save anyway?')) return
    const result = await saveScan({
      userId: profile.id,
      name: name || autoName,
      classId: profile.class_level,
      subjectId: subject?.id ?? null,
      subjectLabel: subject?.label ?? 'Other',
      chapterId,
      uris: pages,
      quality,
      mode,
      onProgress: (done, total, stage) => setSaving(`${stage}… ${Math.min(done + 1, total)}/${total}`),
    })
    setSaving(null)
    if (result.ok) { enqueueOcr(result.row.id); if (result.note) window.alert(result.note); navigate('/scan', { replace: true }) }
    else setMessage(result.message)
  }

  const hasPages = pages.length > 0

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      <GreenHero className="pb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => { if (!hasPages || window.confirm('Discard this scan?')) navigate('/scan') }}
            aria-label="Back to My Scans"
            className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center active:scale-95 transition-all"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="text-xl font-bold">{hasPages ? 'Save Scan' : 'New Scan'}</div>
            <div className="text-xs text-brand-100">{hasPages ? `${pages.length} page${pages.length === 1 ? '' : 's'}` : 'Scan notes and textbook pages'}</div>
          </div>
        </div>
      </GreenHero>

      <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-3">
        {!supported ? (
          <div className="text-center text-sm font-bold text-slate-900 dark:text-slate-100 py-10">Scanning is available in the IQRA Android app</div>
        ) : !hasPages ? (
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-100 to-rose-50 text-rose-700 dark:from-rose-950/50 dark:to-rose-900/30 dark:text-rose-400 flex items-center justify-center"><ScanLine size={28} /></div>
            {status === 'checking' && <div className="text-xs text-gray-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Checking scanner…</div>}
            {status === 'downloading' && <div className="text-xs text-gray-500 dark:text-slate-400">Preparing scanner… {Math.round(progress)}%</div>}
            {status === 'failed' && <div className="text-xs text-amber-600 max-w-[260px]">Scanner isn't ready. Connect to the internet once so it can finish setting up, then reopen this screen.</div>}
            {status === 'noPlayServices' && <div className="text-xs text-amber-600 max-w-[260px]">Scanner isn't supported on this phone. It needs Google Play Services.</div>}
            {status === 'ready' && <div className="text-[11px] font-semibold text-brand-600">Scanner ready ✓</div>}
            {permissionDenied && (
              <div className="flex flex-col items-center gap-2 max-w-[260px]">
                <div className="text-xs text-amber-600">Camera access is turned off for IQRA. Turn it on in your phone's settings to scan.</div>
                <button onClick={() => openAppSettings()} className="text-xs font-bold text-brand-600">Open settings</button>
              </div>
            )}
            <button onClick={onScan} disabled={status !== 'ready' || busy}
              className="bg-brand-600 text-white text-xs font-bold rounded-full px-6 py-2.5 active:scale-95 transition-all disabled:opacity-50">
              {busy ? 'Opening…' : 'Scan'}
            </button>
          </div>
        ) : (
          <>
            {/* page strip */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {pages.map((u, i) => (
                <img key={u} src={previewSrc(u)} alt={`Page ${i + 1}`} className="h-24 aspect-[3/4] object-cover rounded-lg border border-gray-200 dark:border-slate-700 flex-shrink-0" />
              ))}
            </div>
            {pages.length >= SOFT_WARN_PAGES && <div className="text-[11px] text-amber-600">Large scans can take longer to share</div>}
            <button onClick={onScan} disabled={busy || !!saving} className="self-start text-xs font-bold text-brand-600 disabled:opacity-50">+ Add more pages</button>

            {/* name */}
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 dark:text-slate-500">Name</div>
              <input
                dir="auto" value={name} onChange={(e) => { setName(e.target.value); setNameTouched(true) }}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"
              />
            </div>

            {/* subject */}
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 dark:text-slate-500">Subject</div>
              <div className="flex flex-wrap gap-2">
                {[...subjects, { id: '__other__', label: 'Other', custom: false } as ScanSubject].map((s) => {
                  const active = s.id === '__other__' ? subjectId === null : subjectId === s.id
                  return (
                    <button key={s.id} dir="auto" onClick={() => setSubjectId(s.id === '__other__' ? null : s.id)}
                      className={`rounded-full px-3 py-1.5 text-xs font-bold transition-all ${active ? 'bg-brand-600 text-white' : 'bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
                      {s.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* chapter (optional) */}
            {chapters.length > 0 && (
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 dark:text-slate-500">Chapter (optional)</div>
                <select
                  value={chapterId ?? ''} onChange={(e) => setChapterId(e.target.value || null)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"
                >
                  <option value="">No chapter</option>
                  {chapters.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
            )}

            {/* page style + quality */}
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 dark:text-slate-500">Page style</div>
              <div className="flex gap-2">
                {([['text', 'Text (books)'], ['colour', 'Colour (diagrams)']] as [ScanMode, string][]).map(([m, label]) => (
                  <button key={m} onClick={() => setMode(m)} disabled={!!saving}
                    className={`rounded-full px-3 py-1.5 text-xs font-bold transition-all ${mode === m ? 'bg-brand-600 text-white' : 'bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>{label}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 dark:text-slate-500">Quality</div>
              <div className="flex gap-2">
                {([['high', 'Clear'], ['normal', 'Normal'], ['small', 'Small']] as [ScanQuality, string][]).map(([q, label]) => (
                  <button key={q} onClick={() => setQuality(q)} disabled={!!saving}
                    className={`rounded-full px-3 py-1.5 text-xs font-bold transition-all ${quality === q ? 'bg-brand-600 text-white' : 'bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>{label}</button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 mt-1">
              <button onClick={onSave} disabled={!!saving}
                className="flex-1 bg-brand-600 text-white text-xs font-bold rounded-full py-2.5 active:scale-95 transition-all disabled:opacity-50">
                {saving ?? 'Save'}
              </button>
              <button onClick={() => { if (window.confirm('Discard this scan?')) setPages([]) }} disabled={!!saving}
                className="px-4 text-xs font-bold text-gray-500 dark:text-slate-400">Discard</button>
            </div>
          </>
        )}
        {message && <div className="text-xs text-red-500 text-center">{message}</div>}
      </div>
    </div>
  )
}
