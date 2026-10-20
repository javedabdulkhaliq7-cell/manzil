// The IQRA logo, kept available offline.
//
// The logo files live in the app's public folder (public/logo-full.png and public/logo-full-dark.png).
// Whenever the app can load them, a copy is also saved in the app's private on-device storage.
// With no internet, the saved copy is used, so the logo shows on screen and in printouts offline too.
import { kvGet, kvSet } from './offlineStore'

export type LogoVariant = 'light' | 'dark'

const PATH: Record<LogoVariant, string> = {
  light: '/logo-full.png', // green logo: light screens and every printout
  dark: '/logo-full-dark.png', // white lettering: dark-mode screens only
}

const key = (v: LogoVariant) => `logo:${v}`

function kindOf(b: Uint8Array | undefined): 'png' | 'jpg' | null {
  if (!b || b.length < 8) return null
  if (b[0] === 0x89 && b[1] === 0x50) return 'png'
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg'
  return null
}

// The logo image bytes, or null if there is none. A missing file or a wrong file type never breaks a screen:
// the dev server answers a missing file with a web page, so the bytes are checked to be a real image.
export async function loadLogoBytes(variant: LogoVariant): Promise<Uint8Array | null> {
  try {
    const res = await fetch(PATH[variant])
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (kindOf(bytes)) {
        void kvSet(key(variant), bytes) // keep a copy for when there is no internet
        return bytes
      }
    }
  } catch { /* offline or blocked: use the saved copy */ }
  const saved = await kvGet<Uint8Array>(key(variant))
  return kindOf(saved) ? (saved as Uint8Array) : null
}

// Save both logos now (called when the app is online), so they are there later offline.
export async function cacheLogos(): Promise<void> {
  await Promise.all([loadLogoBytes('light'), loadLogoBytes('dark')])
}

export function logoObjectUrl(bytes: Uint8Array): string {
  const type = kindOf(bytes) === 'jpg' ? 'image/jpeg' : 'image/png'
  return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }))
}
