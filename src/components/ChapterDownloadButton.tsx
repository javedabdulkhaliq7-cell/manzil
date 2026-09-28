// components/ChapterDownloadButton.tsx
// Phase 3.3 — Download/Remove button + per-subject "X/2 downloaded" counter
// (Free plan). Used in two places with two different color styles:
// ChapterDetailScreen's dark brand-gradient header ('header', the default)
// and ChaptersScreen's plain white/slate list rows ('card').

import { useEffect, useState } from 'react'
import { Download, Trash2, Check } from 'lucide-react'
import {
  downloadChapter,
  removeDownloadedChapter,
  isChapterDownloaded,
  downloadedCountForSubject,
  canDownloadMore,
} from '../lib/downloadChapter'
import { FREE_DOWNLOADS_PER_SUBJECT } from '../lib/constants'

type Props = {
  chapterId: string
  subjectId: string
  isPremium: boolean
  userId: string
  variant?: 'header' | 'card'
}

export default function ChapterDownloadButton({
  chapterId,
  subjectId,
  isPremium,
  userId,
  variant = 'header',
}: Props) {
  const [downloaded, setDownloaded] = useState(false)
  const [count, setCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  const isCard = variant === 'card'
  const mainBtnClass = isCard
    ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800'
    : 'bg-white/20 text-white'
  const counterClass = isCard ? 'text-gray-400 dark:text-slate-500' : 'text-brand-100'
  const removeBtnClass = isCard
    ? 'bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800'
    : 'bg-red-500 text-white'
  const cancelBtnClass = isCard ? 'text-gray-400 dark:text-slate-500' : 'text-white/70'
  const errorBoxClass = isCard
    ? 'text-red-600 bg-red-50 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800'
    : 'text-white bg-red-500/90'

  async function refresh() {
    const [isDown, c] = await Promise.all([
      isChapterDownloaded(chapterId),
      downloadedCountForSubject(subjectId),
    ])
    setDownloaded(isDown)
    setCount(c)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, subjectId])

  async function handleDownload() {
    setError('')
    const allowed = await canDownloadMore(subjectId, isPremium)
    if (!allowed) {
      setError(
        `You've reached the ${FREE_DOWNLOADS_PER_SUBJECT}-chapter download limit for this subject on the Free plan. Remove a downloaded chapter first, or upgrade to Premium for unlimited downloads.`
      )
      return
    }
    setBusy(true)
    try {
      await downloadChapter(chapterId, userId)
      await refresh()
    } catch (err: any) {
      setError(err?.message || 'Download failed — check your connection and try again')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    setBusy(true)
    try {
      await removeDownloadedChapter(chapterId)
      await refresh()
    } finally {
      setBusy(false)
      setConfirmingRemove(false)
    }
  }

  if (downloaded) {
    return (
      <div className="flex flex-col items-end gap-1">
        {!confirmingRemove ? (
          <button
            onClick={() => setConfirmingRemove(true)}
            disabled={busy}
            className={`flex items-center gap-1.5 ${mainBtnClass} text-[10px] font-semibold px-2.5 py-1.5 rounded-full active:scale-95 transition-all disabled:opacity-60 whitespace-nowrap`}
          >
            <Check size={11} /> Downloaded
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleRemove}
              disabled={busy}
              className={`flex items-center gap-1 ${removeBtnClass} text-[10px] font-semibold px-2.5 py-1.5 rounded-full active:scale-95 transition-all disabled:opacity-60 whitespace-nowrap`}
            >
              <Trash2 size={11} /> {busy ? 'Removing…' : 'Remove?'}
            </button>
            <button
              onClick={() => setConfirmingRemove(false)}
              disabled={busy}
              className={`${cancelBtnClass} text-[10px] font-semibold px-2 py-1.5 whitespace-nowrap`}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleDownload}
        disabled={busy}
        className={`flex items-center gap-1.5 ${mainBtnClass} text-[10px] font-semibold px-2.5 py-1.5 rounded-full active:scale-95 transition-all disabled:opacity-60 whitespace-nowrap`}
      >
        <Download size={11} /> {busy ? 'Downloading…' : 'Download'}
      </button>
      {!isPremium && (
        <span className={`text-[9px] ${counterClass} whitespace-nowrap`}>
          {count}/{FREE_DOWNLOADS_PER_SUBJECT} downloaded
        </span>
      )}
      {error && (
        <span className={`text-[9px] ${errorBoxClass} rounded-lg px-2 py-1.5 max-w-[170px] text-right leading-snug`}>
          {error}
        </span>
      )}
    </div>
  )
}
