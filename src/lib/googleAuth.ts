// lib/googleAuth.ts
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { supabase } from './supabase'

// Native builds (Android/Capacitor) can't land back on a normal https URL —
// there's no "tab" for Android to hand back to IQRA specifically, so it
// just stays a website. Instead, native uses a custom URL scheme
// (registered in AndroidManifest.xml) that Android CAN route straight back
// into the app. The web build (iqrastudy.netlify.app) is untouched — it
// keeps using the same https redirect as before.
const REDIRECT_URL = Capacitor.isNativePlatform()
  ? 'com.iqrastudy.app://auth/callback'
  : `${window.location.origin}/auth/callback`

/**
 * Kicks off the Google OAuth redirect. Works the same from Login or Signup —
 * Google doesn't distinguish "sign up" vs "sign in", it just authenticates
 * and Supabase creates the auth.users row (and, via the existing
 * on_auth_user_created trigger, the profiles row) automatically if this is
 * a first-time sign-in.
 *
 * Web: lands back on /auth/callback as before, which applies anything still
 * pending and routes to /home.
 * Native: lands back via the 'appUrlOpen' listener in AuthContext.tsx,
 * which hands the session to Supabase and closes the in-app browser tab.
 */
export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: REDIRECT_URL,
      // On native there's no page for Supabase to redirect — we open the
      // URL ourselves right below, in an in-app browser tab instead of the
      // system browser (so it doesn't fully leave the app).
      skipBrowserRedirect: Capacitor.isNativePlatform(),
    },
  })
  if (error) throw error

  // Web: Supabase already navigated the page itself — nothing more to do.
  if (!Capacitor.isNativePlatform()) return

  // Native: open Google's sign-in page in an in-app browser tab.
  if (data?.url) {
    await Browser.open({ url: data.url })
  }
}
