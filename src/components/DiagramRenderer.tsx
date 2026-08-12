// DiagramRenderer — the single reusable "artist" for every structured diagram
// in the app. It reads a diagram_type + diagram_data payload (stored on a
// question row, or embedded as a block inside chapters.detailed_notes) and
// draws it as SVG. No images are uploaded or stored — the picture is built
// fresh from data every time, so styling stays consistent across every
// subject and every future class level.
//
// Supported diagram_type values today:
//   - 'labeled'          a single diagram: base shapes + pointer-line labels
//   - 'labeled_sequence'  multiple 'labeled' diagrams shown as ordered stages
//
// Anything else (e.g. 'venn2', 'venn3', 'graph_2d', 'circuit' — planned but
// not built yet) falls through to a plain placeholder instead of crashing,
// so call-sites are safe to wire up ahead of the renderer supporting them.

interface Point {
  0: number
  1: number
}

interface ShapeRect {
  kind: 'rect'
  x: number
  y: number
  w: number
  h: number
  style?: string
}

interface ShapeLine {
  kind: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
  style?: string
}

interface ShapeCircle {
  kind: 'circle'
  cx: number
  cy: number
  r: number
  style?: string
}

interface ShapeFill {
  kind: 'fill'
  x1: number
  y1: number
  x2: number
  y2: number
  style?: string
}

type Shape = ShapeRect | ShapeLine | ShapeCircle | ShapeFill

interface Label {
  text: string
  point: Point
  text_pos: Point
}

interface LabeledCanvas {
  width: number
  height: number
}

interface LabeledDiagramData {
  canvas: LabeledCanvas
  shapes: Shape[]
  labels: Label[]
}

interface LabeledSequenceData {
  stages: (LabeledDiagramData & { caption?: string })[]
}

interface Props {
  diagramType?: string | null
  diagramData?: any
  caption?: string
}

// Named styles keep every diagram visually consistent instead of picking
// colors per-recipe. Add new names here as new recipes need them — unknown
// style names fall back to a sensible default rather than erroring.
const STYLES: Record<string, { stroke: string; fill: string; strokeWidth: number }> = {
  default:  { stroke: '#475569', fill: 'none',    strokeWidth: 1.5 },
  bulb:     { stroke: '#475569', fill: '#f1f5f9', strokeWidth: 1.5 },
  tube:     { stroke: '#334155', fill: 'none',    strokeWidth: 1.5 },
  mercury:  { stroke: 'none',    fill: '#ef4444', strokeWidth: 0 },
  outline:  { stroke: '#0f766e', fill: 'none',    strokeWidth: 2 },
  highlight:{ stroke: '#0f766e', fill: '#ccfbf1', strokeWidth: 1.5 },
}

function styleFor(name?: string) {
  return STYLES[name ?? 'default'] ?? STYLES.default
}

function renderShape(shape: Shape, i: number) {
  const s = styleFor(shape.style)
  switch (shape.kind) {
    case 'rect':
      return <rect key={i} x={shape.x} y={shape.y} width={shape.w} height={shape.h} stroke={s.stroke} fill={s.fill} strokeWidth={s.strokeWidth} rx={3} />
    case 'line':
      return <line key={i} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} stroke={s.stroke} strokeWidth={s.strokeWidth} />
    case 'circle':
      return <circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} stroke={s.stroke} fill={s.fill} strokeWidth={s.strokeWidth} />
    case 'fill': {
      const x = Math.min(shape.x1, shape.x2)
      const y = Math.min(shape.y1, shape.y2)
      const w = Math.abs(shape.x2 - shape.x1)
      const h = Math.abs(shape.y2 - shape.y1)
      return <rect key={i} x={x} y={y} width={w} height={h} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
    }
    default:
      return null
  }
}

function renderLabel(label: Label, i: number) {
  const [px, py] = label.point
  const [tx, ty] = label.text_pos
  const anchor = tx >= px ? 'start' : 'end'
  return (
    <g key={i}>
      <line x1={px} y1={py} x2={tx} y2={ty} stroke="#94a3b8" strokeWidth={1} strokeDasharray="2,2" />
      <circle cx={px} cy={py} r={2.5} fill="#0f766e" />
      <text x={tx} y={ty} textAnchor={anchor} dominantBaseline="middle" fontSize={11} fill="#334155" fontWeight={600}>
        {label.text}
      </text>
    </g>
  )
}

function LabeledDiagram({ data, caption }: { data: LabeledDiagramData; caption?: string }) {
  if (!data?.canvas) {
    return <DiagramPlaceholder reason="Diagram data is incomplete." />
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 dark:bg-slate-800 dark:border-slate-700">
      <svg viewBox={`0 0 ${data.canvas.width} ${data.canvas.height}`} className="w-full h-auto">
        {data.shapes?.map(renderShape)}
        {data.labels?.map(renderLabel)}
      </svg>
      {caption && (
        <div className="text-[10px] text-gray-400 text-center mt-1.5 dark:text-slate-500">{caption}</div>
      )}
    </div>
  )
}

function LabeledSequence({ data }: { data: LabeledSequenceData }) {
  if (!data?.stages?.length) {
    return <DiagramPlaceholder reason="Diagram data is incomplete." />
  }
  return (
    <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
      {data.stages.map((stage, i) => (
        <div key={i} className="flex-shrink-0 w-[70vw] max-w-[280px]">
          <LabeledDiagram data={stage} caption={stage.caption} />
        </div>
      ))}
    </div>
  )
}

function DiagramPlaceholder({ reason }: { reason: string }) {
  return (
    <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-4 text-center dark:bg-slate-900 dark:border-slate-700">
      <div className="text-xl mb-1">📐</div>
      <div className="text-[11px] text-gray-400 dark:text-slate-500">{reason}</div>
    </div>
  )
}

export default function DiagramRenderer({ diagramType, diagramData, caption }: Props) {
  if (!diagramType || !diagramData) return null

  switch (diagramType) {
    case 'labeled':
      return <LabeledDiagram data={diagramData as LabeledDiagramData} caption={caption} />
    case 'labeled_sequence':
      return <LabeledSequence data={diagramData as LabeledSequenceData} />
    default:
      // Recipe references a diagram_type the renderer doesn't support yet
      // (e.g. venn2/venn3/graph_2d, planned but not built). Fails safely.
      return <DiagramPlaceholder reason={`Diagram type "${diagramType}" isn't supported yet.`} />
  }
}
