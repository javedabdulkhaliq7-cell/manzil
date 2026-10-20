import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import BottomNav from '../components/BottomNav'
import GreenHero from '../components/GreenHero'
import {
  listDownloads, deleteItem, deleteAllDownloads, formatBytes, DownloadItem,
} from '../lib/downloadManager'
import { validityStatus, ValidityResult } from '../lib/offlineValidity'

type Confirm = null | { kind: 'one'; item: DownloadItem } | { kind: 'all' }

function when(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function DownloadedPapersScreen() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const uid = user?.id
  const [items, setItems] = useState<DownloadItem[]>([])
  const [validity, setValidity] = useState<ValidityResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirm, setConfirm] = useState<Confirm>(null)

  const load = useCallback(async () => {
    if (!uid) { setLoading(false); return }
    const [list, v] = await Promise.all([listDownloads(uid), validityStatus(uid)])
    setItems(list)
    setValidity(v)
    setLoading(false)
  }, [uid])

  useEffect(() => { void load() }, [load])

  const total = useMemo(() => items.reduce((s, i) => s + i.bytes, 0), [items])
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; items: DownloadItem[] }>()
    for (const it of items) {
      const g = m.get(it.subjectId) ?? { name: it.subjectName, items: [] }
      g.items.push(it)
      m.set(it.subjectId, g)
    }
    return Array.from(m.values())
  }, [items])

  async function doConfirm() {
    if (!uid || !confirm) return
    if (confirm.kind === 'one') await deleteItem(confirm.item)
    else await deleteAllDownloads(uid)
    setConfirm(null)
    await load()
  }

  const needsReconnect = items.length > 0 && validity && validity.status !== 'valid'

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      <GreenHero>
        <button onClick={() => navigate(-1)} className="text-brand-200 mb-2 flex items-center gap-1 text-xs">
          <ChevronLeft size={14} /> Back
        </button>
        <h1 className="text-xl font-black">Downloaded papers</h1>
        <p className="text-brand-100 text-xs">Saved on this phone · {formatBytes(total)}</p>
      </GreenHero>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {loading && (
          <div className="flex justify-center py-6" role="status" aria-label="Loading">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && items.length > 0 && validity && (
          <div
            role="status"
            className={`text-xs rounded-2xl px-4 py-3 ${needsReconnect
              ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200 font-semibold'
              : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
          >
            {needsReconnect
              ? 'Connect to the internet once to keep using your downloaded papers.'
              : `Valid until ${validity.expiresAtMs ? when(validity.expiresAtMs) : 'one year from your last online visit'}. Opening the app online renews this for another year.`}
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="text-center py-14 px-6">
            <div className="text-sm font-semibold text-gray-700 mb-1 dark:text-slate-300">Nothing downloaded yet</div>
            <div className="text-xs text-gray-400 max-w-[240px] mx-auto dark:text-slate-500">
              Open Past Papers and tap "Download all" on a subject, or Download on any paper.
            </div>
          </div>
        )}

        {groups.map(g => (
          <div key={g.name} className="flex flex-col gap-2">
            <div className="text-xs font-bold text-gray-500 dark:text-slate-400">{g.name}</div>
            {g.items.map(it => (
              <div key={it.key} className="bg-white rounded-2xl shadow-sm p-3 flex items-center gap-3 dark:bg-slate-800">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{it.title}</div>
                  <div className="text-xs text-gray-400 mt-0.5 dark:text-slate-500">
                    {formatBytes(it.bytes)} · {when(it.savedAt)}
                    {it.pendingSync ? ' · waiting to upload' : ''}
                  </div>
                </div>
                {it.pendingSync ? (
                  <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 flex-shrink-0">Kept until uploaded</span>
                ) : (
                  <button
                    aria-label={`Delete ${it.title}`}
                    onClick={() => setConfirm({ kind: 'one', item: it })}
                    className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600 flex items-center justify-center flex-shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}

        {!loading && items.some(i => !i.pendingSync) && (
          <button
            onClick={() => setConfirm({ kind: 'all' })}
            className="w-full text-sm font-bold rounded-2xl py-3 bg-white dark:bg-slate-800 text-red-600 shadow-sm mt-2"
          >
            Delete all downloads
          </button>
        )}
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6" role="dialog" aria-modal="true">
          <div className="w-full max-w-xs bg-white dark:bg-slate-900 rounded-2xl p-5">
            <div className="text-base font-black text-slate-900 dark:text-slate-100">
              {confirm.kind === 'one' ? 'Delete this download?' : 'Delete all downloads?'}
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-300 mt-1">
              {confirm.kind === 'one'
                ? 'You can download it again when you are online.'
                : 'Papers and question banks saved on this phone will be removed. Anything not uploaded yet is kept.'}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirm(null)} className="flex-1 text-sm font-bold rounded-xl py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">Keep</button>
              <button onClick={doConfirm} className="flex-1 text-sm font-bold rounded-xl py-2.5 bg-red-600 text-white">Delete</button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  )
}
