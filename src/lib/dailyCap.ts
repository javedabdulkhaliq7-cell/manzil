// dailyCap.ts
//
// Shared premium-cap check: free tier gets DAILY_CAP uses/subject/day,
// premium is unlimited (caller decides whether to call this at all —
// see usage in both exerciseTestEngine.ts and MockTestPrintView.tsx,
// both of which skip calling this entirely when isPremium is true).
//
// Reset boundary is Pakistan LOCAL midnight, not server time / not a
// rolling 24h window. Backed by the daily_feature_caps table
// (daily_feature_caps_migration.sql) — one row per (user, subject,
// feature, date).

import { supabase } from './supabase'

export const DAILY_CAP = 3

// Single shared feature key — Mock Test printable and Exercise Test
// Custom draw against the SAME counter, per subject per day. Using
// either one counts against the other's remaining allowance for that
// subject. If these should ever be split back into independent counts,
// just use two different strings at the call sites instead of this one.
export const SHARED_PRINTABLE_FEATURE = 'printable_or_custom_daily'

export function pakistanLocalDate(): string {
  // Pakistan Standard Time is fixed UTC+5, no DST — safe to compute via offset.
  const now = new Date()
  const pkt = new Date(now.getTime() + 5 * 60 * 60 * 1000)
  return pkt.toISOString().slice(0, 10) // YYYY-MM-DD
}

/**
 * Throws if the free-tier daily cap is already reached; otherwise
 * increments the counter and returns. Call this ONLY for non-premium
 * users — premium should never call this at all, not "call it but it
 * always passes".
 *
 * Implemented as a single atomic RPC call to check_and_consume_daily_cap
 * (see daily_cap_atomic_fn.sql) rather than a separate SELECT then
 * UPSERT from here — the old two-step version had a real race window:
 * two near-simultaneous calls for the same user (double-tap, two open
 * tabs) could both read the same used_count before either wrote back,
 * both pass the < DAILY_CAP check, and both increment, letting the cap
 * go soft by one. The Postgres function does the check-and-increment as
 * one statement under the unique index's row lock, so concurrent calls
 * genuinely serialize instead of racing.
 */
export async function checkAndConsumeCap(userId: string, subjectId: string, feature: string): Promise<void> {
  const usageDate = pakistanLocalDate()

  const { error } = await supabase.rpc('check_and_consume_daily_cap', {
    p_user_id: userId,
    p_subject_id: subjectId,
    p_feature: feature,
    p_usage_date: usageDate,
    p_cap: DAILY_CAP,
  })

  if (error) {
    // DAILY_CAP_REACHED is the function's deliberate signal that the cap
    // is hit — surface the same friendly message the old code threw.
    // Anything else is a real unexpected error and should propagate as-is.
    if (error.message?.includes('DAILY_CAP_REACHED')) {
      throw new Error(`Daily limit reached (${DAILY_CAP}/subject/day). Try again after Pakistan midnight.`)
    }
    throw error
  }
}

/** Read-only check (no increment) — for showing remaining count in UI before a draw. */
export async function getCapUsage(userId: string, subjectId: string, feature: string): Promise<{ used: number; limit: number }> {
  const usageDate = pakistanLocalDate()
  const { data, error } = await supabase
    .from('daily_feature_caps')
    .select('used_count')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .eq('feature', feature)
    .eq('usage_date', usageDate)
    .maybeSingle()
  if (error) throw error
  return { used: data?.used_count ?? 0, limit: DAILY_CAP }
}
