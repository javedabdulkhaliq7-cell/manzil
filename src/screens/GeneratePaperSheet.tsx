import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import FractionText from '../components/FractionText'
import { generatePaper, NotEnoughQuestionsError, Blueprint, paperTotalFor } from '../lib/paperGenerator'
import { loadGeneratorData, saveGeneratedPaper, OfflineDataError } from '../lib/generatorData'
import { loadPack } from '../lib/subjectPack'
import { validityStatus } from '../lib/offlineValidity'

type Props = {
  subjectId: string
  subjectName: string
  onClose: () => void
  onCreated: (generatedPaperId: string) => void
}

type ChapterRow = { id: string; number: number; title: string }

function tidyTitle(title: string): string {
  const letters = title.replace(/[^A-Za-z]/g, '')
  if (letters.length > 0 && letters === letters.toUpperCase()) {
    return title.toLowerCase().replace(/(^|\s)([a-z])/g, (_, s, c) => s + c.toUpperCase())
  }
  return title
}

function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

export default function GeneratePaperSheet({ subjectId, subjectName, onClose, onCreated }: Props) {
  const { user } = useAuth()
  const [chapters, setChapters] = useState<ChapterRow[]>([])
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null)
  const [ready, setReady] = useState(false)
  const [notice, setNotice] = useState('') // shown instead of the form when generation is not possible
  const [scope, setScope] = useState<'full' | 'chapters'>('full')
  const [picked, setPicked] = useState<string[]>([])
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  // What the sheet needs to open: chapters and the blueprint, from the server or the saved subject.
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (online()) {
        try {
          const [chRes, bpRes] = await Promise.all([
            supabase.from('chapters').select('id, number, title').eq('subject_id', subjectId).order('number', { ascending: true }),
            supabase.from('paper_templates').select('structure').eq('subject_id', subjectId).order('created_at', { ascending: false }).limit(1),
          ])
          if (!chRes.error && !bpRes.error) {
            if (cancelled) return
            setChapters((chRes.data ?? []) as ChapterRow[])
            const structure = bpRes.data && bpRes.data[0] ? (bpRes.data[0].structure as Blueprint) : null
            setBlueprint(structure && Array.isArray(structure.sections) ? structure : null)
            setReady(true)
            return
          }
        } catch { /* use the saved subject */ }
      }
      const uid = user?.id
      const pack = uid ? await loadPack(uid, subjectId) : undefined
      if (cancelled) return
      if (!uid || !pack) {
        setNotice('You are offline. Download this subject when you have internet, and you can generate papers without it.')
      } else if ((await validityStatus(uid)).status !== 'valid') {
        setNotice('Connect to the internet once to keep using your downloaded papers.')
      } else {
        setChapters(pack.chapters)
        setBlueprint(pack.blueprint)
      }
      setReady(true)
    }
    load().catch(() => { if (!cancelled) { setNotice('Could not open the paper generator. Please try again.'); setReady(true) } })
    return () => { cancelled = true }
  }, [subjectId, user?.id])

  function toggle(id: string) {
    setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
  }

  async function generate() {
    if (!blueprint || !user?.id || working) return
    if (scope === 'chapters' && picked.length === 0) { setError('Pick at least one chapter.'); return }
    setWorking(true)
    setError('')
    try {
      const data = await loadGeneratorData(user.id, subjectId)
      const { pack } = data
      const importance: Record<string, number> = {}
      for (const r of pack.importance) importance[r.chapter_id] = Number(r.percentage)

      const result = generatePaper({
        scope,
        chapterIds: scope === 'chapters' ? picked : pack.chapters.map(c => c.id),
        blueprint: pack.blueprint ?? blueprint,
        chapters: pack.chapters.map(c => ({ id: c.id, number: c.number })),
        mcqs: pack.mcqs, shorts: pack.shorts, longs: pack.longs, writing: pack.writing ?? [],
        importance, repeatCounts: pack.repeatCounts, used: data.used,
      })

      // Saved to the server when online, otherwise kept on this phone and uploaded later.
      const saved = await saveGeneratedPaper(user.id, pack, scope, picked, result)
      onCreated(saved.id)
    } catch (e) {
      if (e instanceof NotEnoughQuestionsError) {
        setError(scope === 'chapters'
          ? 'The chapters you picked do not have enough questions for a full paper. Add more chapters and try again.'
          : 'There are not enough questions in this subject yet to build a full paper.')
      } else if (e instanceof OfflineDataError) {
        setError(e.code === 'reconnect'
          ? 'Connect to the internet once to keep using your downloaded papers.'
          : 'You are offline. Download this subject when you have internet to generate papers without it.')
      } else {
        setError('Could not create the paper. Please try again.')
      }
      setWorking(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => { if (!working) onClose() }}>
      <div
        className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-t-2xl p-4 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Generate a new paper"
      >
        <div className="text-base font-black text-slate-900 dark:text-slate-100">Generate a new paper</div>
        <div className="text-xs text-gray-500 dark:text-slate-400 mb-3">{subjectName}. Built from the question bank, with model answers.</div>

        {!ready && (
          <div className="flex justify-center py-6" role="status" aria-label="Loading">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {ready && notice && (
          <div role="alert" className="text-sm text-gray-600 dark:text-slate-300 py-4">{notice}</div>
        )}

        {ready && !notice && !blueprint && (
          <div className="text-sm text-gray-600 dark:text-slate-300 py-4">
            Paper generation is not ready for this subject yet. Biology is available now.
          </div>
        )}

        {ready && !notice && blueprint && (
          <>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {([['full', 'Full paper'], ['chapters', 'Choose chapters']] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => { setScope(k); setError('') }}
                  aria-pressed={scope === k}
                  className={`text-sm font-bold rounded-xl py-2.5 border ${
                    scope === k ? 'bg-brand-600 text-white border-brand-600' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="text-xs text-gray-500 dark:text-slate-400 mb-3">
              {paperTotalFor(blueprint, scope)} marks · {Math.floor(blueprint.time_minutes / 60)} h {blueprint.time_minutes % 60 ? `${blueprint.time_minutes % 60} min` : ''}
              {scope === 'full'
                ? ' · Chapters are weighted by how often they are asked.'
                : ` · Questions are spread evenly across your chapters.${blueprint.sections.some(s => s.type === 'writing') ? ' Letters, applications and essays are only in full papers.' : ''}`}
            </div>

            {scope === 'chapters' && (
              <div className="flex flex-col gap-1.5 mb-3">
                {chapters.map(c => {
                  const on = picked.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggle(c.id)}
                      aria-pressed={on}
                      className={`flex items-center gap-2 text-left text-sm rounded-xl px-3 py-2 border ${
                        on ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30' : 'border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${on ? 'bg-brand-600 border-brand-600 text-white' : 'border-slate-400'}`}>
                        {on && <Check size={11} />}
                      </span>
                      <span className="text-slate-800 dark:text-slate-200">
                        Ch {c.number}. <FractionText text={tidyTitle(c.title)} />
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            {error && <div role="alert" className="text-xs font-semibold text-red-600 dark:text-red-400 mb-3">{error}</div>}

            <button
              onClick={generate}
              disabled={working}
              className="w-full bg-brand-600 text-white font-bold rounded-2xl py-3 disabled:opacity-60"
            >
              {working ? 'Building your paper…' : 'Generate paper'}
            </button>
          </>
        )}

        <button onClick={onClose} disabled={working} className="w-full mt-2 text-sm font-bold rounded-xl py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-60">
          Cancel
        </button>
      </div>
    </div>
  )
}
