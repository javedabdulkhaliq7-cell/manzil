import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { ArrowLeft, ScanLine, Search, Plus, Smartphone, Trash2, FolderInput, X, CheckCircle2, Download, HardDrive } from 'lucide-react'
import GreenHero from '../components/GreenHero'
import { useScanProfile } from '../lib/scanner/useScanProfile'
import { scanDb, type ScanRow } from '../lib/scanner/scanDb'
import { reconcileScans } from '../lib/scanner/savePipeline'
import { searchContent, resumePendingOcr, useOcrProgress, isSkippedSubject, type TextHit } from '../lib/scanner/ocr'
import { loadSubjects, addCustomSubject, renameCustomSubject, deleteCustomSubject, type ScanSubject } from '../lib/scanner/subjects'
import { rememberScanUser, lastScanUser } from '../lib/scanner/scanUser'
import { useScanFile } from '../lib/scanner/useScanFile'

// IQRA Scanner — S3: "My Scans" library (plan section 5). Route: /scan
type Sort = 'newest' | 'name' | 'size'
const OTHER = '__other__'

function fmtSize(b: number) {
  return b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`
}
function fmtDate(t: number) {
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function ScanCard({ scan, selected, selecting, onTap, onLongPress }: {
  scan: ScanRow; selected: boolean; selecting: boolean; onTap: () => void; onLongPress: () => void
}) {
  const thumb = useScanFile(scan.thumbPath, scan.updatedAt)
  const timer = useRef<number | null>(null)
  const fired = useRef(false)
  const start = () => {
    fired.current = false
    timer.current = window.setTimeout(() => { fired.current = true; onLongPress() }, 450)
  }
  const cancel = () => { if (timer.current) window.clearTimeout(timer.current) }
  return (
    <button
      onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel} onPointerMove={cancel}
      onClick={() => { if (!fired.current) onTap() }}
      className={`relative w-full flex gap-3 text-left bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-3 active:scale-[0.99] transition-all ${selected ? 'ring-2 ring-brand-500' : ''}`}
    >
      <div className="w-16 h-20 rounded-lg overflow-hidden bg-gray-100 dark:bg-slate-700 flex-shrink-0">
        {thumb && <img src={thumb} alt="" className="w-full h-full object-cover" />}
      </div>
      <div className="flex-1 min-w-0">
        <div dir="auto" className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{scan.name}</div>
        <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">{fmtDate(scan.createdAt)}</div>
        <div className="text-[11px] text-gray-400 dark:text-slate-500">{scan.pageCount} page{scan.pageCount === 1 ? '' : 's'} · {fmtSize(scan.sizeBytes)}</div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <span dir="auto" className="text-[10px] font-bold text-brand-700 bg-brand-50 dark:bg-brand-950/40 dark:text-brand-400 rounded-full px-2 py-0.5">{scan.subjectLabel}</span>
          {scan.localCopyUri && (
            <span className="text-[10px] font-bold text-sky-700 bg-sky-50 rounded-full px-2 py-0.5 flex items-center gap-1"><Download size={9} /> Saved on phone</span>
          )}
        </div>
      </div>
      {selecting && (
        <CheckCircle2 size={20} className={`absolute top-2 right-2 ${selected ? 'text-brand-600' : 'text-gray-300'}`} />
      )}
    </button>
  )
}

export default function ScanScreen() {
  const navigate = useNavigate()
  const profile = useScanProfile()
  const native = Capacitor.isNativePlatform()

  // Offline rule: fall back to the remembered user so the library still opens.
  const userId = profile?.id ?? lastScanUser()
  const classId = profile?.class_level ?? ''

  const [scans, setScans] = useState<ScanRow[]>([])
  const [subjects, setSubjects] = useState<ScanSubject[]>([])
  const [chip, setChip] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('newest')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [moving, setMoving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const ocr = useOcrProgress()
  const [hits, setHits] = useState<TextHit[]>([])
  const selecting = selected.size > 0
  const chipTimer = useRef<number | null>(null)
  const chipFired = useRef(false)
  const [showNotice, setShowNotice] = useState(() => {
    try { return !localStorage.getItem('iqra_scan_storage_notice_seen') } catch { return false }
  })

  useEffect(() => { if (profile?.id) rememberScanUser(profile.id) }, [profile?.id])

  const reload = useCallback(async () => {
    if (!userId) return
    const rows = await scanDb.scans.where('userId').equals(userId).toArray()
    setScans(rows)
    if (classId) setSubjects(await loadSubjects(userId, classId))
    setLoaded(true)
  }, [userId, classId])

  useEffect(() => {
    if (!native || !userId) { setLoaded(true); return }
    // quietly drop entries whose file is gone, then show the library
    reconcileScans(userId).finally(() => { reload(); resumePendingOcr(userId) })
  }, [native, userId, reload])

  // search inside the text of scans (after OCR), debounced
  useEffect(() => {
    const q = query.trim()
    if (!native || !userId || q.length < 2) { setHits([]); return }
    const t = window.setTimeout(() => { searchContent(userId, q).then(setHits).catch(() => setHits([])) }, 300)
    return () => window.clearTimeout(t)
  }, [query, userId, native, ocr?.scanId, ocr?.done])

  const skippedCount = useMemo(() => scans.filter((s) => isSkippedSubject(s.subjectLabel)).length, [scans])
  const scanById = useMemo(() => new Map(scans.map((s) => [s.id, s])), [scans])

  const inClass = useMemo(() => scans.filter((s) => s.classId === classId), [scans, classId])

  const chips = useMemo(() => {
    const list = [
      { id: 'all', label: 'All', count: scans.length },
      ...subjects.map((s) => ({ id: s.id, label: s.label, count: inClass.filter((x) => x.subjectId === s.id).length })),
      { id: OTHER, label: 'Other', count: inClass.filter((x) => x.subjectId === null || !subjects.some((s) => s.id === x.subjectId)).length },
    ]
    return list
  }, [scans, subjects, inClass])

  const visible = useMemo(() => {
    let rows = scans
    if (chip === OTHER) rows = inClass.filter((x) => x.subjectId === null || !subjects.some((s) => s.id === x.subjectId))
    else if (chip !== 'all') rows = inClass.filter((x) => x.subjectId === chip)
    const q = query.trim().toLowerCase()
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q)) // content search arrives with OCR (S10)
    return [...rows].sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : sort === 'size' ? b.sizeBytes - a.sizeBytes : b.createdAt - a.createdAt)
  }, [scans, inClass, subjects, chip, query, sort])

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function deleteSelected() {
    if (!window.confirm(`Delete ${selected.size} scan${selected.size === 1 ? '' : 's'}? This can't be undone.`)) return
    for (const id of selected) {
      const row = scans.find((s) => s.id === id)
      if (!row) continue
      await Filesystem.rmdir({ path: row.folderPath, directory: Directory.Data, recursive: true }).catch(() => {})
      await scanDb.scans.delete(id)
    }
    setSelected(new Set())
    reload()
  }

  async function moveSelected(subject: { id: string | null; label: string }) {
    const now = Date.now()
    await scanDb.scans.bulkUpdate([...selected].map((id) => ({
      key: id, changes: { subjectId: subject.id, subjectLabel: subject.label, updatedAt: now },
    })))
    setMoving(false)
    setSelected(new Set())
    reload()
  }

  // Long-press on one of the student's own subject chips: rename, or empty name = delete.
  async function manageSubject(id: string) {
    const subj = subjects.find((x) => x.id === id && x.custom)
    if (!subj) return
    const next = window.prompt('Rename subject (leave empty to delete it)', subj.label)
    if (next === null) return
    if (next.trim() === '') {
      if (window.confirm(`Delete "${subj.label}"? Its scans move to Other.`)) {
        await deleteCustomSubject(id)
        if (chip === id) setChip('all')
        reload()
      }
    } else {
      await renameCustomSubject(id, next)
      reload()
    }
  }

  async function onAddSubject() {
    if (!userId || !classId) return
    const name = window.prompt('New subject name')
    if (name) { await addCustomSubject(userId, classId, name); reload() }
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      <GreenHero className="pb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => (selecting ? setSelected(new Set()) : navigate('/home'))}
            aria-label={selecting ? 'Cancel selection' : 'Back to Home'}
            className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center active:scale-95 transition-all"
          >
            {selecting ? <X size={18} /> : <ArrowLeft size={18} />}
          </button>
          <div className="flex-1">
            <div className="text-xl font-bold">{selecting ? `${selected.size} selected` : 'My Scans'}</div>
            {!selecting && <div className="text-xs text-brand-100">Scan notes and textbook pages</div>}
          </div>
          {!selecting && native && (
            <button onClick={() => navigate('/scan/storage')} aria-label="Storage" className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center active:scale-95"><HardDrive size={17} /></button>
          )}
          {selecting && (
            <div className="flex gap-2">
              <button onClick={() => setMoving(true)} aria-label="Move" className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center"><FolderInput size={17} /></button>
              <button onClick={deleteSelected} aria-label="Delete" className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center"><Trash2 size={17} /></button>
            </div>
          )}
        </div>
      </GreenHero>

      {!native ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 px-6">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400 flex items-center justify-center"><Smartphone size={28} /></div>
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">Scanning is available in the IQRA Android app</div>
          <button onClick={() => navigate('/home')} className="text-xs font-bold text-brand-600">← Back to Home</button>
        </div>
      ) : (
        <>
          {/* Search + sort */}
          <div className="px-4 pt-3 flex gap-2">
            <div className="flex-1 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search scans"
                className="w-full rounded-xl border border-gray-200 bg-white pl-8 pr-3 py-2 text-sm dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"
              />
            </div>
            <select
              value={sort} onChange={(e) => setSort(e.target.value as Sort)}
              className="rounded-xl border border-gray-200 bg-white px-2 text-xs dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"
            >
              <option value="newest">Newest</option>
              <option value="name">Name</option>
              <option value="size">Size</option>
            </select>
          </div>

          {/* Subject chips */}
          <div className="px-4 pt-3 flex gap-2 overflow-x-auto no-scrollbar flex-shrink-0">
            {chips.map((c) => (
              <button
                key={c.id} onClick={() => { if (!chipFired.current) setChip(c.id) }}
                onPointerDown={() => {
                  chipFired.current = false
                  if (subjects.some((x) => x.id === c.id && x.custom)) {
                    chipTimer.current = window.setTimeout(() => { chipFired.current = true; manageSubject(c.id) }, 500)
                  }
                }}
                onPointerUp={() => chipTimer.current && window.clearTimeout(chipTimer.current)}
                onPointerLeave={() => chipTimer.current && window.clearTimeout(chipTimer.current)}
                className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition-all ${
                  chip === c.id ? 'bg-brand-600 text-white' : 'bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                <span dir="auto">{c.label}</span> <span className="opacity-70">{c.count}</span>
              </button>
            ))}
            <button onClick={onAddSubject} aria-label="Add subject" className="flex-shrink-0 rounded-full px-2.5 py-1.5 bg-white text-brand-600 dark:bg-slate-800"><Plus size={14} /></button>
          </div>

          {ocr && (
            <div className="mx-4 mt-3 text-[11px] text-gray-500 dark:text-slate-400">Reading text… {Math.min(ocr.done + 1, ocr.total)}/{ocr.total}</div>
          )}

          {showNotice && (
            <div className="mx-4 mt-3 text-[11px] text-sky-800 bg-sky-50 rounded-xl px-3 py-2 flex items-start gap-2">
              <span className="flex-1">Scans are saved on this phone only. Uninstalling IQRA or resetting your phone will delete them. Open the scanner once while online so it is ready to use offline.</span>
              <button
                className="font-bold flex-shrink-0"
                onClick={() => { try { localStorage.setItem('iqra_scan_storage_notice_seen', '1') } catch { /* ignore */ } setShowNotice(false) }}
              >Got it</button>
            </div>
          )}


          {/* List */}
          <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 pb-24">
            {!loaded ? null : scans.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-10">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-100 to-rose-50 text-rose-700 dark:from-rose-950/50 dark:to-rose-900/30 dark:text-rose-400 flex items-center justify-center"><ScanLine size={28} /></div>
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100">Scan your notes or textbook pages</div>
                <div className="text-xs text-gray-400 dark:text-slate-500 max-w-[260px]">Scans are saved on this phone only. Uninstalling IQRA or resetting your phone will delete them.</div>
                <button onClick={() => navigate('/scan/new')} className="bg-brand-600 text-white text-xs font-bold rounded-full px-6 py-2.5 active:scale-95 transition-all">Scan</button>
              </div>
            ) : visible.length === 0 && hits.length === 0 ? (
              <div className="text-center text-xs text-gray-400 dark:text-slate-500 py-10">No scans found</div>
            ) : (
              visible.map((s) => (
                <ScanCard
                  key={s.id} scan={s} selected={selected.has(s.id)} selecting={selecting}
                  onTap={() => {
                    if (selecting) toggle(s.id)
                    else navigate(`/scan/view/${s.id}`)
                  }}
                  onLongPress={() => toggle(s.id)}
                />
              ))
            )}

            {hits.length > 0 && (
              <>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1 dark:text-slate-500">Found in page text</div>
                {hits.map((h) => {
                  const sc = scanById.get(h.scanId)
                  if (!sc) return null
                  return (
                    <button key={`${h.scanId}:${h.pageIndex}`} onClick={() => navigate(`/scan/view/${h.scanId}?page=${h.pageIndex + 1}`)}
                      className="w-full text-left bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-3 active:scale-[0.99] transition-all">
                      <div dir="auto" className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{sc.name} <span className="text-brand-600">· page {h.pageIndex + 1}</span></div>
                      <div dir="auto" className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">{h.snippet}</div>
                    </button>
                  )
                })}
              </>
            )}
            {query.trim().length >= 2 && skippedCount > 0 && (
              <div className="text-[11px] text-gray-400 dark:text-slate-500">
                {skippedCount} scan{skippedCount === 1 ? '' : 's'} in Urdu or Islamiat aren't searched by text yet. Search works best on printed pages.
              </div>
            )}
          </div>

          {/* Floating Scan button */}
          {!selecting && scans.length > 0 && (
            <button
              onClick={() => navigate('/scan/new')} aria-label="New scan"
              className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-brand-600 text-white shadow-lg flex items-center justify-center active:scale-95 transition-all"
            >
              <ScanLine size={24} />
            </button>
          )}

          {/* Move sheet */}
          {moving && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setMoving(false)}>
              <div className="w-full max-w-sm mx-auto bg-white dark:bg-slate-900 rounded-t-3xl p-4 max-h-[60vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="text-sm font-bold mb-3 text-slate-900 dark:text-slate-100">Move to subject</div>
                {[...subjects.map((s) => ({ id: s.id as string | null, label: s.label })), { id: null, label: 'Other' }].map((s) => (
                  <button key={s.id ?? 'other'} onClick={() => moveSelected(s)} dir="auto"
                    className="w-full text-left px-3 py-3 rounded-xl text-sm font-semibold text-slate-800 dark:text-slate-200 active:bg-gray-100 dark:active:bg-slate-800">
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
