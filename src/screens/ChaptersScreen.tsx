import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Lock } from 'lucide-react'
import { supabase, Chapter, Subject } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import BottomNav from '../components/BottomNav'
import GreenHero from '../components/GreenHero'

export default function ChaptersScreen() {
  const { subjectId } = useParams<{ subjectId: string }>()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [subject, setSubject] = useState<Subject | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const isPremium = profile?.plan === 'premium'

  useEffect(() => {
    async function load() {
      const [{ data: sub }, { data: chs }] = await Promise.all([
        supabase.from('subjects').select('*').eq('id', subjectId).single(),
        supabase.from('chapters').select('*').eq('subject_id', subjectId).order('number'),
      ])
      if (sub) setSubject(sub)
      if (chs) setChapters(chs)

      if (profile) {
        const { data: rows } = await supabase
          .from('user_progress')
          .select('chapter_id, completion_pct')
          .eq('user_id', profile.id)
          .eq('subject_id', subjectId)
        if (rows) {
          const map: Record<string, number> = {}
          rows.forEach(r => { map[r.chapter_id] = r.completion_pct })
          setProgress(map)
        }
      }
      setLoading(false)
    }
    load()
  }, [subjectId, profile])

  // ch.is_locked now means "requires premium", not "manually toggled off/on".
  // Free chapters should have is_locked = false in the DB (always open).
  // Premium chapters should have is_locked = true (open only for premium users).
  //
  // No "done" status: completion_pct is actually best-ever quiz score, not
  // real chapter coverage — a student can hit 100% from MCQs alone without
  // ever reading the notes. Treating a max score as "Done" falsely told
  // students they'd finished a chapter they may not have actually read.
  // Any attempted chapter (any score, including 100%) is just "active";
  // the score itself is shown honestly as a score, not a completion badge.
  function getStatus(ch: Chapter) {
    if (ch.is_locked && !isPremium) return 'locked'
    const pct = progress[ch.id]
    if (pct != null) return 'active'
    return 'unlocked'
  }

  // "Started" (attempted at least once), not "done" — same reasoning as
  // getStatus above. overallPct is the subject's average best score across
  // all chapters, not a completion measure.
  const startedCount = chapters.filter(ch => progress[ch.id] != null).length
  const overallPct = chapters.length > 0
    ? Math.round(chapters.reduce((acc, ch) => acc + (progress[ch.id] ?? 0), 0) / chapters.length)
    : 0

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      <GreenHero>
        <button onClick={() => navigate(-1)} className="text-brand-200 mb-2 flex items-center gap-1 text-xs">
          <ChevronLeft size={14} /> Back
        </button>
        <div className="flex items-center gap-3">
          <div className="text-3xl">{subject?.emoji ?? '📚'}</div>
          <div>
            <h1 className="text-xl font-black">{subject?.name ?? 'Chapters'}</h1>
            <p className="text-brand-100 text-xs">{subject?.class_level} · Balochistan Board · {chapters.length} Chapters</p>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          {[`${overallPct}% Best Score`, `${subject?.mcq_count ?? 0} MCQs`, `${startedCount}/${chapters.length} Started`].map(t => (
            <span key={t} className="bg-white/20 text-white text-[10px] font-semibold px-2.5 py-1 rounded-full">{t}</span>
          ))}
        </div>
      </GreenHero>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {loading && (
          <div className="flex justify-center py-10">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {chapters.map(ch => {
          const status = getStatus(ch)
          const pct = progress[ch.id]
          return (
            <button
              key={ch.id}
              onClick={() => status !== 'locked' && navigate(`/chapter/${ch.id}`)}
              className={`flex items-center gap-3 bg-white rounded-2xl shadow-sm p-3 text-left active:scale-[0.99] transition-all dark:bg-slate-800 ${
                status === 'active' ? 'border-2 border-brand-200' : 'border border-gray-100 dark:border-slate-700'
              } ${status === 'locked' ? 'opacity-50' : ''}`}
            >
              {/* Number badge */}
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                status === 'active' ? 'bg-slate-900 text-brand-400' :
                status === 'locked' ? 'bg-gray-200 text-gray-400 dark:bg-slate-600 dark:text-slate-500' :
                'bg-brand-100 dark:bg-brand-900/60 text-brand-700 dark:text-brand-300 dark:text-brand-400'
              }`}>
                {ch.number}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-900 truncate dark:text-slate-100">{ch.title}</div>
                <div className="text-xs text-gray-400 dark:text-slate-500">{ch.mcq_count} MCQs</div>
                {status === 'active' && pct != null && (
                  <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden dark:bg-slate-700">
                    <div className="h-full bg-gradient-to-r from-brand-600 to-brand-400 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>

              <div className="flex-shrink-0">
                {status === 'active'   && <span className="text-[10px] bg-slate-900 text-brand-400 font-bold px-2 py-1 rounded-full">Best: {pct}% →</span>}
                {status === 'locked'   && <Lock size={14} className="text-gray-400 dark:text-slate-500" />}
                {status === 'unlocked' && <span className="text-[10px] bg-brand-100 dark:bg-brand-900/60 text-brand-700 dark:text-brand-300 font-bold px-2 py-1 rounded-full dark:text-brand-400">Start →</span>}
              </div>
            </button>
          )
        })}
      </div>

      <BottomNav />
    </div>
  )
}