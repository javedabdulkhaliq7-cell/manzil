// screens/AuthCallbackScreen.tsx
// Landing point for the Google OAuth redirect (see lib/googleAuth.ts).
// Not wrapped in ProtectedRoute — right after the redirect there's a brief
// window where the session is still being parsed, and ProtectedRoute would
// bounce that to "/" before it resolves. This screen waits for useAuth's
// own loading flag instead, then finishes setup and moves on itself.

import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const PENDING_CLASS_KEY = 'iqra_pending_class'

export default function AuthCallbackScreen() {
  const { user, profile, loading, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const applied = useRef(false)

  useEffect(() => {
    if (loading || !user || applied.current) return
    applied.current = true

    async function finish() {
      const pendingClass = localStorage.getItem(PENDING_CLASS_KEY)
      const patch: Record<string, string> = {}

      // Only fill in from Google if the profile doesn't already have it —
      // never overwrite a name/class the student already set some other way.
      const googleName =
        (user!.user_metadata as any)?.full_name || (user!.user_metadata as any)?.name
      if (googleName && !profile?.full_name) {
        patch.full_name = googleName
        patch.name = googleName
      }
      if (pendingClass && !profile?.class_level) {
        patch.class_level = pendingClass
      }

      if (Object.keys(patch).length > 0) {
        await supabase.from('profiles').update(patch).eq('id', user!.id)
        await refreshProfile()
      }
      localStorage.removeItem(PENDING_CLASS_KEY)

      // Set by SignupScreen's Google button only — a returning user who
      // signs in with Google via /login never has this flag, so they skip
      // straight to /home instead of seeing the welcome flow again.
      const isNewSignup = localStorage.getItem('iqra_new_signup') === 'true'
      localStorage.removeItem('iqra_new_signup')
      navigate(isNewSignup ? '/welcome-moment' : '/home', { replace: true })
    }
    finish()
  }, [loading, user, profile, navigate, refreshProfile])

  useEffect(() => {
    // Safety net: OAuth cancelled/failed and no session ever showed up —
    // don't leave the user stranded on a blank screen.
    if (loading || user) return
    const t = setTimeout(() => navigate('/login', { replace: true }), 3000)
    return () => clearTimeout(t)
  }, [loading, user, navigate])

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-slate-950">
      <div className="text-sm text-gray-400 dark:text-slate-500">Signing you in…</div>
    </div>
  )
}
