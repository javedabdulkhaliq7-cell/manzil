import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trophy, X, MapPin, GraduationCap, School, Flame } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { avatarUrl } from '../lib/constants'
import BottomNav from '../components/BottomNav'
import GreenHero from '../components/GreenHero'

type LeaderboardRow = {
  id: string
  display_name: string
  avatar_id: number
  district: string | null
  class_level: string | null
  school_name: string | null
  score: number
  streak_days: number
  app_rank: number
  district_rank: number
  class_rank: number
}

type Cursor = { score: number; streak_days: number; id: string }

const PAGE_SIZE = 40
const LEADERBOARD_COLUMNS = 'id, display_name, avatar_id, district, class_level, school_name, score, streak_days, app_rank, district_rank, class_rank'

// Keyset pagination, not OFFSET — stays fast no matter how deep a student
// scrolls (there's no cap on visibility, see spec section 2). The ordering
// here has to exactly match the leaderboard view's own RANK() ordering
// (score desc, streak_days desc), with id as a final tiebreaker so ties
// paginate deterministically instead of skipping or repeating rows.
async function fetchLeaderboardPage(cursor: Cursor | null): Promise<LeaderboardRow[]> {
  let query = supabase
    .from('leaderboard')
    .select(LEADERBOARD_COLUMNS)
    .order('score', { ascending: false })
    .order('streak_days', { ascending: false })
    .order('id', { ascending: true })
    .limit(PAGE_SIZE)

  if (cursor) {
    query = query.or(
      `score.lt.${cursor.score},` +
      `and(score.eq.${cursor.score},streak_days.lt.${cursor.streak_days}),` +
      `and(score.eq.${cursor.score},streak_days.eq.${cursor.streak_days},id.gt.${cursor.id})`
    )
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as LeaderboardRow[]
}

const PODIUM_STYLE = [
  { wrap: '-mb-1', ring: 'border-brand-500', badge: 'from-brand-700 to-brand-500', size: 'w-16 h-16', barH: 'h-16', crown: true, textSize: 'text-sm font-black' },
  { wrap: '', ring: 'border-brand-300', badge: 'from-brand-400 to-brand-300', size: 'w-12 h-12', barH: 'h-12', crown: false, textSize: 'text-xs font-bold' },
  { wrap: '', ring: 'border-brand-200', badge: 'from-brand-300 to-brand-200', size: 'w-12 h-12', barH: 'h-8', crown: false, textSize: 'text-xs font-bold' },
]

function PodiumSlot({ row, place, isMe, onSelect }: { row: LeaderboardRow; place: 1 | 2 | 3; isMe: boolean; onSelect: (row: LeaderboardRow) => void }) {
  const s = PODIUM_STYLE[place - 1]
  return (
    <button onClick={() => onSelect(row)} className={`flex flex-col items-center gap-1 ${s.wrap}`}>
      <div className="text-xs font-bold text-slate-700 truncate max-w-[70px] dark:text-slate-300">
        {row.display_name}{isMe ? ' (You)' : ''}
      </div>
      <div className="relative">
        {s.crown && <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-xl">👑</div>}
        <div className={`${s.size} rounded-full overflow-hidden border-2 ${s.ring} bg-brand-50 dark:bg-brand-950/40 shadow-sm`}>
          <img src={avatarUrl(row.avatar_id)} alt={row.display_name} className="w-full h-full object-cover" />
        </div>
      </div>
      <div className={`${s.textSize} text-brand-700 dark:text-brand-400`}>{row.score}</div>
      <div className={`w-14 ${s.barH} bg-gradient-to-b ${s.badge} rounded-t-lg flex items-center justify-center`}>
        <span className="text-lg font-black text-white">{place}</span>
      </div>
    </button>
  )
}

function ProfileSheet({ row, isMe, onClose }: { row: LeaderboardRow; isMe: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl p-5 pb-8 animate-in slide-in-from-bottom"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-end">
          <button onClick={onClose} className="text-gray-400 dark:text-slate-500">
            <X size={20} />
          </button>
        </div>
        <div className="flex flex-col items-center gap-2 -mt-2 mb-4">
          <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-brand-300 bg-brand-50 dark:bg-brand-950/40 shadow-sm">
            <img src={avatarUrl(row.avatar_id)} alt={row.display_name} className="w-full h-full object-cover" />
          </div>
          <div className="text-base font-bold text-slate-900 dark:text-slate-100">
            {row.display_name}{isMe ? ' (You)' : ''}
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-slate-500">
            {row.class_level && (
              <span className="flex items-center gap-1"><GraduationCap size={12} /> {row.class_level}</span>
            )}
            {row.district && (
              <span className="flex items-center gap-1"><MapPin size={12} /> {row.district}</span>
            )}
          </div>
          {/* Only ever present here when the student both entered AND
              opted to show it — the view already enforces this (see
              schema section 5), so no extra check needed client-side. */}
          {row.school_name && (
            <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-slate-500">
              <School size={12} /> {row.school_name}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            { label: 'App Rank', val: `#${row.app_rank}` },
            { label: 'District Rank', val: `#${row.district_rank}` },
            { label: 'Class Rank', val: `#${row.class_rank}` },
          ].map(({ label, val }) => (
            <div key={label} className="bg-brand-50 dark:bg-brand-950/40 rounded-xl py-2.5 text-center">
              <div className="text-sm font-black text-brand-700 dark:text-brand-400">{val}</div>
              <div className="text-[9px] text-gray-400 dark:text-slate-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <div className="flex-1 bg-gray-50 dark:bg-slate-800 rounded-xl py-2.5 flex items-center justify-center gap-1.5">
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{row.score}</span>
            <span className="text-[10px] text-gray-400 dark:text-slate-500">Score</span>
          </div>
          <div className="flex-1 bg-orange-50 dark:bg-orange-950/30 rounded-xl py-2.5 flex items-center justify-center gap-1.5">
            <Flame size={13} className="text-orange-500" />
            <span className="text-sm font-bold text-orange-600 dark:text-orange-400">{row.streak_days}d streak</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LeaderboardScreen() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [selected, setSelected] = useState<LeaderboardRow | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)

  useEffect(() => {
    if (!profile) return // still waiting on AuthContext — keep the spinner up
    if (!profile.district || !profile.full_name) { setLoading(false); return }
    let cancelled = false
    async function loadFirstPage() {
      setLoading(true)
      try {
        const page = await fetchLeaderboardPage(null)
        if (cancelled) return
        setRows(page)
        setHasMore(page.length === PAGE_SIZE)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadFirstPage()
    return () => { cancelled = true }
  }, [profile])

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || rows.length === 0) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const last = rows[rows.length - 1]
      const page = await fetchLeaderboardPage({ score: last.score, streak_days: last.streak_days, id: last.id })
      setRows(prev => [...prev, ...page])
      setHasMore(page.length === PAGE_SIZE)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [rows, hasMore])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) loadMore()
  }

  // Gated here rather than at signup — the leaderboard view derives
  // display_name from full_name/name (falls back to a generic "Student")
  // and district straight from profiles.district, so without these a
  // student shows up anonymously and can't be ranked against their area.
  if (profile && (!profile.district || !profile.full_name)) {
    return (
      <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
        <GreenHero>
          <div className="text-center">
            <div className="text-4xl mb-2">🏆</div>
            <h1 className="text-xl font-bold">Leaderboard</h1>
          </div>
        </GreenHero>
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-4">
          <Trophy className="text-brand-400" size={40} />
          <div>
            <div className="text-sm font-bold text-slate-900 mb-1 dark:text-slate-100">Add your name &amp; district first</div>
            <div className="text-xs text-gray-400 max-w-[240px] dark:text-slate-500">We need these to show you on the board and rank you against your area.</div>
          </div>
          <button
            onClick={() => navigate('/complete-profile', { state: { returnTo: '/leaderboard' } })}
            className="bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold px-8 py-3.5 rounded-2xl text-sm shadow-lg shadow-brand-200 dark:shadow-black/30 active:scale-95 transition-all"
          >
            Complete Profile
          </button>
        </div>
        <BottomNav />
      </div>
    )
  }

  const podium = rows.slice(0, 3)
  const rest = rows.slice(3)

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      <GreenHero>
        <div className="text-center">
          <div className="text-4xl mb-2">🏆</div>
          <h1 className="text-xl font-bold">Leaderboard</h1>
          <p className="text-brand-100 text-xs mt-0.5">Ranked by total correct MCQs, ties broken by streak</p>
        </div>
      </GreenHero>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {loading && (
          <div className="flex justify-center py-10">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="flex flex-col items-center text-center py-14 px-6">
            <div className="w-16 h-16 rounded-2xl bg-brand-50 flex items-center justify-center mb-4 dark:bg-brand-950/40">
              <Trophy className="text-brand-400" size={28} />
            </div>
            <div className="text-sm font-semibold text-gray-700 mb-1 dark:text-slate-300">No one's on the board yet</div>
            <div className="text-xs text-gray-400 max-w-[220px] dark:text-slate-500">Complete a quiz to earn correct answers and be the first name here.</div>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <>
            {/* Podium — top 3, always the first three rows since the page
                query is sorted by score/streak desc. */}
            <div className="flex items-end justify-center gap-3 py-2">
              {podium[1] && <PodiumSlot row={podium[1]} place={2} isMe={podium[1].id === profile?.id} onSelect={setSelected} />}
              {podium[0] && <PodiumSlot row={podium[0]} place={1} isMe={podium[0].id === profile?.id} onSelect={setSelected} />}
              {podium[2] && <PodiumSlot row={podium[2]} place={3} isMe={podium[2].id === profile?.id} onSelect={setSelected} />}
            </div>

            {/* Single continuous list, sorted by App Rank, no tabs, no cap
                on scroll depth — own row highlighted wherever it falls,
                never pulled into a separate pinned card. Name gets a full
                line to itself; district/class rank sit as small pills
                below it rather than fighting for space in fixed columns
                (six fixed-width columns left ~36px for the name on a
                360-ish px phone — not enough to read). */}
            <div className="flex flex-col gap-2">
              {rest.map(row => {
                const isMe = row.id === profile?.id
                return (
                  <button
                    key={row.id}
                    onClick={() => setSelected(row)}
                    className={`text-left bg-white rounded-2xl shadow-sm p-3 flex items-center gap-3 dark:bg-slate-800 active:scale-[0.98] transition-all ${
                      isMe ? 'ring-2 ring-brand-400' : ''
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-brand-50 dark:bg-brand-950/40 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-black text-brand-600 dark:text-brand-400">{row.app_rank}</span>
                    </div>
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-brand-50 dark:bg-brand-950/40 flex-shrink-0">
                      <img src={avatarUrl(row.avatar_id)} alt={row.display_name} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-slate-900 truncate dark:text-slate-100">
                        {row.display_name}{isMe ? ' (You)' : ''}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-[9px] font-semibold text-gray-400 dark:text-slate-500 bg-gray-50 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">
                          District #{row.district_rank}
                        </span>
                        <span className="text-[9px] font-semibold text-gray-400 dark:text-slate-500 bg-gray-50 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">
                          Class #{row.class_rank}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                      <span className="text-sm font-black text-brand-600 dark:text-brand-400">{row.score}</span>
                      <span className="text-[10px] text-orange-500 flex items-center gap-0.5">🔥{row.streak_days}</span>
                    </div>
                  </button>
                )
              })}
            </div>

            {loadingMore && (
              <div className="flex justify-center py-4">
                <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!hasMore && rows.length > 0 && (
              <div className="text-center text-[10px] text-gray-300 dark:text-slate-600 py-4">
                That's everyone — {rows.length} students ranked
              </div>
            )}
          </>
        )}
      </div>

      {selected && <ProfileSheet row={selected} isMe={selected.id === profile?.id} onClose={() => setSelected(null)} />}

      <BottomNav />
    </div>
  )
}
