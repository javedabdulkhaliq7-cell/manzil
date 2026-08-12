import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase, Profile } from '../lib/supabase'

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
    if (data) setProfile(data as Profile)
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

  return <AuthContext.Provider value={{ user, profile, loading, refreshProfile }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
