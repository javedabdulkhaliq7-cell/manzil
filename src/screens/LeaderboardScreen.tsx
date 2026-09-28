import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trophy, X, MapPin, GraduationCap, School, Flame, Rocket } from 'lucide-react'
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
  last_active_at: string | null
  is_active: boolean
  app_rank: number
  district_rank: number
  class_rank: number
}

type Cursor = { score: number; streak_days: number; id: string }

const AFTER_PAGE_SIZE = 40
const BEFORE_INITIAL = 3   // "two or more above" — 3 gives a little breathing room
const BEFORE_PAGE_SIZE = 20
const LEADERBOARD_COLUMNS = 'id, display_name, avatar_id, district, class_level, school_name, score, streak_days, last_active_at, is_active, app_rank, district_rank, class_rank'

// Keyset pagination, not OFFSET — stays fast no matter how deep a student
// scrolls (there's no cap on visibility, see spec section 2). The ordering
// here has to exactly match the leaderboard view's own RANK() ordering
// (score desc, streak_days desc), with id as a final tiebreaker so ties
// paginate deterministically instead of skipping or repeating rows.
async function fetchRowsAfter(cursor: Cursor | null, limit: number): Promise<LeaderboardRow[]> {
  let query = supabase
    .from('leaderboard')
    .select(LEADERBOARD_COLUMNS)
    .order('score', { ascending: false })
    .order('streak_days', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit)

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

// Mirror of fetchRowsAfter, but walking upward (better-ranked) from a
// cursor instead of downward — used both for the initial "center on me"
// window and for loading more as the student scrolls up. Fetches in
// reverse order (closest-to-cursor first) then flips the result back to
// normal forward (best-to-worst) order before returning.
async function fetchRowsBefore(cursor: Cursor, limit: number): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase
    .from('leaderboard')
    .select(LEADERBOARD_COLUMNS)
    .order('score', { ascending: true })
    .order('streak_days', { ascending: true })
    .order('id', { ascending: false })
    .or(
      `score.gt.${cursor.score},` +
      `and(score.eq.${cursor.score},streak_days.gt.${cursor.streak_days}),` +
      `and(score.eq.${cursor.score},streak_days.eq.${cursor.streak_days},id.lt.${cursor.id})`
    )
    .limit(limit)

  if (error) throw error
  return ((data ?? []) as LeaderboardRow[]).reverse()
}

async function fetchTopThree(): Promise<LeaderboardRow[]> {
  return fetchRowsAfter(null, 3)
}

async function fetchMyRow(id: string): Promise<LeaderboardRow | null> {
  const { data, error } = await supabase
    .from('leaderboard')
    .select(LEADERBOARD_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as LeaderboardRow) ?? null
}

// Never affects score, rank, or the crown itself — purely a display flag
// so an inactive top scorer's real (earned) rank stays honest and untouched,
// while still making it visually obvious they aren't currently competing.
function daysInactive(row: LeaderboardRow): number | null {
  if (row.is_active || !row.last_active_at) return null
  const ms = Date.now() - new Date(row.last_active_at).getTime()
  return Math.max(1, Math.floor(ms / (1000 * 60 * 60 * 24)))
}

const PODIUM_STYLE = [
  { wrap: '-mb-1', ring: 'border-brand-500', badge: 'from-brand-700 to-brand-500', size: 'w-16 h-16', barH: 'h-16', crown: true, textSize: 'text-sm font-black' },
  { wrap: '', ring: 'border-brand-300', badge: 'from-brand-400 to-brand-300', size: 'w-12 h-12', barH: 'h-12', crown: false, textSize: 'text-xs font-bold' },
  { wrap: '', ring: 'border-brand-200', badge: 'from-brand-300 to-brand-200', size: 'w-12 h-12', barH: 'h-8', crown: false, textSize: 'text-xs font-bold' },
]

function PodiumSlot({ row, place, isMe, onSelect }: { row: LeaderboardRow; place: 1 | 2 | 3; isMe: boolean; onSelect: (row: LeaderboardRow) => void }) {
  const s = PODIUM_STYLE[place - 1]
  const inactiveDays = daysInactive(row)
  return (
    <button onClick={() => onSelect(row)} className={`flex flex-col items-center gap-1 ${s.wrap} ${inactiveDays ? 'opacity-60' : ''}`}>
      <div className="text-xs font-bold text-slate-700 truncate max-w-[70px] dark:text-slate-300">
        {row.display_name}{isMe ? ' (You)' : ''}
      </div>
      <div className="relative">
        {s.crown && <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-xl">👑</div>}
        <div className={`${s.size} rounded-full overflow-hidden border-2 ${s.ring} bg-brand-50 dark:bg-brand-950/40 shadow-sm ${inactiveDays ? 'grayscale' : ''}`}>
          <img src={avatarUrl(row.avatar_id)} alt={row.display_name} className="w-full h-full object-cover" />
        </div>
      </div>
      <div className={`${s.textSize} text-brand-700 dark:text-brand-400`}>{row.score}</div>
      {inactiveDays && (
        <div className="text-[8px] font-semibold text-gray-400 dark:text-slate-500">Inactive {inactiveDays}d</div>
      )}
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
          {row.school_name && (
            <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-slate-500">
              <School size={12} /> {row.school_name}
            </span>
          )}
          {!row.is_active && (
            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded-full mt-1">
              Inactive {daysInactive(row)}d — hasn't studied recently
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
  const { profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [topThree, setTopThree] = useState<LeaderboardRow[]>([])
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [hasMoreAfter, setHasMoreAfter] = useState(true)
  const [hasMoreBefore, setHasMoreBefore] = useState(false)
  const [selected, setSelected] = useState<LeaderboardRow | null>(null)
  // Set only when this load's rank beats the rank stored from the last
  // time this student opened the leaderboard (see the profiles.last_seen_app_rank compare
  // below) — drives the celebration banner and the "float in" highlight on
  // the student's own row.
  const [rankChange, setRankChange] = useState<{ prev: number; current: number } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)
  const loadingEarlierRef = useRef(false)
  const prependAdjustRef = useRef<{ prevHeight: number } | null>(null)
  const scrolledToMeRef = useRef(false)
  const meRowRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!profile) return // still waiting on AuthContext — keep the spinner up
    if (!profile.district || !profile.full_name) { setLoading(false); return }
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const [top3, myRow] = await Promise.all([fetchTopThree(), fetchMyRow(profile!.id)])
        if (cancelled) return
        setTopThree(top3)
        const topIds = new Set(top3.map(r => r.id))

        if (!myRow || myRow.app_rank <= 3) {
          // Not found (shouldn't happen given the gate above) or already
          // visible in the podium — list just starts from rank 4, as
          // before. No "center on me" needed when I'm already at the top.
          const after = await fetchRowsAfter(null, AFTER_PAGE_SIZE)
          if (cancelled) return
          setRows(after.filter(r => !topIds.has(r.id)))
          setHasMoreAfter(after.length === AFTER_PAGE_SIZE)
          setHasMoreBefore(false)
        } else {
          const cursor: Cursor = { score: myRow.score, streak_days: myRow.streak_days, id: myRow.id }
          const [before, after] = await Promise.all([
            fetchRowsBefore(cursor, BEFORE_INITIAL),
            fetchRowsAfter(cursor, AFTER_PAGE_SIZE),
          ])
          if (cancelled) return
          const beforeFiltered = before.filter(r => !topIds.has(r.id))
          setRows([...beforeFiltered, myRow, ...after])
          setHasMoreAfter(after.length === AFTER_PAGE_SIZE)
          setHasMoreBefore(before.length === BEFORE_INITIAL)
        }

        // Rank-up celebration — compares against the rank stored the last
        // time this student opened the leaderboard, durably in their
        // profile (works across devices, unlike the previous localStorage
        // version). Only fires going forward (rank number went down =
        // better); first-ever visit just seeds the stored value with
        // nothing to compare against yet.
        if (myRow) {
          const prevRank = profile!.last_seen_app_rank
          if (prevRank !== null && myRow.app_rank < prevRank) {
            setRankChange({ prev: prevRank, current: myRow.app_rank })
          }
          if (prevRank !== myRow.app_rank) {
            await supabase.from('profiles').update({ last_seen_app_rank: myRow.app_rank }).eq('id', profile!.id)
            refreshProfile()
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
    // profile?.id, not profile — load() calls refreshProfile() at the end
    // (to sync last_seen_app_rank into context), which changes the profile
    // object's reference; depending on the whole object would re-trigger
    // this effect and refetch/re-scroll the whole screen for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  // Keeps the scroll position visually stable when new rows are prepended
  // above what's currently on screen (loadEarlier) — without this the
  // student's view would jump as content is added above them.
  useEffect(() => {
    if (prependAdjustRef.current && scrollRef.current) {
      const { prevHeight } = prependAdjustRef.current
      scrollRef.current.scrollTop += scrollRef.current.scrollHeight - prevHeight
      prependAdjustRef.current = null
    }
  }, [rows])

  // Centers the student's own row in the viewport the first time it
  // renders — "two above, two or more below, then scroll either way."
  // Only runs once per screen visit; does nothing when the student is
  // already visible via the podium (meRowRef never gets attached then).
  useEffect(() => {
    if (!loading && !scrolledToMeRef.current && meRowRef.current) {
      meRowRef.current.scrollIntoView({ block: 'center' })
      scrolledToMeRef.current = true
    }
  }, [loading, rows])

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreAfter || rows.length === 0) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const last = rows[rows.length - 1]
      const page = await fetchRowsAfter({ score: last.score, streak_days: last.streak_days, id: last.id }, AFTER_PAGE_SIZE)
      setRows(prev => [...prev, ...page])
      setHasMoreAfter(page.length === AFTER_PAGE_SIZE)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [rows, hasMoreAfter])

  const loadEarlier = useCallback(async () => {
    if (loadingEarlierRef.current || !hasMoreBefore || rows.length === 0) return
    loadingEarlierRef.current = true
    setLoadingEarlier(true)
    try {
      const first = rows[0]
      const topIds = new Set(topThree.map(r => r.id))
      const raw = await fetchRowsBefore({ score: first.score, streak_days: first.streak_days, id: first.id }, BEFORE_PAGE_SIZE)
      const filtered = raw.filter(r => !topIds.has(r.id))
      if (scrollRef.current) prependAdjustRef.current = { prevHeight: scrollRef.current.scrollHeight }
      setRows(prev => [...filtered, ...prev])
      setHasMoreBefore(raw.length === BEFORE_PAGE_SIZE)
    } finally {
      loadingEarlierRef.current = false
      setLoadingEarlier(false)
    }
  }, [rows, hasMoreBefore, topThree])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) loadMore()
    if (el.scrollTop < 200) loadEarlier()
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

        {!loading && topThree.length === 0 && (
          <div className="flex flex-col items-center text-center py-14 px-6">
            <div className="w-16 h-16 rounded-2xl bg-brand-50 flex items-center justify-center mb-4 dark:bg-brand-950/40">
              <Trophy className="text-brand-400" size={28} />
            </div>
            <div className="text-sm font-semibold text-gray-700 mb-1 dark:text-slate-300">No one's on the board yet</div>
            <div className="text-xs text-gray-400 max-w-[220px] dark:text-slate-500">Complete a quiz to earn correct answers and be the first name here.</div>
          </div>
        )}

        {!loading && topThree.length > 0 && (
          <>
            {rankChange && (
              <div className="bg-gradient-to-r from-brand-600 to-brand-500 rounded-2xl p-3 flex items-center gap-3 animate-in fade-in slide-in-from-top duration-500">
                <Rocket className="text-white flex-shrink-0" size={20} />
                <div className="flex-1 text-xs font-bold text-white">
                  You climbed to #{rankChange.current} — up from #{rankChange.prev}!
                </div>
                <button onClick={() => setRankChange(null)} className="text-white/70">
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Podium — always the true top 3, independent of where the
                list below is scrolled/centered. */}
            <div className="flex items-end justify-center gap-3 py-2">
              {topThree[1] && <PodiumSlot row={topThree[1]} place={2} isMe={topThree[1].id === profile?.id} onSelect={setSelected} />}
              {topThree[0] && <PodiumSlot row={topThree[0]} place={1} isMe={topThree[0].id === profile?.id} onSelect={setSelected} />}
              {topThree[2] && <PodiumSlot row={topThree[2]} place={3} isMe={topThree[2].id === profile?.id} onSelect={setSelected} />}
            </div>

            {loadingEarlier && (
              <div className="flex justify-center py-2">
                <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {/* Single continuous list, sorted by App Rank, no tabs, no cap
                on scroll depth. On open, this is windowed around the
                student's own row (a few rows above, a full page below) so
                they land in the middle of their own competition rather
                than at the very top — own row highlighted, never pulled
                into a separate pinned card. */}
            <div className="flex flex-col gap-2">
              {rows.map(row => {
                const isMe = row.id === profile?.id
                const inactiveDays = daysInactive(row)
                return (
                  <button
                    key={row.id}
                    ref={isMe ? meRowRef : undefined}
                    onClick={() => setSelected(row)}
                    className={`text-left bg-white rounded-2xl shadow-sm p-3 flex items-center gap-3 dark:bg-slate-800 active:scale-[0.98] transition-all ${
                      isMe ? 'ring-2 ring-brand-400' : ''
                    } ${isMe && rankChange ? 'animate-in zoom-in-50 duration-700' : ''} ${inactiveDays ? 'opacity-60' : ''}`}
                  >
                    <div className="w-8 h-8 rounded-full bg-brand-50 dark:bg-brand-950/40 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-black text-brand-600 dark:text-brand-400">{row.app_rank}</span>
                    </div>
                    <div className={`w-10 h-10 rounded-full overflow-hidden bg-brand-50 dark:bg-brand-950/40 flex-shrink-0 ${inactiveDays ? 'grayscale' : ''}`}>
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
                        {inactiveDays && (
                          <span className="text-[9px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded-full">
                            Inactive {inactiveDays}d
                          </span>
                        )}
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
            {!hasMoreAfter && rows.length > 0 && (
              <div className="text-center text-[10px] text-gray-300 dark:text-slate-600 py-4">
                That's everyone below — keep scrolling up for higher ranks
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
