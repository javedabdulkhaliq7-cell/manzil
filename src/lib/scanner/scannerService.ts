// IQRA Scanner — S1: thin wrapper around the ML Kit Document Scanner plugin.
// Put this file at src/lib/scanner/scannerService.ts
import { Capacitor } from '@capacitor/core'
import { DocumentScanner } from '@capacitor-mlkit/document-scanner'
import { Native } from './nativeBridge'

export type ScannerModuleStatus =
  | 'unsupported'   // website, or not an Android app
  | 'noPlayServices' // Android phone without Google Play Services: the Google scanner can't run
  | 'checking'
  | 'ready'
  | 'downloading'
  | 'failed'

// Plan: "no hard limit" — highest value the plugin allows. The plugin's
// default is 10 and its docs don't state a maximum, so S1 tests this number
// on a real phone. Lower it here if the scanner rejects it.
export const SCAN_PAGE_LIMIT = 100

// Plan: soft warning (never a block) at about 50 pages.
export const SOFT_WARN_PAGES = 50

export function scannerSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

/**
 * Makes sure Google's scanner module is on the phone (plan section 15A).
 * Call while online (after login / on first Scan open). Safe to call again:
 * returns 'ready' immediately if the module is already installed.
 * onProgress fires with 0-100 while downloading.
 */
export async function ensureScannerModule(
  onProgress?: (percent: number) => void
): Promise<ScannerModuleStatus> {
  if (!scannerSupported()) return 'unsupported'
  try {
    const ps = await Native.hasPlayServices().catch(() => ({ available: true })) // unknown = try anyway
    if (!ps.available) return 'noPlayServices'
    const { available } = await DocumentScanner.isGoogleDocumentScannerModuleAvailable()
    if (available) return 'ready'

    return await new Promise<ScannerModuleStatus>(async (resolve) => {
      const handle = await DocumentScanner.addListener(
        'googleDocumentScannerModuleInstallProgress',
        (event) => {
          onProgress?.(event.progress ?? 0)
          // Install states: 4 = COMPLETED, 3 = CANCELED, 5 = FAILED
          if (event.state === 4) { handle.remove(); resolve('ready') }
          else if (event.state === 3 || event.state === 5) { handle.remove(); resolve('failed') }
        }
      )
      try {
        await DocumentScanner.installGoogleDocumentScannerModule()
      } catch {
        handle.remove()
        resolve('failed')
      }
    })
  } catch {
    return 'failed'
  }
}

export type ScanOutcome =
  | { kind: 'pages'; uris: string[] }   // file:// URIs of JPEG pages in the scanner's temp cache
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string; permission?: boolean }

/**
 * Opens Google's scanner. Returns JPEG page URIs only (we build the PDF
 * ourselves in S2, after stamping the Iqra footer band on each page).
 * The URIs point at temporary cache: S2 must copy them out immediately.
 */
export async function scanPages(): Promise<ScanOutcome> {
  try {
    const result = await DocumentScanner.scanDocument({
      galleryImportAllowed: true,
      pageLimit: SCAN_PAGE_LIMIT,
      resultFormats: 'JPEG',
      scannerMode: 'FULL',
    })
    const uris = result.scannedImages ?? []
    if (uris.length === 0) return { kind: 'cancelled' }
    return { kind: 'pages', uris }
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? '')
    if (/permission|denied/i.test(msg)) {
      return { kind: 'error', message: 'Camera access is needed to scan.', permission: true }
    }
    if (/unsupported/i.test(msg)) {
      return { kind: 'error', message: "Scanner isn't supported on this phone" }
    }
    // Closing Google's screen rejects the promise; treat as "student cancelled".
    if (/cancel|closed|back|dismiss/i.test(msg) || msg === '') return { kind: 'cancelled' }
    return { kind: 'error', message: msg }
  }
}

/** Turns a file:// URI from the scanner into something an <img> can show. */
export function previewSrc(uri: string): string {
  return Capacitor.convertFileSrc(uri)
}
