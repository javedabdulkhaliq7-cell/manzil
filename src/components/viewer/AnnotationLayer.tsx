// IQRA Scanner — S6 drawing layer over one page.
// Put this file at src/components/viewer/AnnotationLayer.tsx
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { BASE_WIDTH, strokeHit, type Stroke, type Tool } from '../../lib/scanner/annotations'

interface Props {
  strokes: Stroke[]
  aspect: number                       // page height / width
  tool: Tool
  color: string
  widthMul: number
  onCommitStroke: (s: Stroke) => void
  onEraseStrokes: (ids: string[]) => void
}

const pointsAttr = (pts: [number, number][], aspect: number) =>
  (pts.length === 1 ? [pts[0], [pts[0][0] + 0.0001, pts[0][1]] as [number, number]] : pts)
    .map(([x, y]) => `${x},${y * aspect}`).join(' ')

export default function AnnotationLayer({ strokes, aspect, tool, color, widthMul, onCommitStroke, onEraseStrokes }: Props) {
  const ref = useRef<SVGSVGElement>(null)
  const pointer = useRef<number | null>(null)
  const [draft, setDraft] = useState<[number, number][] | null>(null)
  const erasedRef = useRef<Set<string>>(new Set())
  const [erased, setErased] = useState<Set<string>>(new Set())
  const active = tool !== 'none'

  const pos = (e: ReactPointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]
  }

  function eraseAt([x, y]: [number, number]) {
    let changed = false
    for (const s of strokes) {
      if (!erasedRef.current.has(s.id) && strokeHit(s, x, y, aspect)) { erasedRef.current.add(s.id); changed = true }
    }
    if (changed) setErased(new Set(erasedRef.current))
  }

  function onDown(e: ReactPointerEvent) {
    if (!active || pointer.current !== null) return
    pointer.current = e.pointerId
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const p = pos(e)
    if (tool === 'eraser') { erasedRef.current = new Set(); setErased(new Set()); eraseAt(p) }
    else setDraft([p])
  }

  function onMove(e: ReactPointerEvent) {
    if (pointer.current !== e.pointerId) return
    const p = pos(e)
    if (tool === 'eraser') { eraseAt(p); return }
    setDraft((d) => {
      if (!d) return d
      const last = d[d.length - 1]
      if (Math.hypot(p[0] - last[0], (p[1] - last[1]) * aspect) < 0.002) return d // thin out near-duplicate points
      return [...d, p]
    })
  }

  function onUp(e: ReactPointerEvent) {
    if (pointer.current !== e.pointerId) return
    pointer.current = null
    if (tool === 'eraser') {
      const ids = [...erasedRef.current]
      erasedRef.current = new Set()
      setErased(new Set())
      if (ids.length) onEraseStrokes(ids)
      return
    }
    if (draft && draft.length > 0 && (tool === 'highlighter' || tool === 'pen')) {
      onCommitStroke({
        id: crypto.randomUUID(), tool, color,
        width: BASE_WIDTH[tool] * widthMul,
        points: draft,
      })
    }
    setDraft(null)
  }

  const styleFor = (t: 'highlighter' | 'pen', c: string, w: number) => ({
    stroke: c,
    strokeWidth: w,
    strokeOpacity: t === 'highlighter' ? 0.45 : 1,
    mixBlendMode: t === 'highlighter' ? ('multiply' as const) : ('normal' as const),
  })

  return (
    <svg
      ref={ref}
      viewBox={`0 0 1 ${aspect}`}
      preserveAspectRatio="none"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: active ? 'auto' : 'none', touchAction: active ? 'none' : 'auto' }}
    >
      {strokes.filter((s) => !erased.has(s.id)).map((s) => (
        <polyline key={s.id} points={pointsAttr(s.points, aspect)} fill="none" strokeLinecap="round" strokeLinejoin="round" style={styleFor(s.tool, s.color, s.width)} />
      ))}
      {draft && (tool === 'highlighter' || tool === 'pen') && (
        <polyline points={pointsAttr(draft, aspect)} fill="none" strokeLinecap="round" strokeLinejoin="round" style={styleFor(tool, color, BASE_WIDTH[tool] * widthMul)} />
      )}
    </svg>
  )
}
