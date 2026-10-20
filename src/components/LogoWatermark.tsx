import { useEffect, useState } from 'react'
import { loadLogoBytes, logoObjectUrl } from '../lib/logoStore'

// A faint IQRA logo behind the paper (about 10% opacity, centred, kept in view while scrolling).
// Put it as the first child of a `relative` box inside the scrolling area. Works offline.
// Green logo on a light screen, white logo in dark mode. If no logo is available it shows nothing.
export default function LogoWatermark() {
  const [urls, setUrls] = useState<{ light: string | null; dark: string | null }>({ light: null, dark: null })

  useEffect(() => {
    let cancelled = false
    const made: string[] = []
    async function load() {
      const out: { light: string | null; dark: string | null } = { light: null, dark: null }
      for (const v of ['light', 'dark'] as const) {
        const bytes = await loadLogoBytes(v)
        if (bytes) {
          const url = logoObjectUrl(bytes)
          made.push(url)
          out[v] = url
        }
      }
      if (!cancelled) setUrls(out)
    }
    void load()
    return () => {
      cancelled = true
      made.forEach(u => URL.revokeObjectURL(u))
    }
  }, [])

  if (!urls.light && !urls.dark) return null
  return (
    <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
      <div className="sticky top-[35vh] flex justify-center">
        {urls.light && (
          <img src={urls.light} alt="" className="w-3/5 max-w-[260px] opacity-10 select-none dark:hidden" draggable={false} />
        )}
        {urls.dark && (
          <img src={urls.dark} alt="" className="hidden dark:block w-3/5 max-w-[260px] opacity-10 select-none" draggable={false} />
        )}
      </div>
    </div>
  )
}
