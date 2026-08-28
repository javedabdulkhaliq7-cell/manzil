// DiagramRenderer — the single reusable "artist" for every structured diagram
// in the app. It reads a diagram_type + diagram_data payload (stored on a
// question row, or embedded as a block inside chapters.detailed_notes) and
// draws it as SVG. No images are uploaded or stored — the picture is built
// fresh from data every time, so styling stays consistent across every
// subject and every future class level.
//
// Supported diagram_type values today:
//   - 'labeled'          a single diagram: base shapes + pointer-line labels.
//                          Shape primitives: rect, line (optional dash:true
//                          for construction/guide lines vs. solid final
//                          edges), circle, fill, arc (angle markers, or any
//                          generic center+radius+angle-range arc such as a
//                          compass swing mark), arrow (vectors/bearings/forces)
//   - 'labeled_sequence'  multiple 'labeled' diagrams shown as ordered stages
//   - 'venn2' / 'venn3'   set-region Venn diagrams (2 or 3 circles)
//   - 'number_line'       inequality solution sets: open/closed points,
//                          shaded rays to infinity, shaded bounded segments
//   - 'bar_chart'         histogram bars (supports unequal class widths,
//                          each bar has its own x0/x1 so proportional-height
//                          histograms just come from the data) and/or a
//                          frequency-polygon overlay (connected points).
//                          Axis ticks/labels are drawn directly, not via
//                          the pointer-line Label type, since a histogram
//                          needs many small axis labels that shouldn't each
//                          get a dashed leader line.
//
// Anything else (e.g. 'graph_2d', 'circuit' — planned but not built yet)
// falls through to a plain placeholder instead of crashing, so call-sites
// are safe to wire up ahead of the renderer supporting them.

type Point = [number, number]

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
  dash?: boolean // true draws a dashed construction/guide line (compass rays,
                  // perpendicular-bisector extensions, etc.) instead of solid
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

interface ShapeArc {
  kind: 'arc'
  cx: number
  cy: number
  r: number
  start_angle: number // degrees, 0° = due right, clockwise positive
  end_angle: number
  style?: string
}

interface ShapeArrow {
  kind: 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number // arrowhead points here
  style?: string
}

type Shape = ShapeRect | ShapeLine | ShapeCircle | ShapeFill | ShapeArc | ShapeArrow

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

// Set-region data, not raw shapes — geometry is fixed by the renderer,
// recipes only supply which elements go in which region.
interface VennData {
  sets: string[]
  universal_label?: string
  regions: Record<string, string[]>
}

// Number-line data — for inequality solution sets. Points mark boundary
// values (open = hollow circle, e.g. x<8; closed = filled circle, e.g.
// x<=8). Rays shade from a point out to infinity in one direction; segments
// shade a bounded range between two values (e.g. 2<=x<=4). A recipe can mix
// any combination of points/rays/segments needed for the actual solution.
interface NumberLinePoint {
  value: number
  open: boolean
  label?: string
}

interface NumberLineRay {
  from: number
  direction: 'left' | 'right'
}

interface NumberLineSegment {
  from: number
  to: number
}

interface NumberLineData {
  min: number
  max: number
  step?: number
  points: NumberLinePoint[]
  rays?: NumberLineRay[]
  segments?: NumberLineSegment[]
}

// Bar-chart data — for histograms and frequency polygons. A histogram bar
// carries its own x0/x1 (class boundaries), so unequal class widths just
// fall out of the data naturally — a recipe supplies the actual boundary
// values and the (possibly already proportional-height-adjusted) height to
// plot, no special-casing needed in the renderer. polygon_points draws a
// frequency-polygon overlay on top of the bars, or standalone (bars
// omitted) for a plain frequency-polygon-only diagram.
interface BarChartBar {
  x0: number
  x1: number
  height: number
  label?: string // shown centered under the bar, e.g. a class interval
}

interface BarChartPoint {
  x: number
  y: number
  label?: string
}

interface BarChartData {
  x_min: number
  x_max: number
  y_max?: number // optional; auto-computed with headroom if omitted
  bars?: BarChartBar[]
  polygon_points?: BarChartPoint[]
  x_axis_label?: string
  y_axis_label?: string
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
      return <line key={i} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} stroke={s.stroke} strokeWidth={s.strokeWidth} strokeDasharray={shape.dash ? '5,4' : undefined} />
    case 'circle':
      return <circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} stroke={s.stroke} fill={s.fill} strokeWidth={s.strokeWidth} />
    case 'fill': {
      const x = Math.min(shape.x1, shape.x2)
      const y = Math.min(shape.y1, shape.y2)
      const w = Math.abs(shape.x2 - shape.x1)
      const h = Math.abs(shape.y2 - shape.y1)
      return <rect key={i} x={x} y={y} width={w} height={h} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
    }
    case 'arc': {
      // 0° = due right, clockwise positive (matches screen/compass-style angles)
      const toRad = (deg: number) => (deg * Math.PI) / 180
      const x1 = shape.cx + shape.r * Math.cos(toRad(shape.start_angle))
      const y1 = shape.cy + shape.r * Math.sin(toRad(shape.start_angle))
      const x2 = shape.cx + shape.r * Math.cos(toRad(shape.end_angle))
      const y2 = shape.cy + shape.r * Math.sin(toRad(shape.end_angle))
      const diff = ((shape.end_angle - shape.start_angle) % 360 + 360) % 360
      const largeArc = diff > 180 ? 1 : 0
      return (
        <path
          key={i}
          d={`M ${x1} ${y1} A ${shape.r} ${shape.r} 0 ${largeArc} 1 ${x2} ${y2}`}
          fill="none"
          stroke={s.stroke === 'none' ? '#475569' : s.stroke}
          strokeWidth={s.strokeWidth}
        />
      )
    }
    case 'arrow': {
      const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1)
      const headLen = 9
      const headAngle = Math.PI / 7
      const hx1 = shape.x2 - headLen * Math.cos(angle - headAngle)
      const hy1 = shape.y2 - headLen * Math.sin(angle - headAngle)
      const hx2 = shape.x2 - headLen * Math.cos(angle + headAngle)
      const hy2 = shape.y2 - headLen * Math.sin(angle + headAngle)
      const arrowColor = s.stroke === 'none' ? '#475569' : s.stroke
      return (
        <g key={i}>
          <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} stroke={arrowColor} strokeWidth={s.strokeWidth} />
          <polygon points={`${shape.x2},${shape.y2} ${hx1},${hy1} ${hx2},${hy2}`} fill={arrowColor} />
        </g>
      )
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

// Splits a region's element list into short lines that fit inside a circle
// region without a full layout engine — good enough for the handful of
// items (numbers, short set elements) these diagrams actually contain.
function wrapRegionText(items: string[], maxCharsPerLine = 12): string[] {
  const joined = items.join(', ')
  if (joined.length <= maxCharsPerLine) return [joined]
  const lines: string[] = []
  let current = ''
  for (const item of items) {
    const candidate = current ? `${current}, ${item}` : item
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current)
      current = item
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}

function renderRegionText(pos: Point, items: string[] | undefined, i: string) {
  if (!items || items.length === 0) return null
  const lines = wrapRegionText(items)
  const [x, y] = pos
  const startY = y - ((lines.length - 1) * 12) / 2
  return (
    <text key={i} x={x} y={startY} textAnchor="middle" fontSize={11} fill="#334155">
      {lines.map((line, li) => (
        <tspan key={li} x={x} dy={li === 0 ? 0 : 12}>{line}</tspan>
      ))}
    </text>
  )
}

// Fixed geometry — every venn2/venn3 diagram uses the same circle layout,
// only the content placed in each region changes between recipes.
const VENN2_GEOMETRY = {
  canvas: { width: 380, height: 280 },
  circleA: { cx: 150, cy: 140, r: 95 },
  circleB: { cx: 250, cy: 140, r: 95 },
  setLabelA: [95, 55] as Point,
  setLabelB: [305, 55] as Point,
  regionPos: {
    A_only: [110, 140] as Point,
    B_only: [290, 140] as Point,
    A_and_B: [200, 140] as Point,
    outside_all: [40, 250] as Point,
  },
}

const VENN3_GEOMETRY = {
  canvas: { width: 420, height: 340 },
  circleA: { cx: 175, cy: 140, r: 110 },
  circleB: { cx: 255, cy: 140, r: 110 },
  circleC: { cx: 215, cy: 215, r: 110 },
  setLabelA: [90, 55] as Point,
  setLabelB: [340, 55] as Point,
  setLabelC: [215, 310] as Point,
  regionPos: {
    A_only: [125, 105] as Point,
    B_only: [305, 105] as Point,
    C_only: [215, 285] as Point,
    A_and_B: [215, 105] as Point,
    A_and_C: [150, 205] as Point,
    B_and_C: [280, 205] as Point,
    A_and_B_and_C: [215, 175] as Point,
    outside_all: [40, 40] as Point,
  },
}

function VennDiagram({ data, variant, caption }: { data: VennData; variant: 'venn2' | 'venn3'; caption?: string }) {
  if (!data?.regions) {
    return <DiagramPlaceholder reason="Diagram data is incomplete." />
  }
  const geo = variant === 'venn2' ? VENN2_GEOMETRY : VENN3_GEOMETRY
  const [labelA, labelB, labelC] = data.sets ?? ['A', 'B', 'C']
  const circleStyle = { stroke: '#0f766e', fill: 'none', strokeWidth: 1.5 }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 dark:bg-slate-800 dark:border-slate-700">
      <svg viewBox={`0 0 ${geo.canvas.width} ${geo.canvas.height}`} className="w-full h-auto">
        <rect x={15} y={15} width={geo.canvas.width - 30} height={geo.canvas.height - 30} fill="none" stroke="#94a3b8" strokeWidth={1.5} />
        <text x={28} y={30} fontSize={12} fontWeight={700} fill="#475569">{data.universal_label ?? 'U'}</text>

        <circle cx={geo.circleA.cx} cy={geo.circleA.cy} r={geo.circleA.r} {...circleStyle} />
        <circle cx={geo.circleB.cx} cy={geo.circleB.cy} r={geo.circleB.r} {...circleStyle} />
        {variant === 'venn3' && (
          <circle cx={(geo as typeof VENN3_GEOMETRY).circleC.cx} cy={(geo as typeof VENN3_GEOMETRY).circleC.cy} r={(geo as typeof VENN3_GEOMETRY).circleC.r} {...circleStyle} />
        )}

        <text x={geo.setLabelA[0]} y={geo.setLabelA[1]} fontSize={13} fontWeight={700} fill="#0f766e">{labelA}</text>
        <text x={geo.setLabelB[0]} y={geo.setLabelB[1]} fontSize={13} fontWeight={700} fill="#0f766e">{labelB}</text>
        {variant === 'venn3' && (
          <text x={(geo as typeof VENN3_GEOMETRY).setLabelC[0]} y={(geo as typeof VENN3_GEOMETRY).setLabelC[1]} fontSize={13} fontWeight={700} fill="#0f766e">{labelC}</text>
        )}

        {Object.entries(geo.regionPos).map(([key, pos]) => renderRegionText(pos, data.regions[key], key))}
      </svg>
      {caption && (
        <div className="text-[10px] text-gray-400 text-center mt-1.5 dark:text-slate-500">{caption}</div>
      )}
    </div>
  )
}

// Fixed geometry — same "consistent canvas, data-driven content" approach
// as the Venn geometry above.
const NUMBER_LINE_GEOMETRY = {
  canvas: { width: 340, height: 90 },
  axisY: 45,
  padding: 30,
}

function nlX(value: number, min: number, max: number) {
  const { width } = NUMBER_LINE_GEOMETRY.canvas
  const nlPadding = NUMBER_LINE_GEOMETRY.padding
  const usable = width - nlPadding * 2
  if (max === min) return nlPadding + usable / 2
  return nlPadding + ((value - min) / (max - min)) * usable
}

function NumberLine({ data, caption }: { data: NumberLineData; caption?: string }) {
  if (!data || typeof data.min !== 'number' || typeof data.max !== 'number' || !data.points?.length) {
    return <DiagramPlaceholder reason="Diagram data is incomplete." />
  }
  const { min, max, points } = data
  const step = data.step ?? 1
  const { width, height } = NUMBER_LINE_GEOMETRY.canvas
  const nlPadding = NUMBER_LINE_GEOMETRY.padding
  const axisY = NUMBER_LINE_GEOMETRY.axisY
  const axisColor = '#94a3b8'
  const highlight = STYLES.highlight.stroke // teal, matches Venn outline

  const ticks: number[] = []
  for (let v = min; v <= max + 1e-9; v += step) {
    ticks.push(Math.round(v * 1000) / 1000)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 dark:bg-slate-800 dark:border-slate-700">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        {/* base axis, arrowheads both ends signal it continues indefinitely */}
        <line x1={nlPadding - 8} y1={axisY} x2={width - nlPadding + 8} y2={axisY} stroke={axisColor} strokeWidth={1.5} />
        <polygon points={`${nlPadding - 8},${axisY} ${nlPadding},${axisY - 4} ${nlPadding},${axisY + 4}`} fill={axisColor} />
        <polygon points={`${width - nlPadding + 8},${axisY} ${width - nlPadding},${axisY - 4} ${width - nlPadding},${axisY + 4}`} fill={axisColor} />

        {/* bounded shaded segments (e.g. 2<=x<=4) */}
        {data.segments?.map((seg, i) => (
          <line key={`seg-${i}`} x1={nlX(seg.from, min, max)} y1={axisY} x2={nlX(seg.to, min, max)} y2={axisY} stroke={highlight} strokeWidth={3} />
        ))}

        {/* rays shaded out to infinity (e.g. x<8, x>80) */}
        {data.rays?.map((ray, i) => {
          const x = nlX(ray.from, min, max)
          const endX = ray.direction === 'left' ? nlPadding - 8 : width - nlPadding + 8
          return <line key={`ray-${i}`} x1={x} y1={axisY} x2={endX} y2={axisY} stroke={highlight} strokeWidth={3} />
        })}

        {/* tick marks + value labels */}
        {ticks.map((v, i) => (
          <g key={`tick-${i}`}>
            <line x1={nlX(v, min, max)} y1={axisY - 4} x2={nlX(v, min, max)} y2={axisY + 4} stroke={axisColor} strokeWidth={1} />
            <text x={nlX(v, min, max)} y={axisY + 18} textAnchor="middle" fontSize={9} fill="#64748b">{v}</text>
          </g>
        ))}

        {/* boundary points: hollow = open (strict), filled = closed (<=/>=) */}
        {points.map((p, i) => (
          <g key={`pt-${i}`}>
            <circle cx={nlX(p.value, min, max)} cy={axisY} r={5} fill={p.open ? '#ffffff' : highlight} stroke={highlight} strokeWidth={2} />
            {p.label && (
              <text x={nlX(p.value, min, max)} y={axisY - 12} textAnchor="middle" fontSize={10} fontWeight={600} fill={highlight}>{p.label}</text>
            )}
          </g>
        ))}
      </svg>
      {caption && (
        <div className="text-[10px] text-gray-400 text-center mt-1.5 dark:text-slate-500">{caption}</div>
      )}
    </div>
  )
}

// Fixed geometry — same "consistent canvas, data-driven content" approach
// used by the other diagram types. Taller than NUMBER_LINE_GEOMETRY since
// this needs room for a y-axis and its tick labels too.
const BAR_CHART_GEOMETRY = {
  canvas: { width: 340, height: 240 },
  padding: { left: 38, right: 14, top: 14, bottom: 40 },
}

function bcX(value: number, data: BarChartData) {
  const { canvas, padding } = BAR_CHART_GEOMETRY
  const plotWidth = canvas.width - padding.left - padding.right
  if (data.x_max === data.x_min) return padding.left + plotWidth / 2
  return padding.left + ((value - data.x_min) / (data.x_max - data.x_min)) * plotWidth
}

function bcY(value: number, yMax: number) {
  const { canvas, padding } = BAR_CHART_GEOMETRY
  const plotHeight = canvas.height - padding.top - padding.bottom
  if (yMax === 0) return canvas.height - padding.bottom
  return padding.top + plotHeight - (value / yMax) * plotHeight
}

// Picks a "nice" tick step (1/2/5/10 x a power of ten) so the y-axis gets
// roughly 5 readable ticks instead of raw fractional frequency values.
function niceYTicks(yMax: number): number[] {
  if (yMax <= 0) return [0]
  const roughStep = yMax / 5
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)))
  const residual = roughStep / magnitude
  let step: number
  if (residual > 5) step = 10 * magnitude
  else if (residual > 2) step = 5 * magnitude
  else if (residual > 1) step = 2 * magnitude
  else step = magnitude
  const ticks: number[] = []
  for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000)
  return ticks
}

function BarChart({ data, caption }: { data: BarChartData; caption?: string }) {
  const hasContent = (data?.bars?.length ?? 0) > 0 || (data?.polygon_points?.length ?? 0) > 0
  if (!data || typeof data.x_min !== 'number' || typeof data.x_max !== 'number' || !hasContent) {
    return <DiagramPlaceholder reason="Diagram data is incomplete." />
  }
  const { canvas, padding } = BAR_CHART_GEOMETRY
  const barHeights = data.bars?.map((b) => b.height) ?? []
  const pointHeights = data.polygon_points?.map((p) => p.y) ?? []
  const maxVal = Math.max(0, ...barHeights, ...pointHeights)
  const yMax = data.y_max ?? (maxVal === 0 ? 1 : maxVal * 1.15)
  const yTicks = niceYTicks(yMax)
  const axisColor = '#94a3b8'
  const barFill = STYLES.highlight.fill
  const barStroke = STYLES.highlight.stroke
  const polyColor = STYLES.outline.stroke
  const baselineY = bcY(0, yMax)
  const plotRight = canvas.width - padding.right
  const yAxisTitleY = padding.top + (canvas.height - padding.top - padding.bottom) / 2

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 dark:bg-slate-800 dark:border-slate-700">
      <svg viewBox={`0 0 ${canvas.width} ${canvas.height}`} className="w-full h-auto">
        {/* y-axis ticks + labels, drawn directly (no pointer-line leaders — there'd be too many) */}
        {yTicks.map((t, i) => (
          <g key={`yt-${i}`}>
            <line x1={padding.left - 4} y1={bcY(t, yMax)} x2={padding.left} y2={bcY(t, yMax)} stroke={axisColor} strokeWidth={1} />
            <text x={padding.left - 7} y={bcY(t, yMax)} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="#64748b">{t}</text>
          </g>
        ))}

        {/* axes */}
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={baselineY} stroke={axisColor} strokeWidth={1.5} />
        <line x1={padding.left} y1={baselineY} x2={plotRight} y2={baselineY} stroke={axisColor} strokeWidth={1.5} />

        {/* histogram bars — each carries its own x0/x1, so unequal class widths just work */}
        {data.bars?.map((bar, i) => {
          const x = bcX(bar.x0, data)
          const w = Math.max(0, bcX(bar.x1, data) - x)
          const y = bcY(bar.height, yMax)
          const h = Math.max(0, baselineY - y)
          return (
            <g key={`bar-${i}`}>
              <rect x={x} y={y} width={w} height={h} fill={barFill} stroke={barStroke} strokeWidth={1.5} />
              {bar.label && (
                <text x={x + w / 2} y={baselineY + 13} textAnchor="middle" fontSize={8.5} fill="#64748b">{bar.label}</text>
              )}
            </g>
          )
        })}

        {/* frequency-polygon overlay (or standalone, if bars is omitted) */}
        {data.polygon_points && data.polygon_points.length > 0 && (
          <polyline
            points={data.polygon_points.map((p) => `${bcX(p.x, data)},${bcY(p.y, yMax)}`).join(' ')}
            fill="none"
            stroke={polyColor}
            strokeWidth={2}
          />
        )}
        {data.polygon_points?.map((p, i) => (
          <g key={`pt-${i}`}>
            <circle cx={bcX(p.x, data)} cy={bcY(p.y, yMax)} r={3} fill={polyColor} />
            {p.label && (
              <text x={bcX(p.x, data)} y={bcY(p.y, yMax) - 7} textAnchor="middle" fontSize={8.5} fontWeight={600} fill={polyColor}>{p.label}</text>
            )}
          </g>
        ))}

        {/* axis titles */}
        {data.x_axis_label && (
          <text x={padding.left + (plotRight - padding.left) / 2} y={canvas.height - 3} textAnchor="middle" fontSize={9} fontWeight={600} fill="#475569">
            {data.x_axis_label}
          </text>
        )}
        {data.y_axis_label && (
          <text
            x={11}
            y={yAxisTitleY}
            textAnchor="middle"
            fontSize={9}
            fontWeight={600}
            fill="#475569"
            transform={`rotate(-90, 11, ${yAxisTitleY})`}
          >
            {data.y_axis_label}
          </text>
        )}
      </svg>
      {caption && (
        <div className="text-[10px] text-gray-400 text-center mt-1.5 dark:text-slate-500">{caption}</div>
      )}
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
    case 'venn2':
      return <VennDiagram data={diagramData as VennData} variant="venn2" caption={caption} />
    case 'venn3':
      return <VennDiagram data={diagramData as VennData} variant="venn3" caption={caption} />
    case 'number_line':
      return <NumberLine data={diagramData as NumberLineData} caption={caption} />
    case 'bar_chart':
      return <BarChart data={diagramData as BarChartData} caption={caption} />
    default:
      // Recipe references a diagram_type the renderer doesn't support yet
      // (e.g. graph_2d/circuit, planned but not built). Fails safely.
      return <DiagramPlaceholder reason={`Diagram type "${diagramType}" isn't supported yet.`} />
  }
}
