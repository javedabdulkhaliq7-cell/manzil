import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { User, MapPin } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedNotice, setSavedNotice] = useState('')

  async function handleSave() {
    if (!user) return
    const trimmedName = fullName.trim()

    // Save whatever's actually filled in — don't lose a district pick
    // just because Name is still empty, or vice versa. Only complain if
    // NEITHER has anything to save.
    const patch: Record<string, string> = {}
    if (trimmedName) { patch.full_name = trimmedName; patch.name = trimmedName }
    if (district) patch.district = district

    if (Object.keys(patch).length === 0) {
      setError('Add your name or district to continue')
      return
    }

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

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-brand-200 disabled:opacity-60 active:scale-95 transition-all mt-2"
        >
          {saving ? 'Saving…' : 'Save & Continue'}
        </button>
      </div>
    </div>
  )
}
