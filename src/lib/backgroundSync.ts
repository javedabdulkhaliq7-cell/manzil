// lib/backgroundSync.ts
//
// Phase 8 — BEST-EFFORT background sync via Android WorkManager
// (@capgo/capacitor-background-task). Reuses the exact same sync engine as
// foreground sync (runPendingSync), so there is no second code path that
// could disagree with it.
//
// Honesty about limits (spec Section 7): Android may delay or skip this —
// 15-minute minimum interval, Doze mode, and aggressive battery optimizers
// on some brands (Xiaomi/Oppo/Vivo) can all stop it. NOTHING in the app's
// correctness depends on this firing: SyncStatusBanner still syncs whenever
// the app is opened, and that remains the primary path.

import { Capacitor } from '@capacitor/core'
import { BackgroundTask, BackgroundTaskResult } from '@capgo/capacitor-background-task'
import { supabase } from './supabase'
import { runPendingSync } from './syncEngine'

const SYNC_TASK = 'iqra-offline-sync'

// Must be defined at module scope so it exists when Android wakes the app
// for a background run.
if (Capacitor.isNativePlatform()) {
  BackgroundTask.defineTask(SYNC_TASK, async () => {
    try {
      const { data } = await supabase.auth.getSession()
      const userId = data.session?.user?.id
      if (!userId) return BackgroundTaskResult.Success // logged out — nothing to sync
      await runPendingSync(userId)
      return BackgroundTaskResult.Success
    } catch {
      return BackgroundTaskResult.Failed
    }
  })
}

/** Registers the periodic job (persists across restarts; safe to call every launch). */
export async function registerBackgroundSync(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const already = await BackgroundTask.isTaskRegisteredAsync(SYNC_TASK)
    if (already) return
    await BackgroundTask.registerTaskAsync(SYNC_TASK, {
      minimumInterval: 15, // Android's minimum for periodic work
      requiresNetwork: true,
    })
  } catch (err) {
    // Never let a background-scheduling problem affect the app itself.
    console.warn('Background sync registration failed (non-fatal):', err)
  }
}
