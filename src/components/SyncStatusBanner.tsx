// components/SyncStatusBanner.tsx
// Phase 5.4 — small persistent indicator, shown the whole time the
// pending_sync queue is non-empty (even before a connection comes back),
// so a sync happening silently later never looks like "my score
// disappeared." Also the thing that actually triggers a sync attempt —
// on mount (app opened/foregrounded) and every 30s while mounted.

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { offlineDb } from '../lib/offlineDb'
import { useAuth } from '../contexts/AuthContext'
import { runPendingSync } from '../lib/syncEngine'
import { isOffline } from '../lib/connectivity'

export default function SyncStatusBanner() {
  const { user } = useAuth()
  const [count, setCount] = useState(0)

  async function refreshCount() {
    setCount(await offlineDb.pending_sync.count())
  }

  useEffect(() => {
    refreshCount()
    const interval = setInterval(refreshCount, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false

    async function trySync() {
      if (await isOffline()) return
      await runPendingSync(user!.id)
      if (!cancelled) await refreshCount()
    }

    trySync() // on mount — covers "app opened/foregrounded with a connection"
    const interval = setInterval(trySync, 30000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [user])

  if (count === 0) return null

  return (
    <div className="fixed top-[34px] left-0 right-0 max-w-sm mx-auto bg-amber-500 text-white text-xs font-semibold flex items-center justify-center gap-2 py-2 px-4 z-40">
      <RefreshCw size={13} className="animate-spin" style={{ animationDuration: '2s' }} />
      {count} result{count === 1 ? '' : 's'} waiting to sync
    </div>
  )
}
