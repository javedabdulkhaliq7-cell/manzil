// IQRA Scanner — S5 general PDF viewer (plan section 9).
// Put this file at src/components/viewer/PdfViewer.tsx
// Works for any PDF: pass a loader that returns a pdf.js document.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { ArrowLeft, MoreVertical, Moon, Sun, LayoutGrid, X, Highlighter, Pencil, Eraser, Undo2, Redo2, Hand, Search } from 'lucide-react'
import PdfPageCanvas from './PdfPageCanvas'
import AnnotationLayer from './AnnotationLayer'
import { COLORS, emptyAnnotations, type AnnotationData, type Stroke, type Tool } from '../../lib/scanner/annotations'

export interface ViewerMenuItem { label: string; onClick: (page: number) => void; danger?: boolean }
export interface SearchHit { page: number; snippet: string }

interface Props {
  title: string
  loadDoc: () => Promise<PDFDocumentProxy>   // must be stable (useCallback)
  initialPage?: number
  onPageChange?: (page: number) => void
  onBack: () => void
  menu?: ViewerMenuItem[]
  annotations?: AnnotationData                         // loaded layer (S6); omit to hide the highlighter button
  onAnnotationsChange?: (data: AnnotationData) => void // called after every change so the screen can save
  searchFn?: (query: string) => Promise<SearchHit[]>   // S10: search inside this document (omit to hide the search button)
  searchHint?: string                                  // shown when there are no results, e.g. "Still reading text…"
}

const GAP = 8
const TOP_PAD = 56      // room under the top bar so page 1 is never hidden
const BOTTOM_PAD = 72
const MAX_SCALE = 4
const DOUBLE_TAP_SCALE = 2.5
const PREFS_KEY = 'iqra_viewer_prefs'

type Mode = 'scroll' | 'page'
function loadPrefs(): { mode: Mode; night: boolean } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    return { mode: p.mode === 'page' ? 'page' : 'scroll', night: !!p.night }
  } catch { return { mode: 'scroll', night: false } }
}
// pdf.js versions differ: some expose destroy() on the document, newer ones only on its loading task.
function destroyDoc(d: PDFDocumentProxy | null) {
  if (!d) return
  try {
    const anyDoc = d as any
    if (typeof anyDoc.destroy === 'function') anyDoc.destroy()
    else d.loadingTask?.destroy()
  } catch { /* already closed */ }
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export default function PdfViewer({ title, loadDoc, initialPage = 1, onPageChange, onBack, menu = [], annotations, onAnnotationsChange, searchFn, searchHint }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const prefs = useMemo(loadPrefs, [])

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [aspects, setAspects] = useState<number[]>([])
  const [baseWidth, setBaseWidth] = useState(0)
  const [viewH, setViewH] = useState(0)
  const [viewTop, setViewTop] = useState(0)
  const [scale, setScale] = useState(1)
  const [settled, setSettled] = useState(1)
  const [mode, setMode] = useState<Mode>(prefs.mode)
  const [night, setNight] = useState(prefs.night)
  const [bars, setBars] = useState(true)
  const [page, setPage] = useState(Math.max(1, initialPage))
  const [grid, setGrid] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [jump, setJump] = useState<string | null>(null)

  // ---- S10 search in document ----
  const [searchOpen, setSearchOpen] = useState(false)
  const [sq, setSq] = useState('')
  const [sResults, setSResults] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    if (!searchOpen || !searchFn) return
    if (sq.trim().length < 2) { setSResults([]); return }
    setSearching(true)
    const t = window.setTimeout(() => {
      searchFn(sq).then((r) => setSResults(r)).catch(() => setSResults([])).finally(() => setSearching(false))
    }, 300)
    return () => window.clearTimeout(t)
  }, [sq, searchOpen, searchFn])

  // ---- S6 highlighting state ----
  const [ann, setAnn] = useState<AnnotationData>(annotations ?? emptyAnnotations())
  const [undoStack, setUndoStack] = useState<AnnotationData[]>([])
  const [redoStack, setRedoStack] = useState<AnnotationData[]>([])
  const [annOpen, setAnnOpen] = useState(false)
  const [tool, setTool] = useState<Tool>('none')
  const [color, setColor] = useState(COLORS[0])
  const [widthMul, setWidthMul] = useState(1)
  const toolRef = useRef<Tool>('none')
  toolRef.current = tool

  const scaleRef = useRef(1)
  const prevScaleRef = useRef(1)
  const focalRef = useRef({ cx: 0, cy: 0 })
  const modeRef = useRef(mode)
  const pageRef = useRef(page)
  const numPagesRef = useRef(0)
  const didInit = useRef(false)
  const lastTap = useRef(0)
  const tapTimer = useRef<number | null>(null)
  scaleRef.current = scale
  modeRef.current = mode
  pageRef.current = page
  numPagesRef.current = aspects.length

  // ---- load document + page sizes (before showing, so layout never jumps) ----
  useEffect(() => {
    let alive = true
    let loaded: PDFDocumentProxy | null = null
    loadDoc()
      .then(async (d) => {
        const arr: number[] = []
        for (let i = 1; i <= d.numPages; i++) {
          const v = (await d.getPage(i)).getViewport({ scale: 1 })
          arr.push(v.height / v.width)
        }
        if (!alive) { destroyDoc(d); return }
        loaded = d
        setDoc(d); setAspects(arr); setStatus('ready')
      })
      .catch(() => { if (alive) setStatus('error') })
    return () => { alive = false; destroyDoc(loaded) }
  }, [loadDoc])

  // ---- measure the viewport ----
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    const measure = () => { setBaseWidth(sc.clientWidth); setViewH(sc.clientHeight) }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(sc)
    return () => ro.disconnect()
  }, [status])

  // ---- layout ----
  const layout = useMemo(() => {
    const offs: number[] = []
    let y = TOP_PAD
    for (const a of aspects) { offs.push(y); y += a * baseWidth * scale + GAP }
    return { offs, total: y + BOTTOM_PAD }
  }, [aspects, baseWidth, scale])

  const goTo = useCallback((p: number) => {
    const n = numPagesRef.current
    if (n === 0) return
    const target = clamp(Math.round(p), 1, n)
    setPage(target)
    const sc = scrollRef.current
    if (!sc) return
    if (modeRef.current === 'scroll') sc.scrollTop = layout.offs[target - 1] - TOP_PAD
    else sc.scrollTo(0, 0)
  }, [layout.offs])

  // jump to the remembered page once
  useEffect(() => {
    if (status !== 'ready' || baseWidth === 0 || didInit.current) return
    didInit.current = true
    goTo(initialPage)
  }, [status, baseWidth, initialPage, goTo])

  // ---- zoom: keep the pinch point under the fingers ----
  useLayoutEffect(() => {
    const sc = scrollRef.current
    const ratio = scale / prevScaleRef.current
    prevScaleRef.current = scale
    if (!sc || ratio === 1) return
    const { cx, cy } = focalRef.current
    sc.scrollLeft = (sc.scrollLeft + cx) * ratio - cx
    sc.scrollTop = (sc.scrollTop + cy) * ratio - cy
  }, [scale])

  useEffect(() => {  // pages re-render sharply once zooming stops
    const t = window.setTimeout(() => setSettled(scale), 250)
    return () => window.clearTimeout(t)
  }, [scale])

  const zoomTo = useCallback((next: number, cx: number, cy: number) => {
    focalRef.current = { cx, cy }
    const clamped = clamp(next, 1, MAX_SCALE)
    scaleRef.current = clamped
    setScale(clamped)
  }, [])

  // ---- pinch + swipe (native listeners: pinch needs preventDefault) ----
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc || status !== 'ready') return
    let pinching = false
    let startDist = 0
    let startScale = 1
    let sx = 0, sy = 0, swiping = false
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) { pinching = true; swiping = false; startDist = dist(e.touches); startScale = scaleRef.current }
      else if (e.touches.length === 1) { swiping = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY }
    }
    const onMove = (e: TouchEvent) => {
      if (!pinching || e.touches.length !== 2) return
      e.preventDefault()
      const rect = sc.getBoundingClientRect()
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top
      zoomTo(startScale * (dist(e.touches) / startDist), cx, cy)
    }
    const onEnd = (e: TouchEvent) => {
      if (pinching) { if (e.touches.length < 2) pinching = false; swiping = false; return }
      if (swiping && modeRef.current === 'page' && toolRef.current === 'none' && scaleRef.current <= 1.02 && e.changedTouches.length === 1) {
        const dx = e.changedTouches[0].clientX - sx
        const dy = e.changedTouches[0].clientY - sy
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          goTo(pageRef.current + (dx < 0 ? 1 : -1))
        }
      }
      swiping = false
    }
    sc.addEventListener('touchstart', onStart, { passive: true })
    sc.addEventListener('touchmove', onMove, { passive: false })
    sc.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      sc.removeEventListener('touchstart', onStart)
      sc.removeEventListener('touchmove', onMove)
      sc.removeEventListener('touchend', onEnd)
    }
  }, [status, zoomTo, goTo])

  // ---- scroll tracking (current page + which pages to render) ----
  const rafRef = useRef<number | null>(null)
  const onScroll = () => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const sc = scrollRef.current
      if (!sc) return
      setViewTop(sc.scrollTop)
      if (modeRef.current !== 'scroll') return
      const center = sc.scrollTop + sc.clientHeight / 2
      let cur = 0
      for (let i = 0; i < layout.offs.length; i++) if (layout.offs[i] <= center) cur = i
      setPage(cur + 1)
    })
  }

  // remember the last page (debounced)
  useEffect(() => {
    if (status !== 'ready' || !didInit.current) return
    const t = window.setTimeout(() => onPageChange?.(page), 400)
    return () => window.clearTimeout(t)
  }, [page, status, onPageChange])

  // remember mode + night mode
  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ mode, night })) } catch { /* ignore */ }
  }, [mode, night])

  function switchMode() {
    const next: Mode = mode === 'scroll' ? 'page' : 'scroll'
    setMode(next)
    modeRef.current = next
    setScale(1); scaleRef.current = 1; setSettled(1)
    requestAnimationFrame(() => goTo(pageRef.current))
  }

  // ---- S6 highlighting actions ----
  function commitAnn(next: AnnotationData) {
    setUndoStack((u) => [...u.slice(-49), ann])
    setRedoStack([])
    setAnn(next)
    onAnnotationsChange?.(next)
  }
  const strokesFor = (i: number): Stroke[] => ann.pages[String(i)] ?? []
  const addStroke = (i: number) => (s: Stroke) =>
    commitAnn({ ...ann, pages: { ...ann.pages, [String(i)]: [...strokesFor(i), s] } })
  const eraseStrokes = (i: number) => (ids: string[]) =>
    commitAnn({ ...ann, pages: { ...ann.pages, [String(i)]: strokesFor(i).filter((s) => !ids.includes(s.id)) } })
  function undo() {
    const prev = undoStack[undoStack.length - 1]
    if (!prev) return
    setUndoStack((u) => u.slice(0, -1))
    setRedoStack((r) => [...r, ann])
    setAnn(prev)
    onAnnotationsChange?.(prev)
  }
  function redo() {
    const next = redoStack[redoStack.length - 1]
    if (!next) return
    setRedoStack((r) => r.slice(0, -1))
    setUndoStack((u) => [...u, ann])
    setAnn(next)
    onAnnotationsChange?.(next)
  }
  function toggleAnnotating() {
    if (annOpen) { setAnnOpen(false); setTool('none') }
    else { setAnnOpen(true); setTool('highlighter'); setBars(true) }
  }

  // ---- taps: single = show/hide bars, double = zoom ----
  function onContentClick(e: ReactMouseEvent) {
    setMenuOpen(false)
    if (toolRef.current !== 'none') return // drawing, not navigating
    const sc = scrollRef.current
    if (!sc) return
    const now = Date.now()
    if (now - lastTap.current < 280) {
      if (tapTimer.current) window.clearTimeout(tapTimer.current)
      lastTap.current = 0
      const rect = sc.getBoundingClientRect()
      zoomTo(scaleRef.current > 1.05 ? 1 : DOUBLE_TAP_SCALE, e.clientX - rect.left, e.clientY - rect.top)
      return
    }
    lastTap.current = now
    tapTimer.current = window.setTimeout(() => setBars((b) => !b), 280)
  }

  // ---- which pages are mounted ----
  const pageW = baseWidth * scale
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const pixelWidth = Math.min(Math.round(baseWidth * settled * dpr), 2400)
  const mounted = useMemo(() => {
    if (mode === 'page') return [page - 1]
    const from = viewTop - viewH
    const to = viewTop + viewH * 2
    const out: number[] = []
    layout.offs.forEach((o, i) => {
      const h = aspects[i] * pageW
      if (o + h >= from && o <= to) out.push(i)
    })
    return out
  }, [mode, page, viewTop, viewH, layout.offs, aspects, pageW])

  const n = aspects.length

  if (status === 'error') {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3 bg-gray-50 dark:bg-slate-950 px-6 text-center">
        <div className="text-sm font-bold text-slate-900 dark:text-slate-100">This file can't be opened</div>
        <div className="text-xs text-gray-400 dark:text-slate-500">It may be damaged or password-protected.</div>
        <button onClick={onBack} className="text-xs font-bold text-brand-600">← Back</button>
      </div>
    )
  }

  return (
    <div className="relative h-screen overflow-hidden" style={{ background: night ? '#0b0f14' : '#e5e7eb' }}>
      {/* pages */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onClick={onContentClick}
        className="absolute inset-0 overflow-auto"
        style={{ touchAction: 'pan-x pan-y' }}
      >
        {status === 'loading' ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400">Opening…</div>
        ) : mode === 'scroll' ? (
          <div style={{ position: 'relative', width: pageW, height: layout.total, filter: night ? 'invert(1) hue-rotate(180deg)' : undefined }}>
            {mounted.map((i) => (
              <div key={i} style={{ position: 'absolute', top: layout.offs[i], left: 0, width: pageW, height: aspects[i] * pageW, background: '#fff' }} className="shadow">
                {doc && <PdfPageCanvas doc={doc} pageNum={i + 1} pixelWidth={pixelWidth} />}
                {onAnnotationsChange && (
                  <AnnotationLayer strokes={strokesFor(i)} aspect={aspects[i]} tool={tool} color={color} widthMul={widthMul}
                    onCommitStroke={addStroke(i)} onEraseStrokes={eraseStrokes(i)} />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ width: pageW, paddingTop: TOP_PAD, paddingBottom: BOTTOM_PAD, filter: night ? 'invert(1) hue-rotate(180deg)' : undefined }}>
            <div style={{ position: 'relative', width: pageW, height: (aspects[page - 1] ?? 1.41) * pageW, background: '#fff' }} className="shadow">
              {doc && <PdfPageCanvas key={page} doc={doc} pageNum={page} pixelWidth={pixelWidth} />}
              {onAnnotationsChange && (
                <AnnotationLayer key={`a${page}`} strokes={strokesFor(page - 1)} aspect={aspects[page - 1] ?? 1.41} tool={tool} color={color} widthMul={widthMul}
                  onCommitStroke={addStroke(page - 1)} onEraseStrokes={eraseStrokes(page - 1)} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* top bar */}
      <div className={`absolute top-0 inset-x-0 z-20 bg-gradient-to-br from-emerald-700 to-emerald-500 text-white px-3 py-3 flex items-center gap-1.5 transition-transform duration-200 ${bars ? '' : '-translate-y-full'}`}>
        <button onClick={onBack} aria-label="Back" className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center active:scale-95"><ArrowLeft size={18} /></button>
        <div dir="auto" className="flex-1 min-w-0 text-sm font-bold truncate">{title}</div>
        <button onClick={() => setNight((v) => !v)} aria-label="Night mode" className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center active:scale-95">{night ? <Sun size={17} /> : <Moon size={17} />}</button>
        {searchFn && (
          <button onClick={() => { setSearchOpen(true); setBars(true) }} aria-label="Search" className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center active:scale-95"><Search size={16} /></button>
        )}
        {onAnnotationsChange && (
          <button onClick={toggleAnnotating} aria-label="Highlight" className={`w-8 h-8 rounded-full flex items-center justify-center active:scale-95 ${annOpen ? 'bg-white text-emerald-700' : 'bg-white/20'}`}><Highlighter size={17} /></button>
        )}
        <button onClick={() => setGrid(true)} aria-label="Pages" className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center active:scale-95"><LayoutGrid size={17} /></button>
        {menu.length > 0 && (
          <button onClick={() => setMenuOpen((v) => !v)} aria-label="More" className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center active:scale-95"><MoreVertical size={17} /></button>
        )}
      </div>

      {menuOpen && (
        <div className="absolute top-14 right-3 z-30 bg-white dark:bg-slate-800 rounded-2xl shadow-lg py-1 min-w-[160px]">
          {menu.map((m) => (
            <button key={m.label} onClick={() => { setMenuOpen(false); m.onClick(page) }}
              className={`w-full text-left px-4 py-2.5 text-sm font-semibold ${m.danger ? 'text-red-600' : 'text-slate-800 dark:text-slate-100'}`}>
              {m.label}
            </button>
          ))}
        </div>
      )}

      {/* bottom bar */}
      {status === 'ready' && !annOpen && (
        <div className={`absolute bottom-0 inset-x-0 z-20 bg-white/95 dark:bg-slate-900/95 px-4 py-3 flex items-center gap-3 transition-transform duration-200 ${bars ? '' : 'translate-y-full'}`}>
          {jump === null ? (
            <button onClick={() => setJump(String(page))} className="text-xs font-bold text-slate-800 dark:text-slate-100 min-w-[52px] text-left">{page} / {n}</button>
          ) : (
            <form className="flex-shrink-0" onSubmit={(e) => { e.preventDefault(); goTo(Number(jump) || page); setJump(null) }}>
              <input
                autoFocus type="number" inputMode="numeric" value={jump} min={1} max={n}
                onChange={(e) => setJump(e.target.value)} onBlur={() => setJump(null)}
                className="w-14 rounded-lg border border-gray-300 px-2 py-1 text-xs dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
              />
            </form>
          )}
          <input type="range" min={1} max={Math.max(1, n)} value={page} onChange={(e) => goTo(Number(e.target.value))} className="flex-1 accent-emerald-600" />
          <button onClick={switchMode} className="text-[11px] font-bold text-brand-700 dark:text-brand-400 whitespace-nowrap">
            {mode === 'scroll' ? 'Scroll' : 'Pages'}
          </button>
        </div>
      )}

      {/* search panel */}
      {searchOpen && searchFn && (
        <div className="absolute inset-0 z-40 bg-white dark:bg-slate-900 flex flex-col">
          <div className="px-3 py-3 flex items-center gap-2 border-b border-gray-100 dark:border-slate-800">
            <input
              autoFocus value={sq} onChange={(e) => setSq(e.target.value)} placeholder="Search in this scan" dir="auto"
              className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"
            />
            <button onClick={() => { setSearchOpen(false); setSq(''); setSResults([]) }} aria-label="Close search" className="w-8 h-8 flex items-center justify-center text-gray-500"><X size={18} /></button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {sResults.map((r, i) => (
              <button key={`${r.page}-${i}`} onClick={() => { setSearchOpen(false); goTo(r.page) }}
                className="w-full text-left px-4 py-3 border-b border-gray-50 dark:border-slate-800 active:bg-gray-50 dark:active:bg-slate-800">
                <div className="text-[11px] font-bold text-brand-700 dark:text-brand-400">Page {r.page}</div>
                <div dir="auto" className="text-xs text-slate-700 dark:text-slate-300 mt-0.5">{r.snippet}</div>
              </button>
            ))}
            {!searching && sResults.length === 0 && (
              <div className="px-6 py-10 text-center text-xs text-gray-400 dark:text-slate-500">
                {sq.trim().length < 2 ? 'Type at least 2 letters. Search works best on printed pages.' : (searchHint ?? 'No matches found.')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* highlighting toolbar */}
      {status === 'ready' && annOpen && (
        <div className="absolute bottom-0 inset-x-0 z-20 bg-white/95 dark:bg-slate-900/95 px-3 py-2.5 flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            {([
              ['none', Hand, 'Read'],
              ['highlighter', Highlighter, 'Highlighter'],
              ['pen', Pencil, 'Pen'],
              ['eraser', Eraser, 'Eraser'],
            ] as const).map(([t, Icon, label]) => (
              <button key={t} onClick={() => setTool(t)} aria-label={label}
                className={`w-9 h-9 rounded-xl flex items-center justify-center ${tool === t ? 'bg-brand-600 text-white' : 'bg-gray-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                <Icon size={17} />
              </button>
            ))}
            <div className="flex-1" />
            <button onClick={undo} disabled={undoStack.length === 0} aria-label="Undo" className="w-9 h-9 flex items-center justify-center text-slate-700 dark:text-slate-200 disabled:opacity-30"><Undo2 size={18} /></button>
            <button onClick={redo} disabled={redoStack.length === 0} aria-label="Redo" className="w-9 h-9 flex items-center justify-center text-slate-700 dark:text-slate-200 disabled:opacity-30"><Redo2 size={18} /></button>
            <button onClick={toggleAnnotating} aria-label="Done" className="w-9 h-9 flex items-center justify-center text-brand-700"><X size={18} /></button>
          </div>
          {(tool === 'highlighter' || tool === 'pen') && (
            <div className="flex items-center gap-2.5">
              {COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)} aria-label={`Colour ${c}`}
                  className={`w-6 h-6 rounded-full ${color === c ? 'ring-2 ring-offset-2 ring-slate-500' : ''}`} style={{ background: c }} />
              ))}
              <input type="range" min={0.5} max={3} step={0.1} value={widthMul} onChange={(e) => setWidthMul(Number(e.target.value))} className="flex-1 accent-emerald-600 ml-1" aria-label="Thickness" />
            </div>
          )}
        </div>
      )}

      {/* thumbnail grid */}
      {grid && doc && (
        <div className="absolute inset-0 z-40 bg-white dark:bg-slate-900 overflow-y-auto">
          <div className="sticky top-0 bg-white dark:bg-slate-900 px-4 py-3 flex items-center justify-between border-b border-gray-100 dark:border-slate-800">
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100">Pages</div>
            <button onClick={() => setGrid(false)} aria-label="Close" className="w-8 h-8 flex items-center justify-center text-gray-500"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-3 gap-3 p-4">
            {aspects.map((a, i) => (
              <button key={i} onClick={() => { setGrid(false); setTimeout(() => goTo(i + 1), 0) }} className="text-center">
                <div className={`bg-white shadow rounded overflow-hidden ${page === i + 1 ? 'ring-2 ring-brand-500' : ''}`} style={{ aspectRatio: `${1 / a}` }}>
                  <PdfPageCanvas doc={doc} pageNum={i + 1} pixelWidth={180} />
                </div>
                <div className="text-[10px] text-gray-400 mt-1">{i + 1}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
