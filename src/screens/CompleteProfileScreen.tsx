import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { User, MapPin, School, GraduationCap, Eye, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { AVATAR_SEEDS, avatarUrl } from '../lib/constants'

const DISTRICTS = ['Quetta','Turbat','Gwadar','Khuzdar','Zhob','Sibi','Loralai','Kharan','Nushki','Chaman','Hub','Kalat','Mastung','Panjgur']

// Collects the two fields deliberately skipped at signup (Google or email
// code) — Name and District. Reached two ways: gated from Leaderboard
// (functionally needs a district to rank against), or opened directly
// from Profile whenever the student wants to fill it in.
export default function CompleteProfileScreen() {
  const { user, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo ?? '/profile'

  const [fullName, setFullName] = useState(profile?.full_name && profile.full_name !== '' ? profile.full_name : '')
  const [district, setDistrict] = useState(profile?.district ?? '')
  const [avatarId, setAvatarId] = useState(profile?.avatar_id ?? 1)
  const [schoolName, setSchoolName] = useState(profile?.school_name ?? '')
  const [showSchool, setShowSchool] = useState(profile?.show_school ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedNotice, setSavedNotice] = useState('')

  async function handleSave() {
    if (!user) return
    const trimmedName = fullName.trim()

    // Save whatever's actually filled in — don't lose a district pick
    // just because Name is still empty, or vice versa. Only complain if
    // NEITHER has anything to save.
    const patch: Record<string, string | number | boolean> = {}
    if (trimmedName) { patch.full_name = trimmedName; patch.name = trimmedName }
    if (district) patch.district = district

    if (Object.keys(patch).length === 0 && avatarId === (profile?.avatar_id ?? 1) && schoolName === (profile?.school_name ?? '') && showSchool === (profile?.show_school ?? false)) {
      setError('Add your name or district to continue')
      return
    }

    // Avatar/school are optional and always saved alongside whatever else
    // changed — they never block the name/district completion gate below.
    patch.avatar_id = avatarId
    patch.school_name = schoolName.trim()
    patch.show_school = showSchool

    setSaving(true); setError('')
    const { error: err } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', user.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    await refreshProfile()

    // Only leave the screen once BOTH are actually set (this save plus
    // whatever was already on the profile) — otherwise the Leaderboard
    // gate would just send them straight back here anyway.
    const nowHasName = !!(trimmedName || profile?.full_name)
    const nowHasDistrict = !!(district || profile?.district)
    if (nowHasName && nowHasDistrict) {
      navigate(returnTo, { replace: true })
    } else {
      setSavedNotice(nowHasName ? 'Name saved — add your district to finish.' : 'District saved — add your name to finish.')
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-slate-950">
      <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-6 pt-12 pb-8 text-white">
        <h1 className="text-xl font-bold">Complete Your Profile</h1>
        <p className="text-brand-100 text-sm mt-1">Add your name and district to appear on the leaderboard</p>
      </div>

      <div className="flex-1 px-6 pt-6 flex flex-col gap-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl dark:bg-red-950/40">
            {error}
          </div>
        )}

        {savedNotice && (
          <div className="bg-brand-50 border border-brand-200 text-brand-700 text-sm px-4 py-3 rounded-xl dark:bg-brand-950/40 dark:text-brand-400">
            {savedNotice}
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1.5 block dark:text-slate-300">Full Name</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" size={16} />
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Ahmed Raza"
              className="w-full border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-900 bg-white focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1.5 block dark:text-slate-300">District</label>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" size={16} />
            <select
              value={district}
              onChange={e => setDistrict(e.target.value)}
              className="w-full border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 bg-white appearance-none dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"
            >
              <option value="" disabled>Select your district</option>
              {DISTRICTS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
        </div>

        {profile?.class_level && (
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1.5 block dark:text-slate-300">Class</label>
            <div className="flex items-center gap-3 border border-gray-200 rounded-xl px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
              <GraduationCap className="text-gray-400 dark:text-slate-500" size={16} />
              <span className="flex-1 text-sm text-slate-900 dark:text-slate-100">{profile.class_level}</span>
            </div>
            {/* Always shown, no opt-out — not sensitive enough to need one,
                same as district/rank/streak/score. Editable via Profile ->
                "My Board & Class", not here — this is just a readout. */}
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1.5 block dark:text-slate-300">Avatar</label>
          <div className="grid grid-cols-5 gap-2">
            {AVATAR_SEEDS.map((_, i) => {
              const id = i + 1
              const selected = avatarId === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAvatarId(id)}
                  className={`aspect-square rounded-2xl overflow-hidden border-2 transition-all ${
                    selected ? 'border-brand-500 ring-2 ring-brand-200 dark:ring-brand-900/50' : 'border-gray-200 dark:border-slate-700'
                  }`}
                >
                  <img src={avatarUrl(id)} alt={`Avatar ${id}`} className="w-full h-full object-cover" />
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1.5 block dark:text-slate-300">Place of Learning (optional)</label>
          <div className="relative">
            <School className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" size={16} />
            <input
              type="text"
              value={schoolName}
              onChange={e => setSchoolName(e.target.value)}
              placeholder="Your school or academy"
              className="w-full border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-900 bg-white focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          {/* Hidden by default (show_school defaults false) — this is the
              only control that flips it, so a student always has to opt in
              before classmates can see it on the leaderboard. */}
          <button
            type="button"
            onClick={() => setShowSchool(v => !v)}
            className="flex items-center gap-2 mt-2 text-xs font-medium text-gray-500 dark:text-slate-400"
          >
            {showSchool ? <Eye size={14} className="text-brand-500" /> : <EyeOff size={14} />}
            {showSchool ? 'Visible to other students on the leaderboard' : 'Hidden from other students'}
          </button>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-brand-200 dark:shadow-black/30 disabled:opacity-60 active:scale-95 transition-all mt-2"
        >
          {saving ? 'Saving…' : 'Save & Continue'}
        </button>
      </div>
    </div>
  )
}
