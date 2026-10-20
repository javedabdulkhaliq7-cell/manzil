import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowLeft as Earlier, ArrowRight as Later, Trash2, Plus, Image as ImageIcon, CheckCircle2, Minimize2 } from 'lucide-react'
import GreenHero from '../components/GreenHero'
import { scanDb, type ScanRow, type ScanQuality } from '../lib/scanner/scanDb'
import { useScanFile } from '../lib/scanner/useScanFile'
import { useScanProfile } from '../lib/scanner/useScanProfile'
import { scanPages, previewSrc, ensureScannerModule } from '../lib/scanner/scannerService'
import { enqueueOcr } from '../lib/scanner/ocr'
import { applyPageEdit, compressScan, canCompressTo, sharePageImage, pagePath, type PageItem } from '../lib/scanner/editScan'

// IQRA Scanner — S8: edit pages of an existing scan (route /scan/pages/:scanId).
function Tile({ row, item, index, selected, onTap }: { row: ScanRow; item: PageItem; index: number; selected: boolean; onTap: () => void }) {
  const stored = useScanFile(item.old !== undefined ? pagePath(row, item.old) : null, row.updatedAt)
  const src = item.old !== undefined ? stored : previewSrc(item.newUri!)
  return (
    <button onClick={onTap} className="relative text-center">
      <div className={`bg-white shadow rounded overflow-hidden aspect-[3/4] ${selected ? 'ring-2 ring-brand-500' : ''}`}>
        {src && <img src={src} alt={`Page ${index + 1}`} loading="lazy" className="w-full h-full object-cover" />}
      </div>
      <div className="text-[10px] text-gray-400 mt-1">{index + 1}{item.old === undefined ? ' · new' : ''}</div>
      {selected && <CheckCircle2 size={18} className="absolute top-1.5 right-1.5 text-brand-600 bg-white rounded-full" />}
    </button>
  )
}

const QUALITY_LABEL: Record<ScanQuality, string> = { small: 'Small', normal: 'Normal', high: 'High' }

export default function ScanPagesScreen() {
  const { scanId } = useParams()
  const navigate = useNavigate()
  const me = useScanProfile()
  const [row, setRow] = useState<ScanRow | null | undefined>(undefined)
  const [items, setItems] = useState<PageItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [compressOpen, setCompressOpen] = useState(false)

  const reset = (r: ScanRow) => setItems(Array.from({ length: r.pageCount }, (_, i) => ({ key: `o${i}`, old: i })))

  useEffect(() => {
    if (!scanId) return
    scanDb.scans.get(scanId).then((r) => {
      const mine = r && (!me || r.userId === me.id) ? r : null
      setRow(mine); if (mine) reset(mine)
    })
  }, [scanId, me?.id])

  const dirty = useMemo(
    () => !!row && (items.length !== row.pageCount || items.some((it, i) => it.old !== i)),
    [items, row]
  )

  if (row === undefined) return <div className="h-screen flex items-center justify-center text-xs text-gray-400">Opening…</div>
  if (row === null) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3 text-center px-6">
        <div className="text-sm font-bold text-slate-900 dark:text-slate-100">This scan is no longer on this phone</div>
        <button onClick={() => navigate('/scan', { replace: true })} className="text-xs font-bold text-brand-600">← Back to My Scans</button>
      </div>
    )
  }
  const current = row

  const toggle = (key: string) => setSelected((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })

  function move(dir: -1 | 1) {
    setItems((prev) => {
      const a = [...prev]
      const sel = (i: number) => selected.has(a[i].key)
      if (dir === -1) { for (let i = 1; i < a.length; i++) if (sel(i) && !sel(i - 1)) [a[i - 1], a[i]] = [a[i], a[i - 1]] }
      else { for (let i = a.length - 2; i >= 0; i--) if (sel(i) && !sel(i + 1)) [a[i + 1], a[i]] = [a[i], a[i + 1]] }
      return a
    })
  }

  function removeSelected() {
    if (selected.size >= items.length) { setMessage('A scan needs at least one page. To remove everything, delete the scan instead.'); return }
    setItems((prev) => prev.filter((it) => !selected.has(it.key)))
    setSelected(new Set())
    setMessage(null)
  }

  async function addPages() {
    setMessage(null)
    await ensureScannerModule()
    const out = await scanPages()
    if (out.kind === 'pages') setItems((prev) => [...prev, ...out.uris.map((u, i) => ({ key: `n${Date.now()}_${i}`, newUri: u }))])
    else if (out.kind === 'error') setMessage(out.message)
  }

  async function save() {
    setMessage(null)
    const res = await applyPageEdit(current, items, (d, t, stage) => setBusy(`${stage}… ${Math.min(d + 1, t)}/${t}`))
    setBusy(null)
    if (res.ok) { enqueueOcr(res.row.id); navigate(`/scan/view/${current.id}`, { replace: true }) }
    else setMessage(res.message)
  }

  async function compress(q: ScanQuality) {
    setCompressOpen(false)
    setMessage(null)
    const res = await compressScan(current, q, (d, t, stage) => setBusy(`${stage}… ${Math.min(d + 1, t)}/${t}`))
    setBusy(null)
    if (res.ok) { setRow(res.row); reset(res.row); setSelected(new Set()) }
    else setMessage(res.message)
  }

  async function savePageImage() {
    const only = items.find((it) => selected.has(it.key))
    if (!only || only.old === undefined) return
    try { await sharePageImage(current, only.old) } catch { /* share sheet closed */ }
  }

  const selCount = selected.size
  const singleStored = selCount === 1 && items.find((it) => selected.has(it.key))?.old !== undefined
  const btn = 'w-10 h-10 rounded-xl bg-gray-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 flex items-center justify-center disabled:opacity-30'

  return (
    <div className="relative flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      <GreenHero className="pb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => { if (!dirty || window.confirm('Discard your changes?')) navigate(`/scan/view/${current.id}`, { replace: true }) }}
            aria-label="Back" className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center active:scale-95"
          ><ArrowLeft size={18} /></button>
          <div className="flex-1 min-w-0">
            <div className="text-xl font-bold">Edit pages</div>
            <div dir="auto" className="text-xs text-brand-100 truncate">{current.name} · {items.length} page{items.length === 1 ? '' : 's'}</div>
          </div>
          {dirty && (
            <button onClick={save} disabled={!!busy} className="bg-white text-emerald-700 text-xs font-bold rounded-full px-4 py-2 active:scale-95 disabled:opacity-60">
              {busy ?? 'Save'}
            </button>
          )}
        </div>
      </GreenHero>

      <div className="flex-1 overflow-y-auto p-4 pb-28">
        {message && <div className="text-xs text-red-500 mb-3">{message}</div>}
        {busy && !dirty && <div className="text-xs text-gray-500 mb-3">{busy}</div>}
        <div className="grid grid-cols-3 gap-3">
          {items.map((it, i) => (
            <Tile key={it.key} row={current} item={it} index={i} selected={selected.has(it.key)} onTap={() => toggle(it.key)} />
          ))}
        </div>
      </div>

      <div className="absolute bottom-0 inset-x-0 bg-white/95 dark:bg-slate-900/95 px-4 py-3 flex items-center gap-2 border-t border-gray-100 dark:border-slate-800">
        {selCount > 0 ? (
          <>
            <button onClick={() => move(-1)} disabled={!!busy} aria-label="Move earlier" className={btn}><Earlier size={17} /></button>
            <button onClick={() => move(1)} disabled={!!busy} aria-label="Move later" className={btn}><Later size={17} /></button>
            <button onClick={savePageImage} disabled={!singleStored || !!busy} aria-label="Save page as image" className={btn}><ImageIcon size={17} /></button>
            <div className="flex-1 text-center text-[11px] text-gray-400">{selCount} selected</div>
            <button onClick={removeSelected} disabled={!!busy} aria-label="Delete pages" className={`${btn} text-red-600`}><Trash2 size={17} /></button>
          </>
        ) : (
          <>
            <button onClick={addPages} disabled={!!busy} className="flex items-center gap-1.5 text-xs font-bold text-brand-700 px-3 py-2"><Plus size={15} /> Add pages</button>
            <div className="flex-1" />
            <button onClick={() => setCompressOpen(true)} disabled={!!busy || dirty} className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 px-3 py-2 disabled:opacity-40"><Minimize2 size={15} /> Compress</button>
          </>
        )}
      </div>

      {compressOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setCompressOpen(false)}>
          <div className="w-full max-w-sm mx-auto bg-white dark:bg-slate-900 rounded-t-3xl p-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100">Compress</div>
            <div className="text-[11px] text-gray-400 mb-3">Currently {QUALITY_LABEL[current.quality]}. Pages can only get smaller.</div>
            {(['small', 'normal', 'high'] as ScanQuality[]).map((q) => (
              <button key={q} onClick={() => compress(q)} disabled={!canCompressTo(current.quality, q)}
                className="w-full text-left px-3 py-3 rounded-xl text-sm font-semibold text-slate-800 dark:text-slate-200 active:bg-gray-100 dark:active:bg-slate-800 disabled:opacity-30">
                {QUALITY_LABEL[q]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
