import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { downloadPaper, paperLocalState, formatBytes, lastDownloadReason, PaperLocalState } from '../lib/downloadManager'
import type { PaperKind } from '../lib/paperSource'
import { isQuotaError, lastStorageError, BUILD_TAG } from '../lib/offlineStore'

type Props = {
  kind: PaperKind
  paperId: string
  // The server's version of this paper, when it was just loaded online. null when opened from a saved copy.
  serverVersion: number | null
}

// Download / Downloading / Downloaded (with size) / Update available
export default function PaperDownloadButton({ kind, paperId, serverVersion }: Props) {
  const { user } = useAuth()
  const uid = user?.id
  const [local, setLocal] = useState<PaperLocalState>({ state: 'none', bytes: 0 })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const refresh = useCallback(async () => {
    if (!uid) return
    setLocal(await paperLocalState(uid, kind, paperId, serverVersion))
  }, [uid, kind, paperId, serverVersion])

  useEffect(() => { void refresh() }, [refresh])

  async function onClick() {
    if (!uid || busy) return
    if (local.state === 'saved') return
    setBusy(true)
    setMsg('')
    const out = await downloadPaper(uid, kind, paperId)
    if (out === 'offline') setMsg('Connect to the internet to download.')
    else if (out === 'storage') setMsg(isQuotaError()
      ? `The browser's storage for this app is full (${lastStorageError()}) [${BUILD_TAG}]`
      : `Could not save on this device (${lastStorageError()}) [${BUILD_TAG}]`)
    else if (out !== 'ok') setMsg(`Could not download (${lastDownloadReason()}) [${BUILD_TAG}]`)
    await refresh()
    setBusy(false)
  }

  const label = busy ? 'Downloading…'
    : local.state === 'saved' ? `Downloaded · ${formatBytes(local.bytes)}`
    : local.state === 'update' ? 'Update available'
    : 'Download'

  return (
    <div>
      <button
        onClick={onClick}
        disabled={!uid || busy || local.state === 'saved'}
        className={`w-full text-xs font-bold py-2 rounded-xl disabled:opacity-100 ${
          local.state === 'saved' ? 'bg-white/10 text-white' : 'bg-white/20 text-white'
        }`}
      >
        {local.state === 'saved' && !busy ? '✓ ' : ''}{label}
      </button>
      {msg && <div role="alert" className="mt-1 text-[11px] font-semibold text-white">{msg}</div>}
    </div>
  )
}
