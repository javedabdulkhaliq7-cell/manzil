// The notes of ONE topic ("topic bundle"), in the order set by the plan (section 5.4):
// narrative blocks -> (figure cards sit inline where a figure block references them) ->
// key definitions -> comparison tables -> misconception cards.
// Every text field goes through FractionText so math, units and [[hr|…]] / [[hy|…]] highlights work.
import { ImageOff, Lightbulb, AlertCircle, CheckCircle } from 'lucide-react'
import FractionText from '../FractionText'
import DiagramRenderer from '../DiagramRenderer'
import type {
  SeniorNoteBlock,
  DefinitionRow,
  MisconceptionRow,
  DifferentiationRow,
  FigureRow,
} from '../../lib/seniorNotesApi'

const card = 'bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800'
const heading = 'text-xs font-bold text-slate-900 mb-3 dark:text-slate-100'
const body = 'text-[13px] text-gray-700 leading-relaxed dark:text-slate-300'

/* --------------------------------------------------------------------- figures */

function FigureCard({ figure }: { figure: FigureRow | undefined }) {
  if (!figure) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 dark:border-slate-600 dark:bg-slate-900/50">
        <ImageOff size={16} className="text-gray-400 flex-shrink-0 mt-0.5 dark:text-slate-500" />
        <div className="text-xs text-gray-500 dark:text-slate-400">Figure coming soon.</div>
      </div>
    )
  }
  return (
    <figure className="flex flex-col gap-2">
      {figure.image_url ? (
        <img src={figure.image_url} alt={figure.caption ?? 'Figure'} loading="lazy" className="w-full h-auto rounded-xl border border-gray-100 dark:border-slate-700" />
      ) : figure.diagram_type && figure.diagram_data ? (
        <DiagramRenderer diagramType={figure.diagram_type} diagramData={figure.diagram_data} caption={undefined} />
      ) : (
        <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 dark:border-slate-600 dark:bg-slate-900/50">
          <ImageOff size={16} className="text-gray-400 flex-shrink-0 mt-0.5 dark:text-slate-500" />
          <div className="text-xs text-gray-500 dark:text-slate-400">Picture coming soon.</div>
        </div>
      )}
      {(figure.figure_no || figure.caption) && (
        <figcaption className="text-xs text-gray-600 dark:text-slate-300 leading-relaxed">
          {figure.figure_no && <span className="font-bold">{figure.figure_no}. </span>}
          {figure.caption && <FractionText text={figure.caption} />}
        </figcaption>
      )}
      {figure.notice && (
        <div className="rounded-xl bg-brand-50 dark:bg-brand-950/30 border border-brand-100 dark:border-brand-800 p-2.5 text-xs text-brand-800 dark:text-brand-200 leading-relaxed">
          <span className="font-bold">What to notice: </span>
          <FractionText text={figure.notice} />
        </div>
      )}
    </figure>
  )
}

/* ---------------------------------------------------------------- note blocks */

function NoteBlock({ block, figures }: { block: SeniorNoteBlock; figures: FigureRow[] }) {
  const title = block.title ? <div className={heading}><FractionText text={block.title} /></div> : null

  switch (block.type) {
    case 'paragraph':
      return (
        <div className={card}>
          {title}
          <p className={body}><FractionText text={String(block.text ?? '')} /></p>
        </div>
      )

    case 'key_fact':
      return (
        <div className="rounded-2xl border-l-4 border-brand-500 bg-brand-50 p-4 dark:bg-brand-950/30 dark:border-brand-400 flex items-start gap-2.5">
          <Lightbulb size={16} className="text-brand-600 dark:text-brand-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-[13px] font-medium text-brand-900 leading-relaxed dark:text-brand-100"><FractionText text={String(block.text ?? '')} /></p>
        </div>
      )

    case 'bullets':
      return (
        <div className={card}>
          {title}
          <div className="flex flex-col gap-1.5">
            {(block.items ?? []).map((item: string, j: number) => (
              <div key={j} className="flex items-start gap-2">
                <span className="text-brand-500 text-xs flex-shrink-0 mt-0.5">→</span>
                <span className={body}><FractionText text={item} /></span>
              </div>
            ))}
          </div>
        </div>
      )

    case 'table':
      return (
        <div className={card}>
          {title}
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-700">
                  {(block.columns ?? []).map((col: any, k: number) => (
                    <th key={k} className="text-left font-bold text-gray-500 px-1.5 py-1.5 align-top dark:text-slate-400">
                      {typeof col === 'string' ? <FractionText text={col} /> : JSON.stringify(col)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(block.rows ?? []).map((row: string[], r: number) => (
                  <tr key={r} className="border-b border-gray-50 last:border-0 dark:border-slate-700/50">
                    {row.map((cell: string, c: number) => (
                      <td key={c} className="text-gray-700 px-1.5 py-1.5 align-top dark:text-slate-300"><FractionText text={cell} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )

    case 'figure':
      return (
        <div className={card}>
          {title}
          <FigureCard figure={figures.find((f) => f.id === block.figure_id)} />
        </div>
      )

    case 'diagram':
      return (
        <div className={card}>
          {title}
          <DiagramRenderer diagramType={block.diagram_type} diagramData={block.diagram_data} caption={block.caption} />
        </div>
      )

    case 'timeline':
      return (
        <div className={card}>
          {title}
          <ol className="relative border-s-2 border-brand-200 dark:border-brand-800 ps-4 flex flex-col gap-3">
            {(block.items ?? []).map((item: { date: string; event: string }, t: number) => (
              <li key={t} className="relative">
                <span className="absolute -start-[21px] top-0.5 w-3 h-3 rounded-full bg-brand-500 ring-4 ring-white dark:ring-slate-800" />
                <div className="text-[10px] font-bold text-brand-600 dark:text-brand-400"><FractionText text={item.date} /></div>
                <div className={body}><FractionText text={item.event} /></div>
              </li>
            ))}
          </ol>
        </div>
      )

    case 'image_needed':
      if (!block.needed) return null
      return (
        <div className={card}>
          <FigureCard figure={undefined} />
        </div>
      )

    default:
      return null // unknown block type: skip it rather than show garbage
  }
}

/* ------------------------------------------------------------ comparison table */

type CompareRow = { aspect: string; cells: string[] }

/** The Skill stores a comparison's rows in `points`. Be tolerant about the exact shape:
 *  [{aspect, values:[…]}], [{aspect, <entity>: text, …}], [[aspect, v1, v2]] or {aspect: [v1, v2]}. */
function normalizePoints(points: unknown, entities: string[]): CompareRow[] {
  const text = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
  if (Array.isArray(points)) {
    return points.map((p): CompareRow => {
      if (Array.isArray(p)) return { aspect: text(p[0]), cells: p.slice(1).map(text) }
      if (p && typeof p === 'object') {
        const o = p as Record<string, unknown>
        const aspect = text(o.aspect ?? o.point ?? o.basis ?? o.feature ?? o.criterion ?? o.title ?? '')
        const list = o.values ?? o.cells ?? o.entries
        if (Array.isArray(list)) return { aspect, cells: list.map(text) }
        const byEntity = entities.map((e) => o[e] ?? o[e.toLowerCase()])
        if (byEntity.some((v) => v !== undefined)) return { aspect, cells: byEntity.map(text) }
        const letters = ['a', 'b', 'c'].slice(0, entities.length).map((k) => o[k])
        return { aspect, cells: letters.map(text) }
      }
      return { aspect: '', cells: [text(p)] }
    })
  }
  if (points && typeof points === 'object') {
    return Object.entries(points as Record<string, unknown>).map(([aspect, v]) => ({
      aspect,
      cells: Array.isArray(v) ? v.map(text) : [text(v)],
    }))
  }
  return []
}

function ComparisonCard({ row }: { row: DifferentiationRow }) {
  const entities = row.entities ?? []
  const rows = normalizePoints(row.points, entities)
  if (entities.length === 0 || rows.length === 0) return null
  return (
    <div className={card}>
      <div className={heading}>
        <FractionText text={row.title ?? `Differences between ${entities.join(' and ')}`} />
      </div>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full min-w-[320px] text-[11px] border-collapse">
          <thead>
            <tr className="border-b border-gray-200 dark:border-slate-700">
              <th className="text-left font-bold text-gray-500 px-1.5 py-1.5 align-top dark:text-slate-400">Point</th>
              {entities.map((e, i) => (
                <th key={i} className="text-left font-bold text-brand-700 px-1.5 py-1.5 align-top dark:text-brand-400"><FractionText text={e} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-gray-50 last:border-0 dark:border-slate-700/50">
                <td className="font-semibold text-slate-800 px-1.5 py-1.5 align-top dark:text-slate-100"><FractionText text={r.aspect} /></td>
                {entities.map((_, k) => (
                  <td key={k} className="text-gray-700 px-1.5 py-1.5 align-top dark:text-slate-300"><FractionText text={r.cells[k] ?? ''} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- the topic */

type Props = {
  blocks: SeniorNoteBlock[]
  definitions: DefinitionRow[]
  differentiations: DifferentiationRow[]
  misconceptions: MisconceptionRow[]
  figures: FigureRow[]
}

export default function TopicBody({ blocks, definitions, differentiations, misconceptions, figures }: Props) {
  const empty = blocks.length === 0 && definitions.length === 0 && differentiations.length === 0 && misconceptions.length === 0
  if (empty) {
    return <div className="text-xs text-gray-400 dark:text-slate-500 py-2">Notes for this topic are being prepared.</div>
  }
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((b, i) => (
        <NoteBlock key={i} block={b} figures={figures} />
      ))}

      {definitions.length > 0 && (
        <div className={card}>
          <div className={heading}>Key definitions</div>
          <div className="flex flex-col gap-3">
            {definitions.map((d) => (
              <div key={d.id}>
                <span className="inline-block bg-brand-50 text-brand-700 text-[11px] font-bold px-2 py-0.5 rounded-full dark:bg-brand-950/40 dark:text-brand-400"><FractionText text={d.term} /></span>
                <p className={`${body} mt-1`}><FractionText text={d.definition} /></p>
                {d.clarification && <p className="text-[11px] italic text-gray-500 dark:text-slate-400 mt-0.5"><FractionText text={d.clarification} /></p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {differentiations.map((d) => (
        <ComparisonCard key={d.id} row={d} />
      ))}

      {misconceptions.map((m) => (
        <div key={m.id} className={card}>
          <div className="flex items-start gap-2 mb-2">
            <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <div className="text-[10px] font-bold uppercase text-red-600 dark:text-red-400">Common mistake</div>
              <p className={body}><FractionText text={m.misconception} /></p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <div className="text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-400">Correct idea</div>
              <p className={body}><FractionText text={m.correction} /></p>
              {m.why && <p className="text-[11px] italic text-gray-500 dark:text-slate-400 mt-1"><FractionText text={m.why} /></p>}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
