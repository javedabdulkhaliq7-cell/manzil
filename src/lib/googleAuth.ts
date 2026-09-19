// lib/googleAuth.ts
import { supabase } from './supabase'

/**
 * Kicks off the Google OAuth redirect. Works the same from Login or Signup —
 * Google doesn't distinguish "sign up" vs "sign in", it just authenticates
 * and Supabase creates the auth.users row (and, via the existing
 * on_auth_user_created trigger, the profiles row) automatically if this is
 * a first-time sign-in.
 *
 * Lands back on /auth/callback, which applies anything still pending
 * (a class picked on /select-class before this account existed, or a name
 * pulled from the Google profile) and then routes to /home.
 */
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  })
  if (error) throw error
}
