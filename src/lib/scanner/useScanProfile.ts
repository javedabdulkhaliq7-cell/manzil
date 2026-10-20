// IQRA Scanner — profile for the scanner screens, with an offline fallback.
// If the login session has expired while offline, AuthContext has no profile;
// the last-known profile cached on the phone is used instead so students can
// still reach their own scans (plan section 15A).
// Put at src/lib/scanner/useScanProfile.ts
import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { getCachedProfileObject } from '../localProfileCache'
import type { Profile } from '../supabase'

export function useScanProfile(): Profile | null {
  const { profile } = useAuth()
  const [cached, setCached] = useState<Profile | null>(null)
  useEffect(() => {
    if (profile) return
    getCachedProfileObject().then((p) => setCached((p as Profile | null) ?? null)).catch(() => {})
  }, [profile])
  return profile ?? cached
}
