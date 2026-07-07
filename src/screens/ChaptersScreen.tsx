import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Lock, CheckCircle } from 'lucide-react'
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

  function getStatus(ch: Chapter) {
    const pct = progress[ch.id]
    if (ch.is_locked) return 'locked'
    if (pct === 100) return 'done'
    if (pct != null && pct > 0) return 'active'
    return 'unlocked'
  }

  const doneCount = chapters.filter(ch => progress[ch.id] === 100).length
  const overallPct = chapters.length > 0
    ? Math.round(chapters.reduce((acc, ch) => acc + (progress[ch.id] ?? 0), 0) / chapters.length)
    : 0

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <GreenHero>
        <button onClick={() => navigate(-1)} className="text-emerald-200 mb-2 flex items-center gap-1 text-xs">
          <ChevronLeft size={14} /> Back
        </button>
        <div className="flex items-center gap-3">
          <div className="text-3xl">{subject?.emoji ?? '📚'}</div>
          <div>
            <h1 className="text-xl font-black">{subject?.name ?? 'Chapters'}</h1>
            <p className="text-emerald-100 text-xs">{subject?.class_level} · Balochistan Board · {chapters.length} Chapters</p>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          {[`${overallPct}% Done`, `${subject?.mcq_count ?? 0} MCQs`, `${doneCount}/${chapters.length} Chapters`].map(t => (
            <span key={t} className="bg-white/20 text-white text-[10px] font-semibold px-2.5 py-1 rounded-full">{t}</span>
          ))}
        </div>
      </GreenHero>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {loading && (
          <div className="flex justify-center py-10">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {chapters.map(ch => {
          const status = getStatus(ch)
          const pct = progress[ch.id]
          return (
            <button
              key={ch.id}
              onClick={() => status !== 'locked' && navigate(`/chapter/${ch.id}`)}
              className={`flex items-center gap-3 bg-white rounded-2xl shadow-sm p-3 text-left active:scale-[0.99] transition-all ${
                status === 'active' ? 'border-2 border-emerald-200' : 'border border-gray-100'
              } ${status === 'locked' ? 'opacity-50' : ''}`}
            >
              {/* Number badge */}
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                status === 'done'    ? 'bg-emerald-500 text-white' :
                status === 'active' ? 'bg-slate-900 text-emerald-400' :
                status === 'locked' ? 'bg-gray-200 text-gray-400' :
                'bg-emerald-100 text-emerald-700'
              }`}>
                {status === 'done' ? <CheckCircle size={14} /> : ch.number}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-900 truncate">{ch.title}</div>
                <div className="text-xs text-gray-400">{ch.mcq_count} MCQs</div>
                {status === 'active' && pct != null && (
                  <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>

              <div className="flex-shrink-0">
                {status === 'done'     && <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-1 rounded-full">Done ✓</span>}
                {status === 'active'   && <span className="text-[10px] bg-slate-900 text-emerald-400 font-bold px-2 py-1 rounded-full">{pct}% →</span>}
                {status === 'locked'   && <Lock size={14} className="text-gray-400" />}
                {status === 'unlocked' && <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-1 rounded-full">Start →</span>}
              </div>
            </button>
          )
        })}
      </div>

      <BottomNav />
    </div>
  )
}
