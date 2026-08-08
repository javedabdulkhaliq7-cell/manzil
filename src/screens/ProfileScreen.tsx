import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, BookOpen, LogOut, ChevronRight, Star, Flame, Trophy } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { getRank } from '../lib/constants'
import BottomNav from '../components/BottomNav'

const PREMIUM_FEATURES = [
  'Unlimited AI Tutor questions daily',
  'All chapters unlocked — all subjects',
  'Past papers 2015–2025 + downloads',
  'Personalized study plan + analytics',
  'Mock tests + Emergency Exam Mode',
]

export default function ProfileScreen() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [totalMcqs, setTotalMcqs] = useState<number | null>(null)
  const [districtRank, setDistrictRank] = useState<number | null>(null)

  useEffect(() => {
    async function loadStats() {
      if (!profile) return

      const { data: attempts } = await supabase
        .from('quiz_attempts')
        .select('total')
        .eq('user_id', profile.id)
      if (attempts) setTotalMcqs(attempts.reduce((acc, a) => acc + (a.total || 0), 0))

      if (profile.district) {
        const { data: districtRows } = await supabase
          .from('leaderboard')
          .select('id')
          .eq('district', profile.district)
          .order('xp', { ascending: false })
        if (districtRows) {
          const idx = districtRows.findIndex(r => r.id === profile.id)
          setDistrictRank(idx >= 0 ? idx + 1 : null)
        }
      }
    }
    loadStats()
  }, [profile])

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  if (!profile) return null

  const name = profile.full_name || profile.name || 'Student'
  const rank = getRank(profile.xp)
  const rankLabel = districtRank ? `#${districtRank}` : '—'
  const mcqLabel = totalMcqs === null ? '—' : totalMcqs.toLocaleString()

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Hero */}
      <div className="bg-gradient-to-br from-emerald-700 to-emerald-500 px-4 pt-8 pb-10 text-white text-center flex-shrink-0">
        <div className="w-16 h-16 rounded-full bg-white/25 flex items-center justify-center text-4xl mx-auto mb-3">👦</div>
        <div className="text-xl font-black">{name}</div>
        <div className="text-emerald-100 text-xs mt-0.5">{profile.class_level} · {profile.district}, Balochistan</div>
        <div className="flex gap-2 justify-center mt-3">
          {[
            { icon: Flame, val: `${profile.streak_days} Days`, color: 'text-orange-300' },
            { icon: Trophy, val: rankLabel,                     color: 'text-yellow-300' },
            { icon: Star, val: rank.badge + ' ' + rank.name,    color: 'text-yellow-200' },
          ].map(({ icon: Icon, val, color }) => (
            <div key={val} className="flex items-center gap-1 bg-white/20 rounded-full px-2.5 py-1">
              <Icon size={11} className={color} />
              <span className="text-[10px] font-bold">{val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stats float */}
      <div className="px-4 -mt-5 z-10">
        <div className="bg-white rounded-2xl shadow-md p-3 grid grid-cols-3 divide-x divide-gray-100">
          {[
            { val: mcqLabel,           label: 'MCQs Done',     color: 'text-slate-900' },
            { val: `${profile.xp} XP`, label: 'Total XP', color: 'text-amber-500' },
            { val: rankLabel,          label: 'District Rank', color: 'text-violet-600' },
          ].map(({ val, label, color }) => (
            <div key={label} className="flex flex-col items-center py-1">
              <span className={`text-sm font-black ${color}`}>{val}</span>
              <span className="text-[10px] text-gray-400">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {/* Premium CTA */}
        {profile.plan === 'free' && (
          <div className="bg-slate-900 rounded-2xl p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-xs font-black text-amber-400">⭐ Go Premium</div>
                <div className="text-2xl font-black text-white mt-1">
                  PKR 99<span className="text-sm font-normal text-slate-400">/month</span>
                </div>
                <div className="text-[10px] text-slate-400">or PKR 799/year — Save PKR 389</div>
              </div>
              <span className="bg-gradient-to-r from-amber-400 to-amber-500 text-white text-[9px] font-black px-2 py-1 rounded-lg">POPULAR</span>
            </div>
            <div className="flex flex-col gap-1.5 mb-4">
              {PREMIUM_FEATURES.map(f => (
                <div key={f} className="flex items-center gap-2">
                  <span className="text-emerald-400 text-xs">✓</span>
                  <span className="text-xs text-slate-200">{f}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => {
                const msg = encodeURIComponent(`Hi! I want to upgrade to Manzil Premium (PKR 99/month). My name is ${profile.full_name || profile.name}, Class: ${profile.class_level}, District: ${profile.district}.`)
                window.open(`https://wa.me/923152538457?text=${msg}`, '_blank')
              }}
              className="w-full bg-gradient-to-r from-amber-400 to-amber-500 text-white font-bold py-3.5 rounded-2xl text-sm active:scale-95 transition-all">
              Upgrade Now — PKR 99/month
            </button>
            <p className="text-[10px] text-slate-400 text-center mt-2">You will be contacted on WhatsApp to complete payment</p>
          </div>
        )}

        {profile.plan !== 'free' && (
          <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <div className="text-3xl">⭐</div>
              <div>
                <div className="text-sm font-black text-emerald-800">Premium Active</div>
                <div className="text-xs text-emerald-600">All features unlocked · Renews next month</div>
              </div>
            </div>
          </div>
        )}

        {/* Menu items */}
        <div className="flex flex-col gap-2">
          {[
            { icon: Bell,     label: 'Notifications',     action: () => {} },
            { icon: BookOpen, label: 'My Board & Class',  action: () => navigate('/onboarding-class') },
          ].map(({ icon: Icon, label, action }) => (
            <button
              key={label}
              onClick={action}
              className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3 active:scale-[0.99] transition-all"
            >
              <Icon size={18} className="text-emerald-600" />
              <span className="flex-1 text-sm font-semibold text-slate-900 text-left">{label}</span>
              <ChevronRight size={16} className="text-gray-400" />
            </button>
          ))}

          <button
            onClick={handleSignOut}
            className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3 active:scale-[0.99] transition-all"
          >
            <LogOut size={18} className="text-red-500" />
            <span className="flex-1 text-sm font-semibold text-red-500 text-left">Sign Out</span>
          </button>
        </div>

        {/* Footer */}
        <div className="text-center pb-4">
          <div className="text-[10px] text-gray-300">Version 1.0 · Built for Pakistani Students</div>
          <div className="text-[10px] text-gray-300 mt-0.5">Made in Balochistan 🇵🇰</div>
        </div>
      </div>

      <BottomNav />
    </div>
  )
}