// lib/connectivity.ts
// Small shared helper — same native-vs-web logic as OfflineBanner.tsx,
// pulled out so other screens (starting with ChapterDetailScreen) can ask
// "am I offline right now?" without duplicating the Capacitor/Network check.

import { Capacitor } from '@capacitor/core'
import { Network } from '@capacitor/network'

export async function isOffline(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    const status = await Network.getStatus()
    return !status.connected
  }
  return !navigator.onLine
}
