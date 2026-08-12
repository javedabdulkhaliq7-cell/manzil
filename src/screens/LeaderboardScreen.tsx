import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trophy } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import BottomNav from '../components/BottomNav'
import GreenHero from '../components/GreenHero'

type LeaderboardRow = {
  id: string
  display_name: string
  district: string | null
  class_level: string | null
  xp: number
  streak_days: number
}

const FILTERS = ['My District', 'Balochistan', 'Pakistan'] as const
type Filter = typeof FILTERS[number]

const AVATARS = ['👦', '👧', '🧑', '👩']
function avatarFor(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return AVATARS[hash % AVATARS.length]
}

export default function LeaderboardScreen() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('My District')
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!profile) return
      setLoading(true)
      let query = supabase.from('leaderboard').select('*').order('xp', { ascending: false }).limit(100)

      if (filter === 'My District' && profile.district) {
        query = query.eq('district', profile.district)
      } else if (filter === 'Balochistan') {
        query = query.eq('class_level', profile.class_level)
      }
      // 'Pakistan' = no filter, everyone

      const { data } = await query
      if (data) setRows(data)
      setLoading(false)
    }
    load()
  }, [profile, filter])

  const podium = rows.slice(0, 3)
  const rest = rows.slice(3, 7)
  const myIndex = rows.findIndex(r => r.id === profile?.id)
  const myEntry = myIndex >= 0 ? { ...rows[myIndex], rank: myIndex + 1 } : null
  const myInTop7 = myIndex >= 0 && myIndex < 7

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      <GreenHero>
        <div className="text-center">
          <div className="text-4xl mb-2">🏆</div>
          <h1 className="text-xl font-black">Leaderboard</h1>
          <p className="text-brand-100 text-xs mt-0.5">
            {filter === 'My District' && profile?.district ? `${profile.district} · ` : ''}
            {profile?.class_level ?? ''}
          </p>
          <div className="flex gap-2 justify-center mt-3">
            {FILTERS.map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[10px] font-bold px-3 py-1.5 rounded-xl transition-all ${
                  filter === f ? 'bg-white text-brand-700 dark:bg-slate-800 dark:text-brand-400' : 'bg-white/20 text-white'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </GreenHero>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
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
            <div className="text-xs text-gray-400 max-w-[220px] dark:text-slate-500">Complete a quiz to earn XP and be the first name here.</div>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <>
            {/* Podium */}
            <div className="flex items-end justify-center gap-3 py-2">
              {/* 2nd */}
              {podium[1] && (
                <div className="flex flex-col items-center gap-1">
                  <div className="text-xs font-bold text-gray-500 truncate max-w-[70px] dark:text-slate-400">{podium[1].display_name}</div>
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center text-2xl border-2 border-gray-300 dark:border-slate-600">
                    {avatarFor(podium[1].id)}
                  </div>
                  <div className="text-xs font-black text-gray-500 dark:text-slate-400">{podium[1].xp} XP</div>
                  <div className="w-14 h-12 bg-gradient-to-b from-gray-300 to-gray-400 rounded-t-lg flex items-center justify-center">
                    <span className="text-xl font-black text-white">2</span>
                  </div>
                </div>
              )}
              {/* 1st */}
              {podium[0] && (
                <div className="flex flex-col items-center gap-1 -mb-1">
                  <div className="text-xs font-black text-slate-900 truncate max-w-[80px] dark:text-slate-100">{podium[0].display_name}</div>
                  <div className="relative">
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-xl">👑</div>
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center text-2xl border-2 border-amber-400">
                      {avatarFor(podium[0].id)}
                    </div>
                  </div>
                  <div className="text-sm font-black text-amber-500">{podium[0].xp} XP</div>
                  <div className="w-16 h-16 bg-gradient-to-b from-amber-400 to-amber-500 rounded-t-lg flex items-center justify-center">
                    <span className="text-2xl font-black text-white">1</span>
                  </div>
                </div>
              )}
              {/* 3rd */}
              {podium[2] && (
                <div className="flex flex-col items-center gap-1">
                  <div className="text-xs font-bold text-gray-500 truncate max-w-[70px] dark:text-slate-400">{podium[2].display_name}</div>
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-700 to-amber-600 flex items-center justify-center text-2xl border-2 border-amber-600">
                    {avatarFor(podium[2].id)}
                  </div>
                  <div className="text-xs font-black text-amber-700">{podium[2].xp} XP</div>
                  <div className="w-14 h-8 bg-gradient-to-b from-amber-700 to-amber-600 rounded-t-lg flex items-center justify-center">
                    <span className="text-base font-black text-white">3</span>
                  </div>
                </div>
              )}
            </div>

            {/* List */}
            <div className="flex flex-col gap-2">
              {rest.map((entry, i) => (
                <div key={entry.id} className={`bg-white rounded-2xl shadow-sm p-3 flex items-center gap-3 dark:bg-slate-800 ${entry.id === profile?.id ? 'border-2 border-brand-300' : ''}`}>
                  <span className="text-xs font-bold text-gray-400 w-6 dark:text-slate-500">#{i + 4}</span>
                  <div className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/60 flex items-center justify-center text-base">{avatarFor(entry.id)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-900 truncate dark:text-slate-100">{entry.display_name}{entry.id === profile?.id ? ' (You)' : ''}</div>
                    <div className="text-[10px] text-gray-400 dark:text-slate-500">{entry.class_level}</div>
                  </div>
                  <div className="text-xs font-bold text-gray-500 dark:text-slate-400">{entry.xp} XP</div>
                  <div className="text-[10px] text-orange-500">🔥 {entry.streak_days}d</div>
                </div>
              ))}

              {/* My row — only shown separately if I'm outside the visible top 7 */}
              {myEntry && !myInTop7 && (
                <div className="bg-gradient-to-br from-brand-50 to-brand-100 border-2 border-brand-300 rounded-2xl p-3 flex items-center gap-3 dark:from-slate-950">
                  <span className="text-xs font-black text-brand-600 w-6">#{myEntry.rank}</span>
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-600 to-brand-500 flex items-center justify-center text-base">{avatarFor(myEntry.id)}</div>
                  <div className="flex-1">
                    <div className="text-xs font-bold text-brand-800 dark:text-brand-300">{myEntry.display_name} <span className="text-[10px] font-normal">(You)</span></div>
                    <div className="text-[10px] text-brand-600">{myEntry.class_level}</div>
                  </div>
                  <div className="text-xs font-black text-brand-600">{myEntry.xp} XP</div>
                  <div className="text-[10px] text-orange-500">🔥 {myEntry.streak_days}d</div>
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-sm p-4 text-center dark:bg-slate-800">
              <div className="text-xs font-bold text-slate-900 mb-1 dark:text-slate-100">Leaderboard</div>
              <div className="text-[10px] text-gray-400 dark:text-slate-500">Ranked by total XP — keep studying to climb higher</div>
              {myEntry && (
                <div className="mt-3 bg-brand-50 border border-brand-200 rounded-xl py-2 px-3 text-xs text-brand-700 font-semibold dark:bg-brand-950/40 dark:text-brand-400">
                  You're #{myEntry.rank} out of {rows.length} 🚀
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <BottomNav />
    </div>
  )
}