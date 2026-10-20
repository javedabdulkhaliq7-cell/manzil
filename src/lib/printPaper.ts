// Sends a finished PDF to the phone's print/share dialog (Android app) or opens it in a
// new tab (web). Works offline: the PDF is already on the device.
//
// In the Android app this uses two official Capacitor plugins, talked to by name so the
// web build never breaks if they are missing:
//   npm i @capacitor/filesystem @capacitor/share
//   npx cap sync android
// The PDF goes to the app's private cache folder (not Downloads or the gallery), then the
// phone's share sheet opens, where the student picks "Print" or a PDF viewer.

import { loadLogoBytes } from './logoStore'

type CapacitorGlobal = {
  isNativePlatform?: () => boolean
  isPluginAvailable?: (name: string) => boolean
  registerPlugin?: (name: string) => unknown
}

// Thrown when the Android app was built without the two plugins printing needs.
export const PRINT_PLUGINS_MISSING = 'PRINT_PLUGINS_MISSING'

type FilesystemPlugin = {
  writeFile: (o: { path: string; data: string; directory: string; recursive?: boolean }) => Promise<{ uri: string }>
}
type SharePlugin = {
  share: (o: { title?: string; text?: string; url?: string; dialogTitle?: string }) => Promise<unknown>
}

export type PrintOutcome = 'shared' | 'opened' | 'downloaded'

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-')
}

// The IQRA logo for the printout: the saved copy is used when there is no internet (see logoStore).
export async function loadLogo(): Promise<Uint8Array | null> {
  return loadLogoBytes('light')
}

export async function printPdf(bytes: Uint8Array, fileName: string): Promise<PrintOutcome> {
  const name = safeName(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`)
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor

  if (cap?.isNativePlatform?.() && cap.registerPlugin) {
    if (cap.isPluginAvailable && (!cap.isPluginAvailable('Filesystem') || !cap.isPluginAvailable('Share'))) {
      throw new Error(PRINT_PLUGINS_MISSING)
    }
    const fs = cap.registerPlugin('Filesystem') as FilesystemPlugin
    const share = cap.registerPlugin('Share') as SharePlugin
    const written = await fs.writeFile({ path: `print/${name}`, data: toBase64(bytes), directory: 'CACHE', recursive: true })
    await share.share({ title: 'Print paper', url: written.uri, dialogTitle: 'Print or save the paper' })
    return 'shared'
  }

  // Web: open the PDF in a new tab (the browser's PDF viewer has a Print button).
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }))
  const w = window.open(url, '_blank')
  if (w) {
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return 'opened'
  }
  // Pop-up blocked: fall back to a normal file download.
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'downloaded'
}
