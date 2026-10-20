// IQRA Scanner — the one place the custom Android plugin is registered.
// Put this file at src/lib/scanner/nativeBridge.ts
import { Capacitor, registerPlugin } from '@capacitor/core'

export interface IqraNative {
  savePdf(opts: { sourcePath: string; fileName: string }): Promise<{ uri: string; folder: string }>
  exists(opts: { uri: string }): Promise<{ exists: boolean }>
  deleteCopy(opts: { uri: string }): Promise<{ deleted: boolean }>
  freeSpace(): Promise<{ bytes: number }>
  openSettings(): Promise<void>
  hasPlayServices(): Promise<{ available: boolean }>
}
export const Native = registerPlugin<IqraNative>('IqraDownloads')

/** Free bytes on the phone, or null if it can't be read (web, or an old build). */
export async function getFreeSpaceBytes(): Promise<number | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const { bytes } = await Native.freeSpace()
    return bytes >= 0 ? bytes : null
  } catch { return null }
}

export async function openAppSettings(): Promise<void> {
  try { await Native.openSettings() } catch { /* ignore */ }
}
