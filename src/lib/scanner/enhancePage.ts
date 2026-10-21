// IQRA Scanner — page clean-up for clearer text (Fix 3).
// Pure pixel maths, no DOM, so it can be tested outside the phone.
//
// 'text'   : grayscale -> flatten background / remove shadows -> stretch contrast -> mild sharpen
// 'colour' : keeps colours, only a very light sharpen (for diagrams and photos)
export type ScanMode = 'text' | 'colour'

const BLOCK = 8 // background is estimated on a copy 1/8 the size

function boxBlurH(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      out[row + x] = sum / (2 * r + 1)
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  return out
}
function boxBlurV(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const out = new Float32Array(src.length)
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = -r; y <= r; y++) sum += src[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (2 * r + 1)
      sum += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x]
    }
  }
  return out
}
function blur(src: Float32Array, w: number, h: number, r: number, passes = 2) {
  let a = src
  for (let i = 0; i < passes; i++) a = boxBlurV(boxBlurH(a, w, h, r), w, h, r)
  return a
}

/** Paper brightness at every pixel, with ink removed (block max -> small grow -> smooth). */
function estimateBackground(gray: Uint8ClampedArray, w: number, h: number): { bg: Float32Array; sw: number; sh: number } {
  const sw = Math.ceil(w / BLOCK), sh = Math.ceil(h / BLOCK)
  let small = new Float32Array(sw * sh)
  for (let by = 0; by < sh; by++) {
    for (let bx = 0; bx < sw; bx++) {
      let m = 0
      const y1 = Math.min(h, (by + 1) * BLOCK), x1 = Math.min(w, (bx + 1) * BLOCK)
      for (let y = by * BLOCK; y < y1; y++) for (let x = bx * BLOCK; x < x1; x++) { const v = gray[y * w + x]; if (v > m) m = v }
      small[by * sw + bx] = m
    }
  }
  // grow once so thick headings/ink blobs do not drag the paper estimate down
  const grown = new Float32Array(small.length)
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let m = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = Math.min(sh - 1, Math.max(0, y + dy)), xx = Math.min(sw - 1, Math.max(0, x + dx))
      const v = small[yy * sw + xx]; if (v > m) m = v
    }
    grown[y * sw + x] = m
  }
  return { bg: blur(grown, sw, sh, 3, 2), sw, sh }
}

function sharpenGray(g: Uint8ClampedArray, w: number, h: number, amount: number) {
  const copy = Uint8ClampedArray.from(g)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x
    const b = (copy[i - w - 1] + copy[i - w] + copy[i - w + 1] + copy[i - 1] + copy[i] + copy[i + 1] + copy[i + w - 1] + copy[i + w] + copy[i + w + 1]) / 9
    g[i] = copy[i] + amount * (copy[i] - b)
  }
}

export function enhanceImageData(px: Uint8ClampedArray, w: number, h: number, mode: ScanMode): void {
  if (mode === 'colour') {
    // very light sharpen on each colour channel
    const copy = Uint8ClampedArray.from(px)
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        const k = i + c, s = w * 4
        const b = (copy[k - s - 4] + copy[k - s] + copy[k - s + 4] + copy[k - 4] + copy[k] + copy[k + 4] + copy[k + s - 4] + copy[k + s] + copy[k + s + 4]) / 9
        px[k] = copy[k] + 0.3 * (copy[k] - b)
      }
    }
    return
  }

  // 1. grayscale
  const n = w * h
  const gray = new Uint8ClampedArray(n)
  for (let i = 0, p = 0; i < n; i++, p += 4) gray[i] = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2]

  // 2. flatten background: divide by the estimated paper brightness
  const { bg, sw, sh } = estimateBackground(gray, w, h)
  const hist = new Uint32Array(256)
  for (let y = 0; y < h; y++) {
    // bilinear lookup into the small background map
    const fy = Math.min(sh - 1.001, Math.max(0, (y + 0.5) / BLOCK - 0.5)), y0 = Math.floor(fy), ty = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1.001, Math.max(0, (x + 0.5) / BLOCK - 0.5)), x0 = Math.floor(fx), tx = fx - x0
      const b = (bg[y0 * sw + x0] * (1 - tx) + bg[y0 * sw + x0 + 1] * tx) * (1 - ty) +
                (bg[(y0 + 1) * sw + x0] * (1 - tx) + bg[(y0 + 1) * sw + x0 + 1] * tx) * ty
      const i = y * w + x
      const v = Math.min(255, (gray[i] * 255) / Math.max(40, b))
      gray[i] = v
      hist[v | 0]++
    }
  }

  // 3. stretch contrast: darkest 0.5% -> black, paper level -> white
  const at = (frac: number) => { let acc = 0; const t = n * frac; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= t) return v } return 255 }
  const black = Math.min(at(0.005), 120)
  const white = Math.max(at(0.6), 170)
  const span = Math.max(40, white - black)
  for (let i = 0; i < n; i++) gray[i] = ((gray[i] - black) * 255) / span

  // 4. mild sharpen (small amount so letters get no halos)
  sharpenGray(gray, w, h, 0.7)

  for (let i = 0, p = 0; i < n; i++, p += 4) { px[p] = px[p + 1] = px[p + 2] = gray[i]; px[p + 3] = 255 }
}
