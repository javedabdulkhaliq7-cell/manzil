import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import PdfViewer, { type ViewerMenuItem } from '../components/viewer/PdfViewer'
import { loadPdfFromPrivatePath } from '../lib/pdfjs'
import { scanDb, type ScanRow } from '../lib/scanner/scanDb'
import { loadSubjects, type ScanSubject } from '../lib/scanner/subjects'
import { useScanProfile } from '../lib/scanner/useScanProfile'
import { loadAnnotations, saveAnnotations, countStrokes, type AnnotationData } from '../lib/scanner/annotations'
import { buildHighlightedPdf } from '../lib/scanner/exportPdf'
import { downloadCopy, deleteCopy } from '../lib/scanner/iqraDownloads'
import { searchContent, getPageText, copyText, exportTextFile, useOcrProgress, isSkippedSubject } from '../lib/scanner/ocr'

// IQRA Scanner — S5: opens one saved scan in the PDF viewer (route /scan/view/:scanId).
export default function ScanViewerScreen() {
  const { scanId } = useParams()
  const [qs] = useSearchParams()
  const pageParam = Number(qs.get('page')) || 0 // set when opened from a search result
  const ocr = useOcrProgress()
  const me = useScanProfile()
  const navigate = useNavigate()
  const [row, setRow] = useState<ScanRow | null | undefined>(undefined) // undefined = loading, null = not found
  const [subjects, setSubjects] = useState<ScanSubject[]>([])
  const [choosing, setChoosing] = useState(false)
  const [ann, setAnn] = useState<AnnotationData | null>(null) // null until the saved layer is loaded
  const annRef = useRef<AnnotationData | null>(null)
  const saveTimer = useRef<number | null>(null)
  const [choice, setChoice] = useState<null | 'share' | 'download'>(null)
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3500) }

  useEffect(() => {
    if (!scanId) return
    scanDb.scans.get(scanId).then((r) => {
      // another account on this phone must never open this scan
      setRow(r && (!me || r.userId === me.id) ? r : null)
      if (r) {
        loadSubjects(r.userId, r.classId).then(setSubjects)
        loadAnnotations(r.folderPath).then((a) => { annRef.current = a; setAnn(a) })
      }
    })
  }, [scanId, me?.id])

  const pdfPath = row?.pdfPath
  const loadDoc = useCallback(() => loadPdfFromPrivatePath(pdfPath ?? ''), [pdfPath])
  const onPageChange = useCallback((p: number) => {
    if (scanId) scanDb.scans.update(scanId, { lastViewedPage: p })
  }, [scanId])

  const folder = row?.folderPath
  const onAnnotationsChange = useCallback((d: AnnotationData) => {
    annRef.current = d
    if (!folder) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => { saveAnnotations(folder, d).catch(() => {}) }, 300)
  }, [folder])

  // write any pending change if the student leaves right away
  useEffect(() => () => {
    if (saveTimer.current && folder && annRef.current) {
      window.clearTimeout(saveTimer.current)
      saveAnnotations(folder, annRef.current).catch(() => {})
    }
  }, [folder])

  const searchFn = useCallback(async (q: string) => {
    if (!row) return []
    const hits = await searchContent(row.userId, q, row.id)
    return hits.map((h) => ({ page: h.pageIndex + 1, snippet: h.snippet }))
  }, [row?.id, row?.userId])

  if (row === undefined || (row && ann === null)) return <div className="h-screen flex items-center justify-center text-xs text-gray-400">Opening…</div>
  if (row === null) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3 text-center px-6">
        <div className="text-sm font-bold text-slate-900 dark:text-slate-100">This scan is no longer on this phone</div>
        <button onClick={() => navigate('/scan', { replace: true })} className="text-xs font-bold text-brand-600">← Back to My Scans</button>
      </div>
    )
  }

  const current = row

  async function rename() {
    const next = window.prompt('Rename scan', current.name)
    if (next && next.trim()) {
      await scanDb.scans.update(current.id, { name: next.trim(), updatedAt: Date.now() })
      setRow({ ...current, name: next.trim() })
    }
  }

  async function shareOriginal() {
    try {
      const { uri } = await Filesystem.getUri({ path: current.pdfPath, directory: Directory.Data })
      await Share.share({ title: current.name, files: [uri] })
    } catch { /* student closed the share sheet */ }
  }

  async function shareWithHighlights() {
    try {
      const b64 = await buildHighlightedPdf(current, annRef.current ?? { v: 1, pages: {} })
      const file = `export/${current.name.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'scan'}_highlighted.pdf`
      await Filesystem.writeFile({ path: file, data: b64, directory: Directory.Cache, recursive: true })
      const { uri } = await Filesystem.getUri({ path: file, directory: Directory.Cache })
      await Share.share({ title: current.name, files: [uri] })
    } catch { /* student closed the share sheet, or export failed: the original is untouched */ }
  }

  const hasHighlights = () => !!annRef.current && countStrokes(annRef.current) > 0

  function share() {
    // Offer the choice only when there is something highlighted.
    if (hasHighlights()) setChoice('share')
    else shareOriginal()
  }

  async function downloadNow(withHighlights: boolean) {
    showToast('Saving a copy…')
    const res = await downloadCopy(current, withHighlights, annRef.current)
    if (res.ok) { setRow(res.row); showToast(`Saved to ${res.folder}`) }
    else showToast(res.message)
  }

  function download() {
    if (hasHighlights()) setChoice('download')
    else downloadNow(false)
  }

  async function removeCopy() {
    if (!window.confirm('Delete the copy from your phone storage? The scan stays in Iqra.')) return
    setRow(await deleteCopy(current))
    showToast('Copy deleted from phone storage')
  }

  async function remove() {
    if (!window.confirm(`Delete "${current.name}"? This can't be undone.`)) return
    await Filesystem.rmdir({ path: current.folderPath, directory: Directory.Data, recursive: true }).catch(() => {})
    await scanDb.scans.delete(current.id)
    navigate('/scan', { replace: true })
  }

  async function moveTo(s: { id: string | null; label: string }) {
    await scanDb.scans.update(current.id, { subjectId: s.id, subjectLabel: s.label, updatedAt: Date.now() })
    setRow({ ...current, subjectId: s.id, subjectLabel: s.label })
    setChoosing(false)
  }

  const skipped = isSkippedSubject(current.subjectLabel)
  const reading = ocr?.scanId === current.id || current.ocrStatus === 'pending'
  const searchHint = skipped
    ? "Text search isn't available for Urdu or Islamiat scans yet."
    : reading ? 'Still reading the text of this scan — try again in a moment.' : 'No matches found.'

  async function copyPage(page: number) {
    if (skipped) { showToast("Text reading isn't available for this subject yet."); return }
    const text = await getPageText(current.id, page - 1)
    if (!text.trim()) { showToast(reading ? 'Still reading the text of this scan…' : 'No text found on this page.'); return }
    showToast((await copyText(text)) ? `Copied text from page ${page}` : "Couldn't copy the text.")
  }

  async function exportText() {
    if (skipped) { showToast("Text reading isn't available for this subject yet."); return }
    const ok = await exportTextFile(current).catch(() => false)
    if (!ok) showToast(reading ? 'Still reading the text of this scan…' : 'No text found in this scan.')
  }

  const menu: ViewerMenuItem[] = [
    { label: 'Rename', onClick: rename },
    { label: 'Edit pages', onClick: () => navigate(`/scan/pages/${current.id}`) },
    { label: 'Change subject', onClick: () => setChoosing(true) },
    { label: 'Copy page text', onClick: copyPage },
    { label: 'Export text (.txt)', onClick: exportText },
    { label: 'Share', onClick: share },
    { label: 'Download to phone', onClick: download },
    ...(current.localCopyUri ? [{ label: 'Delete copy from phone', onClick: removeCopy }] : []),
    { label: 'Delete', onClick: remove, danger: true },
  ]

  return (
    <>
      <PdfViewer
        title={current.name}
        loadDoc={loadDoc}
        initialPage={pageParam || current.lastViewedPage}
        onPageChange={onPageChange}
        onBack={() => navigate('/scan')}
        menu={menu}
        annotations={ann ?? undefined}
        onAnnotationsChange={onAnnotationsChange}
        searchFn={searchFn}
        searchHint={searchHint}
      />
      {choice && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setChoice(null)}>
          <div className="w-full max-w-sm mx-auto bg-white dark:bg-slate-900 rounded-t-3xl p-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-bold mb-3 text-slate-900 dark:text-slate-100">{choice === 'share' ? 'Share as' : 'Save as'}</div>
            <button onClick={() => { const c = choice; setChoice(null); c === 'share' ? shareWithHighlights() : downloadNow(true) }}
              className="w-full text-left px-3 py-3 rounded-xl text-sm font-semibold text-slate-800 dark:text-slate-200 active:bg-gray-100 dark:active:bg-slate-800">
              With my highlights
            </button>
            <button onClick={() => { const c = choice; setChoice(null); c === 'share' ? shareOriginal() : downloadNow(false) }}
              className="w-full text-left px-3 py-3 rounded-xl text-sm font-semibold text-slate-800 dark:text-slate-200 active:bg-gray-100 dark:active:bg-slate-800">
              Original (no highlights)
            </button>
          </div>
        </div>
      )}
      {toast && (
        <div className="fixed bottom-24 inset-x-0 z-50 flex justify-center pointer-events-none">
          <div className="bg-slate-900 text-white text-xs font-semibold rounded-full px-4 py-2 shadow-lg">{toast}</div>
        </div>
      )}
      {choosing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setChoosing(false)}>
          <div className="w-full max-w-sm mx-auto bg-white dark:bg-slate-900 rounded-t-3xl p-4 max-h-[60vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-bold mb-3 text-slate-900 dark:text-slate-100">Move to subject</div>
            {[...subjects.map((s) => ({ id: s.id as string | null, label: s.label })), { id: null, label: 'Other' }].map((s) => (
              <button key={s.id ?? 'other'} dir="auto" onClick={() => moveTo(s)}
                className="w-full text-left px-3 py-3 rounded-xl text-sm font-semibold text-slate-800 dark:text-slate-200 active:bg-gray-100 dark:active:bg-slate-800">
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
