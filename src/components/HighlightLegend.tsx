// HighlightLegend.tsx
//
// Strip shown at the top of a chapter's Notes. Explains the two highlight
// styles and lets the student switch to "Most important only" — which fades
// everything except the red phrases (see .hl-focus-red in index.css).
//
// USAGE (in the Notes tab):
//   const [hlMode, setHlMode] = useState<HighlightMode>('all')
//   <HighlightLegend mode={hlMode} onChange={setHlMode} />
//   <div className={highlightFocusClass(hlMode)}> ...note body text only... </div>

export type HighlightMode = 'all' | 'red'

export function highlightFocusClass(mode: HighlightMode): string {
  return mode === 'red' ? 'hl-focus-red' : ''
}

export default function HighlightLegend({
  mode,
  onChange,
}: {
  mode: HighlightMode
  onChange: (m: HighlightMode) => void
}) {
  const btn = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all active:scale-95 ${
      active
        ? 'bg-brand-600 text-white border-brand-600'
        : 'bg-white text-gray-500 border-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-600'
    }`

  return (
    <div className="bg-white rounded-2xl shadow-sm p-3 dark:bg-slate-800">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-gray-600 dark:text-slate-300">
        <span className="font-bold text-slate-900 dark:text-slate-100">How to read</span>
        <span><mark className="hl-red">Red underline</mark> = most important</span>
        <span><mark className="hl-yellow">Yellow</mark> = good to know</span>
      </div>
      <div className="flex gap-2 mt-2.5" role="group" aria-label="Highlight filter">
        <button type="button" aria-pressed={mode === 'all'} onClick={() => onChange('all')} className={btn(mode === 'all')}>
          All highlights
        </button>
        <button type="button" aria-pressed={mode === 'red'} onClick={() => onChange('red')} className={btn(mode === 'red')}>
          Most important only
        </button>
      </div>
    </div>
  )
}
