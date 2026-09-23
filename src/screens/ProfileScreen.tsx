import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, BookOpen, LogOut, ChevronRight, Star, Flame, Trophy, Sun, Moon, Monitor, UserCircle, Shield, FileText, Target } from 'lucide-react'
import { supabase, Subject } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { getRank, avatarUrl, SUBJECT_COLORS } from '../lib/constants'
import BottomNav from '../components/BottomNav'

const PREMIUM_FEATURES = [
  'Unlimited AI Tutor questions daily',
  'All chapters unlocked — all subjects',
  'Past papers 2015–2025 + downloads',
  'Personalized study plan + analytics',
  'Mock tests + Emergency Exam Mode',
]

// Same per-subject accent gradients ProgressScreen.tsx used for its
// progress bars — kept as-is now that the section lives here instead.
const PROGRESS_COLORS: Record<string, string> = {
  bio:  'from-brand-600 to-brand-400',
  chem: 'from-blue-600 to-blue-400',
  phy:  'from-orange-500 to-orange-400',
  math: 'from-violet-600 to-violet-400',
  eng:  'from-red-500 to-red-400',
  urdu: 'from-teal-600 to-teal-400',
}

type SubjectProgress = { subject: Subject; pct: number }

export default function ProfileScreen() {
  const { profile } = useAuth()
  const { mode, setMode } = useTheme()
  const navigate = useNavigate()
  const [totalMcqs, setTotalMcqs] = useState<number | null>(null)
  const [districtRank, setDistrictRank] = useState<number | null>(null)
  const [leaderboardScore, setLeaderboardScore] = useState<number | null>(null)

  // Subject-level progress — moved here from the retired ProgressScreen.tsx
  // (Stats tab). Private, self-only data — never shown on another
  // student's tap-through profile from the leaderboard.
  const [subjectProgress, setSubjectProgress] = useState<SubjectProgress[]>([])
  const [weakestSubject, setWeakestSubject] = useState<SubjectProgress | null>(null)
  const [notStartedCount, setNotStartedCount] = useState(0)
  // Count of quiz sessions — distinct from totalMcqs (sum of MCQs answered
  // across those sessions). Dropped by mistake in the ProgressScreen merge;
  // restoring it here, derived from the same fetch below at no extra cost.
  const [totalAttempts, setTotalAttempts] = useState<number | null>(null)

  useEffect(() => {
    async function loadStats() {
      if (!profile) return

      const { data: attempts } = await supabase
        .from('quiz_attempts')
        .select('total')
        .eq('user_id', profile.id)
      if (attempts) {
        setTotalMcqs(attempts.reduce((acc, a) => acc + (a.total || 0), 0))
        setTotalAttempts(attempts.length)
      }

      // Ranks are computed server-side by the leaderboard view's RANK()
      // window functions now — a single own-row lookup replaces the old
      // client-side "fetch the whole district, order by xp, find my
      // index" scan.
      const { data: myRow } = await supabase
        .from('leaderboard')
        .select('district_rank, score')
        .eq('id', profile.id)
        .single()
      if (myRow) {
        setDistrictRank(myRow.district_rank)
        setLeaderboardScore(myRow.score)
      }
    }
    loadStats()
  }, [profile])

  useEffect(() => {
    async function loadSubjectProgress() {
      if (!profile) return

      const { data: subjects } = await supabase
        .from('subjects')
        .select('*')
        .eq('class_level', profile.class_level ?? 'Class 9')
        .order('name')

      if (subjects) {
        const results: SubjectProgress[] = []
        for (const sub of subjects) {
          const { data: rows } = await supabase
            .from('user_progress')
            .select('completion_pct')
            .eq('user_id', profile.id)
            .eq('subject_id', sub.id)
          // Untouched chapters count as 0%, denominator is the subject's
          // real total chapter count — averaging only over chapters with a
          // user_progress row would inflate partially-started subjects.
          const totalPct = (rows ?? []).reduce((acc, r) => acc + r.completion_pct, 0)
          const pct = sub.chapter_count > 0 ? Math.round(totalPct / sub.chapter_count) : 0
          results.push({ subject: sub, pct })
        }
        setSubjectProgress(results)
        // A never-touched 0% isn't "weak", it's just not started — only
        // subjects with at least one attempt count toward "weakest".
        const started = results.filter(r => r.pct > 0)
        setNotStartedCount(results.length - started.length)
        if (started.length > 0) {
          setWeakestSubject(started.reduce((a, b) => (a.pct <= b.pct ? a : b)))
        }
      }
    }
    loadSubjectProgress()
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
  const attemptsLabel = totalAttempts === null ? '—' : totalAttempts.toLocaleString()
  const scoreLabel = leaderboardScore === null ? '—' : leaderboardScore.toLocaleString()
  const profileIncomplete = !profile.full_name || !profile.district

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      {/* Hero */}
      <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 pt-8 pb-10 text-white text-center flex-shrink-0">
        <div className="w-16 h-16 rounded-full bg-white/25 mx-auto mb-3 overflow-hidden">
          <img src={avatarUrl(profile.avatar_id)} alt={name} className="w-full h-full object-cover" />
        </div>
        <div className="text-xl font-bold">{name}</div>
        <div className="text-brand-100 text-xs mt-0.5">{profile.class_level} · {profile.district ?? 'District not set'}, Balochistan</div>
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
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-md p-3 grid grid-cols-4 divide-x divide-gray-100 dark:divide-slate-700">
          {[
            { val: mcqLabel,      label: 'MCQs Done',     color: 'text-slate-900 dark:text-slate-100' },
            { val: attemptsLabel, label: 'Attempts',      color: 'text-slate-900 dark:text-slate-100' },
            { val: scoreLabel,    label: 'Score',          color: 'text-brand-600 dark:text-brand-400' },
            { val: rankLabel,     label: 'District Rank', color: 'text-violet-600 dark:text-violet-400' },
          ].map(({ val, label, color }) => (
            <div key={label} className="flex flex-col items-center py-1">
              <span className={`text-sm font-bold ${color}`}>{val}</span>
              <span className="text-[10px] text-gray-400 dark:text-slate-500">{label}</span>
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
                <div className="text-xs font-bold text-amber-400">⭐ Go Premium</div>
                <div className="text-2xl font-black text-white mt-1">
                  PKR 99<span className="text-sm font-normal text-slate-400">/month</span>
                </div>
                <div className="text-[10px] text-slate-400">or PKR 799/year — Save PKR 389</div>
              </div>
              <span className="bg-gradient-to-r from-amber-400 to-amber-500 text-white text-[9px] font-bold px-2 py-1 rounded-lg">POPULAR</span>
            </div>
            <div className="flex flex-col gap-1.5 mb-4">
              {PREMIUM_FEATURES.map(f => (
                <div key={f} className="flex items-center gap-2">
                  <span className="text-brand-400 text-xs">✓</span>
                  <span className="text-xs text-slate-200">{f}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => {
                const msg = encodeURIComponent(`Hi! I want to upgrade to Manzil Premium (PKR 99/month). My name is ${profile.full_name || profile.name}, Class: ${profile.class_level}, District: ${profile.district}.`)
                window.open(`https://wa.me/923703695551?text=${msg}`, '_blank')
              }}
              className="w-full bg-gradient-to-r from-amber-400 to-amber-500 text-white font-bold py-3.5 rounded-2xl text-sm active:scale-95 transition-all">
              Upgrade Now — PKR 99/month
            </button>
            <p className="text-[10px] text-slate-400 text-center mt-2">You will be contacted on WhatsApp to complete payment</p>
          </div>
        )}

        {profile.plan !== 'free' && (
          <div className="bg-gradient-to-br from-brand-50 to-brand-100 dark:from-brand-950/40 dark:to-brand-900/30 border border-brand-200 dark:border-brand-800 rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <div className="text-3xl">⭐</div>
              <div>
                <div className="text-sm font-bold text-brand-800 dark:text-brand-300">Premium Active</div>
                <div className="text-xs text-brand-600 dark:text-brand-400">All features unlocked · Renews next month</div>
              </div>
            </div>
          </div>
        )}

        {/* Subject Progress — moved here from the retired Stats tab.
            Private, self-only: never shown on another student's
            leaderboard profile sheet. */}
        <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
          <div className="flex items-center gap-2 mb-3">
            <Target size={14} className="text-brand-600 dark:text-brand-400" />
            <div className="text-xs font-bold text-slate-900 dark:text-slate-100">Subject Best Scores</div>
          </div>
          <div className="flex flex-col gap-3">
            {subjectProgress.map(({ subject, pct }) => {
              const colors = SUBJECT_COLORS[subject.color_class] ?? SUBJECT_COLORS.bio
              const progressColor = PROGRESS_COLORS[subject.color_class] ?? PROGRESS_COLORS.bio
              return (
                <div key={subject.id}>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">{subject.emoji} {subject.name}</span>
                    <span className={`text-xs font-bold ${colors.text}`}>{pct}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden dark:bg-slate-700">
                    <div className={`h-full bg-gradient-to-r ${progressColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
            {subjectProgress.length === 0 && (
              <div className="text-xs text-gray-400 text-center py-4 dark:text-slate-500">No subjects available for {profile.class_level} yet.</div>
            )}
          </div>
        </div>

        {/* Real insight — only shown once there's enough data to say something true */}
        {weakestSubject ? (
          <div className="bg-slate-900 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">📊</span>
              <span className="text-xs font-bold text-brand-400">Weekly Insight</span>
            </div>
            <p className="text-xs text-slate-200 leading-relaxed">
              Among subjects you've started, {weakestSubject.subject.name} is your weakest at {weakestSubject.pct}%. A bit more practice there could help the most.
              {notStartedCount > 0 && ` You also haven't started ${notStartedCount} subject${notStartedCount > 1 ? 's' : ''} yet — worth a look too.`}
            </p>
          </div>
        ) : (
          <div className="bg-slate-900 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">📊</span>
              <span className="text-xs font-bold text-brand-400">Weekly Insight</span>
            </div>
            <p className="text-xs text-slate-200 leading-relaxed">
              Complete a few chapters and quizzes — your personalized insights will show up here once there's enough data.
            </p>
          </div>
        )}

        {/* Theme toggle */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4">
          <div className="flex items-center gap-3 mb-3">
            <Sun size={18} className="text-brand-600 dark:text-brand-400" />
            <span className="flex-1 text-sm font-semibold text-slate-900 dark:text-slate-100">Appearance</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { key: 'light' as const, label: 'Light', icon: Sun },
              { key: 'dark' as const, label: 'Dark', icon: Moon },
              { key: 'system' as const, label: 'System', icon: Monitor },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                  mode === key
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-300'
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Menu items */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => navigate('/complete-profile', { state: { returnTo: '/profile' } })}
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 flex items-center gap-3 active:scale-[0.99] transition-all"
          >
            <UserCircle size={18} className="text-brand-600 dark:text-brand-400" />
            <span className="flex-1 text-sm font-semibold text-slate-900 dark:text-slate-100 text-left">
              {/* Renamed from "Edit Name & District" — this same screen now
                  also covers avatar and place-of-learning, so the label
                  shouldn't undersell what's editable here. */}
              {profileIncomplete ? 'Complete Your Profile' : 'Edit Profile'}
            </span>
            {profileIncomplete && (
              <span className="w-2 h-2 rounded-full bg-brand-500" />
            )}
            <ChevronRight size={16} className="text-gray-400" />
          </button>

          {[
            { icon: Bell,     label: 'Notifications',     action: () => {} },
            { icon: BookOpen, label: 'My Board & Class',  action: () => navigate('/onboarding-class') },
            { icon: Shield,   label: 'Privacy Policy',    action: () => window.open('/privacy.html', '_blank') },
            { icon: FileText, label: 'Terms of Service',  action: () => window.open('/terms.html', '_blank') },
          ].map(({ icon: Icon, label, action }) => (
            <button
              key={label}
              onClick={action}
              className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 flex items-center gap-3 active:scale-[0.99] transition-all"
            >
              <Icon size={18} className="text-brand-600 dark:text-brand-400" />
              <span className="flex-1 text-sm font-semibold text-slate-900 dark:text-slate-100 text-left">{label}</span>
              <ChevronRight size={16} className="text-gray-400" />
            </button>
          ))}

          <button
            onClick={handleSignOut}
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 flex items-center gap-3 active:scale-[0.99] transition-all"
          >
            <LogOut size={18} className="text-red-500" />
            <span className="flex-1 text-sm font-semibold text-red-500 text-left">Sign Out</span>
          </button>
        </div>

        {/* Footer */}
        <div className="text-center pb-4">
          <div className="text-[10px] text-gray-300 dark:text-slate-600">Version 1.0 · Built for Pakistani Students</div>
          <div className="text-[10px] text-gray-300 dark:text-slate-600 mt-0.5">Made in Balochistan 🇵🇰</div>
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
