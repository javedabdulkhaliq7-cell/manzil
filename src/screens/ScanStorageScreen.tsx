import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { ArrowLeft, Trash2 } from 'lucide-react'
import GreenHero from '../components/GreenHero'
import { useScanProfile } from '../lib/scanner/useScanProfile'
import { lastScanUser } from '../lib/scanner/scanUser'
import { scanDb, type ScanRow } from '../lib/scanner/scanDb'
import { deleteCopy } from '../lib/scanner/iqraDownloads'
import { getFreeSpaceBytes } from '../lib/scanner/nativeBridge'

// IQRA Scanner — S9 storage screen (route /scan/storage): total and per-subject space, with delete options.
const fmt = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

export default function ScanStorageScreen() {
  const navigate = useNavigate()
  const profile = useScanProfile()
  const userId = profile?.id ?? lastScanUser()
  const [scans, setScans] = useState<ScanRow[]>([])
  const [free, setFree] = useState<number | null>(null)
  useEffect(() => { getFreeSpaceBytes().then(setFree) }, [])

  const reload = useCallback(async () => {
    if (!userId) return
    setScans(await scanDb.scans.where('userId').equals(userId).toArray())
  }, [userId])
  useEffect(() => { reload() }, [reload])

  const total = useMemo(() => scans.reduce((n, s) => n + s.sizeBytes, 0), [scans])
  const bySubject = useMemo(() => {
    const m = new Map<string, { label: string; bytes: number; count: number }>()
    for (const s of scans) {
      const key = s.subjectId ?? '__other__'
      const cur = m.get(key) ?? { label: s.subjectLabel, bytes: 0, count: 0 }
      cur.bytes += s.sizeBytes
      cur.count += 1
      m.set(key, cur)
    }
    return [...m.values()].sort((a, b) => b.bytes - a.bytes)
  }, [scans])
  const biggest = useMemo(() => [...scans].sort((a, b) => b.sizeBytes - a.sizeBytes), [scans])

  async function removeScan(s: ScanRow) {
    if (!window.confirm(`Delete "${s.name}"? This can't be undone.`)) return
    await Filesystem.rmdir({ path: s.folderPath, directory: Directory.Data, recursive: true }).catch(() => {})
    await scanDb.scans.delete(s.id)
    reload()
  }

  async function removeCopy(s: ScanRow) {
    if (!window.confirm('Delete the copy from your phone storage? The scan stays in Iqra.')) return
    await deleteCopy(s)
    reload()
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      <GreenHero className="pb-5">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/scan')} aria-label="Back" className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center active:scale-95"><ArrowLeft size={18} /></button>
          <div>
            <div className="text-xl font-bold">Storage</div>
            <div className="text-xs text-brand-100">{scans.length} scan{scans.length === 1 ? '' : 's'} · {fmt(total)}{free !== null ? ` · ${fmt(free)} free on phone` : ''}</div>
          </div>
        </div>
      </GreenHero>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        <div className="text-[11px] text-sky-800 bg-sky-50 rounded-xl px-3 py-2">
          Scans are saved on this phone only. Uninstalling IQRA or resetting your phone will delete them. Copies saved to Downloads/Iqra stay on your phone for any PDF app.
        </div>

        {scans.length === 0 ? (
          <div className="text-center text-xs text-gray-400 dark:text-slate-500 py-10">No scans yet</div>
        ) : (
          <>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 flex flex-col gap-3">
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100">By subject</div>
              {bySubject.map((s) => (
                <div key={s.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span dir="auto" className="font-semibold text-slate-800 dark:text-slate-200">{s.label} <span className="text-gray-400">· {s.count}</span></span>
                    <span className="text-gray-500 dark:text-slate-400">{fmt(s.bytes)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-500 rounded-full" style={{ width: `${total ? (s.bytes / total) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 flex flex-col gap-3">
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100">Largest scans</div>
              {biggest.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div dir="auto" className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{s.name}</div>
                    <div className="text-[10px] text-gray-400">{s.pageCount} page{s.pageCount === 1 ? '' : 's'} · {fmt(s.sizeBytes)}</div>
                  </div>
                  {s.localCopyUri && (
                    <button onClick={() => removeCopy(s)} className="text-[10px] font-bold text-sky-700 bg-sky-50 rounded-full px-2.5 py-1">Delete copy</button>
                  )}
                  <button onClick={() => removeScan(s)} aria-label={`Delete ${s.name}`} className="w-8 h-8 flex items-center justify-center text-red-500"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
