// IQRA Scanner — footer band stamping + image helpers (plan section 7).
// Put this file at src/lib/scanner/stampPage.ts
import { Capacitor } from '@capacitor/core'
import type { ScanQuality } from './scanDb'
import { enhanceImageData, type ScanMode } from './enhancePage'

export const QUALITY_SETTINGS: Record<ScanQuality, { maxWidth: number; jpeg: number }> = {
  small:  { maxWidth: 1200, jpeg: 0.6 },
  normal: { maxWidth: 1600, jpeg: 0.75 },
  high:   { maxWidth: 2400, jpeg: 0.85 }, // shown as "Clear" in the app
}

// The band is a fixed fraction of page width so it looks the same at every
// quality level. S10 (OCR) uses this to exclude the band from text reading.
export const FOOTER_BAND_RATIO = 0.055
export const IQRA_GREEN = '#059669'
// Bundled logo: put your transparent PNG at public/iqra-logo.png
const LOGO_URL = '/iqra-logo.png'

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read page image'))
    img.src = src
  })
}

let logoPromise: Promise<HTMLImageElement | null> | null = null
function getLogo(): Promise<HTMLImageElement | null> {
  if (!logoPromise) logoPromise = loadImage(LOGO_URL).catch(() => null) // text-only band if logo is missing
  return logoPromise
}

function canvasToBase64(c: HTMLCanvasElement, quality: number): string {
  return c.toDataURL('image/jpeg', quality).split(',')[1]
}

/**
 * Takes a page from the scanner (file:// URI), scales it to the quality's max
 * width, and adds the Iqra footer band BELOW the content (extends the page,
 * never covers it). Returns base64 JPEG (no data: prefix) plus final size.
 */
export async function stampPage(
  uri: string,
  quality: ScanQuality,
  mode: ScanMode = 'text'
): Promise<{ base64: string; width: number; height: number }> {
  const { maxWidth, jpeg } = QUALITY_SETTINGS[quality]
  const img = await loadImage(Capacitor.convertFileSrc(uri))
  const scale = Math.min(1, maxWidth / img.naturalWidth)
  const w = Math.round(img.naturalWidth * scale)
  const h = Math.round(img.naturalHeight * scale)
  const band = Math.round(w * FOOTER_BAND_RATIO)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h + band
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)

  // One pass: clean up the page content now, before the footer is added, then encode the JPEG once.
  const pixels = ctx.getImageData(0, 0, w, h)
  enhanceImageData(pixels.data, w, h, mode)
  ctx.putImageData(pixels, 0, 0)

  // Thin green rule + centred logo and "Scanned with Iqra".
  ctx.fillStyle = IQRA_GREEN
  ctx.fillRect(0, h, w, Math.max(1, Math.round(band * 0.04)))

  const logo = await getLogo()
  const fontPx = Math.round(band * 0.45)
  ctx.font = `700 ${fontPx}px system-ui, -apple-system, Roboto, sans-serif`
  ctx.textBaseline = 'middle'
  ctx.fillStyle = IQRA_GREEN
  const label = 'Scanned with Iqra'
  const textW = ctx.measureText(label).width
  const logoH = Math.round(band * 0.7)
  const logoW = logo ? Math.round(logoH * (logo.naturalWidth / logo.naturalHeight)) : 0
  const gap = logo ? Math.round(band * 0.2) : 0
  const startX = Math.round((w - (logoW + gap + textW)) / 2)
  const cy = h + band / 2
  if (logo) ctx.drawImage(logo, startX, Math.round(cy - logoH / 2), logoW, logoH)
  ctx.fillText(label, startX + logoW + gap, cy)

  return { base64: canvasToBase64(canvas, jpeg), width: canvas.width, height: canvas.height }
}

/** Re-encodes an already-stamped page (no second band) at a new size/quality. */
export async function recompressPage(
  base64Jpeg: string,
  quality: ScanQuality
): Promise<{ base64: string; width: number; height: number }> {
  const { maxWidth, jpeg } = QUALITY_SETTINGS[quality]
  const img = await loadImage(`data:image/jpeg;base64,${base64Jpeg}`)
  const scale = Math.min(1, maxWidth / img.naturalWidth)
  const w = Math.round(img.naturalWidth * scale)
  const h = Math.round(img.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
  return { base64: canvasToBase64(canvas, jpeg), width: w, height: h }
}

export async function makeThumbnail(base64Jpeg: string, targetWidth = 320): Promise<string> {
  const img = await loadImage(`data:image/jpeg;base64,${base64Jpeg}`)
  const scale = Math.min(1, targetWidth / img.naturalWidth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvasToBase64(canvas, 0.7)
}
