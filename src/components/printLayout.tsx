// printLayout.tsx
//
// Shared visual chrome for A4 printable test papers — extracted from
// MockTestPrintView.tsx so ExerciseTestPrintView.tsx (and anything else
// printable added later) uses the EXACT same header/section/CSS, not a
// lookalike copy that can drift out of sync over time.
//
// Nothing here changes behavior — PaperHeader and Section are pixel-for-
// pixel what MockTestPrintView.tsx already had, just relocated.

export function PrintStyles() {
  return (
    <style>{`
      @media print {
        @page { size: A4; margin: 10mm 9mm; }
        .no-print { display: none !important; }
        body { background: white !important; }
        .print-page { box-shadow: none !important; margin: 0 !important; }
        .answer-key-page { page-break-before: always; }
      }
      @media screen {
        .print-sheet { max-width: 210mm; margin: 0 auto; }
      }
      .compact-q { font-size: 8.5px; line-height: 1.25; }
      .compact-label { font-size: 7px; }
    `}</style>
  )
}

export function PaperHeader({
  chapterTitle, today, maxMarks, time, subtitle, kind,
}: {
  chapterTitle: string
  today: string
  maxMarks: number
  time: number
  subtitle?: string
  /** 'Mock Test' or 'Exercise Test' — whatever label this paper should carry. */
  kind: string
}) {
  return (
    <div className="flex items-center justify-between border-b-2 border-emerald-600 pb-2 mb-3">
      <div className="flex items-center gap-2">
        <img src="/favicon.svg" alt="IQRA" className="w-7 h-7" onError={e => (e.currentTarget.style.display = 'none')} />
        <div>
          <div className="font-black text-xs">IQRA</div>
          <div className="text-[8px] text-gray-400">{kind}{subtitle ? ` — ${subtitle}` : ''} · {maxMarks} marks · {time} min</div>
        </div>
      </div>
      <div className="text-right">
        <div className="font-bold text-xs">{chapterTitle}</div>
        <div className="text-[8px] text-gray-400">{today}</div>
      </div>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-[8.5px] font-bold text-emerald-700 uppercase tracking-wide mb-1 border-b border-gray-200 pb-0.5">{title}</div>
      {children}
    </div>
  )
}
