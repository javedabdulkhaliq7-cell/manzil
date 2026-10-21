// PrintProofScreen.tsx: HIDDEN developer screen for File 1 Phase 1 (print-engine proof).
// Route: /dev/print-proof (not linked from anywhere). Builds the sample papers on THIS phone,
// times each one, then opens the normal share/print sheet so you can look at the real output.
import { useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { embedFonts, FontBytes } from '../lib/pdfText'
import { buildTestPdf } from '../lib/testPdfLayout'
import { proofCases } from '../lib/printProofCases'
import { printPdf } from '../lib/printPaper'

const get = async (name: string) => new Uint8Array(await (await fetch(`/fonts/${name}`)).arrayBuffer())

type Row = { id: string; ms: number; kb: number; pages: number; size: number } | { id: string; error: string }

export default function PrintProofScreen() {
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  async function build(id: string, print: boolean) {
    setBusy(true); setNote('')
    try {
      const png = await get('proof-diagram.png')
      const c = proofCases(png).find(x => x.id === id)!
      const t0 = performance.now()
      const bytes: FontBytes = {
        latin: await get('NotoSans-Regular.subset.ttf'), latinBold: await get('NotoSans-Bold.subset.ttf'),
        math: await get('NotoSansMath.symbols.ttf'), naskh: c.urdu ? await get('NotoNaskhArabic-Regular.ttf') : undefined,
      }
      const pdf = await PDFDocument.create()
      const fonts = await embedFonts(pdf, bytes)
      const fit = await buildTestPdf(pdf, c.doc, fonts)
      const out = await pdf.save()
      const ms = Math.round(performance.now() - t0)
      setRows(r => [...r.filter(x => x.id !== id), { id, ms, kb: Math.round(out.length / 1024), pages: fit.pages, size: fit.size }])
      if (print) await printPdf(out, `iqra-proof-${id}`)
    } catch (e) {
      setRows(r => [...r.filter(x => x.id !== id), { id, error: String((e as Error)?.message ?? e) }])
    } finally { setBusy(false) }
  }

  async function runAll() { for (const c of proofCases(new Uint8Array())) await build(c.id, false); setNote('Done. Now tap "Build + print" on each and check the paper.') }

  return (
    <div className="p-4 max-w-xl mx-auto text-sm">
      <h1 className="text-lg font-bold mb-1">Print engine proof (dev)</h1>
      <p className="mb-3 opacity-70 break-all">{navigator.userAgent}</p>
      <button disabled={busy} onClick={runAll} className="mb-4 px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50">Time all (no print)</button>
      {note && <p className="mb-3">{note}</p>}
      {proofCases(new Uint8Array()).map(c => {
        const r = rows.find(x => x.id === c.id)
        return (
          <div key={c.id} className="mb-3 p-3 rounded border">
            <div className="font-medium">{c.label}</div>
            {r && ('error' in r
              ? <div className="text-red-600">Error: {r.error}</div>
              : <div className="opacity-80">{r.ms} ms · {r.kb} KB · {r.pages} page(s) · {r.size} pt</div>)}
            <button disabled={busy} onClick={() => build(c.id, true)} className="mt-2 px-3 py-1.5 rounded border disabled:opacity-50">Build + print</button>
          </div>
        )
      })}
    </div>
  )
}
