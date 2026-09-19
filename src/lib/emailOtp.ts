// lib/emailOtp.ts
//
// Passwordless email auth — Claude.ai-style: type email, get a 6-digit
// code, enter it, done. Works for both new and returning users: Supabase
// creates the account automatically on first use (shouldCreateUser: true),
// and just logs an existing account straight in on repeat use — no
// separate "signup" vs "login" mechanism needed under the hood.
//
// Requires the Magic Link email template (Supabase dashboard -> Auth ->
// Email Templates) to include {{ .Token }} — otherwise Supabase sends a
// clickable link instead of a typed code.

import { supabase } from './supabase'

export async function sendEmailOtp(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      // If the person clicks the link in the email instead of typing the
      // code, this is where it lands — same callback screen Google OAuth
      // uses, so a pending class from /select-class still gets applied.
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  })
  if (error) throw error
}

export async function verifyEmailOtp(email: string, code: string) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: 'email',
  })
  if (error) throw error
  return data
}
