import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { supabase, Profile } from '../lib/supabase'
import { refreshLocalProfileCache, getCachedProfileObject } from '../lib/localProfileCache'

type AuthCtx = {
  user: User | null
  profile: Profile | null
  loading: boolean
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthCtx>({ user: null, profile: null, loading: true, refreshProfile: async () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  async function fetchProfile(uid: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single()
    if (data) {
      setProfile(data as Profile)
      // Phase 6 — keep the offline-readable cache reconciled with real
      // server truth every time we successfully get a fresh profile.
      refreshLocalProfileCache(data as Profile)
      return
    }

    // Live fetch failed — most likely no connection (e.g. a cold app
    // launch in airplane mode). Without this fallback, `profile` stays
    // null forever and every screen that needs it (Home included)
    // renders nothing, even though we have a perfectly good last-known
    // copy sitting in local_profile_cache from the last time we were
    // online. This can only leave `profile` null if the app has never
    // been online while logged in at all — which shouldn't happen, since
    // logging in itself requires a connection.
    const cached = await getCachedProfileObject()
    if (cached && cached.id === uid) setProfile(cached)
  }

  async function refreshProfile() {
    if (user) await fetchProfile(user.id)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id).finally(() => setLoading(false))
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // A transient refresh failure (e.g. rate-limited, or racing another open
      // tab) can briefly report no session even though the user is still
      // genuinely logged in. Only actually clear the user on a real sign-out,
      // not on every null-session event.
      if (event === 'SIGNED_OUT') {
        setUser(null)
        setProfile(null)
        return
      }
      if (session?.user) {
        setUser(session.user)
        fetchProfile(session.user.id)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Native-only: catches the redirect back from Google's in-app browser tab
  // (see lib/googleAuth.ts). Web never fires 'appUrlOpen' — it still uses
  // the normal /auth/callback page route, untouched.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const listenerPromise = CapacitorApp.addListener('appUrlOpen', async ({ url }) => {
      // url looks like: com.iqrastudy.app://auth/callback#access_token=...&refresh_token=...
      if (!url.includes('auth/callback')) return

      // Supabase puts the session in the URL fragment (after #), same as
      // the web redirect — parsed by hand since there's no browser
      // location object on native to read it from automatically.
      const hashIndex = url.indexOf('#')
      if (hashIndex !== -1) {
        const params = new URLSearchParams(url.slice(hashIndex + 1))
        const access_token = params.get('access_token')
        const refresh_token = params.get('refresh_token')
        if (access_token && refresh_token) {
          // Triggers the onAuthStateChange handler above, which sets
          // user/profile the same way a normal sign-in does.
          await supabase.auth.setSession({ access_token, refresh_token })
        }
      }

      // Close the in-app browser tab Browser.open() launched.
      await Browser.close().catch(() => {})
    })

    return () => { listenerPromise.then(l => l.remove()) }
  }, [])

  return <AuthContext.Provider value={{ user, profile, loading, refreshProfile }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
