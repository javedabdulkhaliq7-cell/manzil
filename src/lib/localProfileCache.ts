// lib/localProfileCache.ts
//
// local_profile_cache read/write helpers. Two jobs:
// (1) Phase 6 — the "last-known server truth" a screen reads specific
//     fields from when offline (hearts, plan), instead of AuthContext's
//     in-memory `profile`, which offline heart/XP changes deliberately
//     don't mutate directly.
// (2) The AuthContext fallback — when a cold app launch has no connection
//     at all, the live profile fetch fails and `profile` would otherwise
//     stay null forever, blanking every profile-gated screen (Home
//     included). getCachedProfileObject() gives AuthContext the whole
//     last-known profile to use instead.
//
// NOTE: FREE_HEARTS_MAX and the local-date format below are intentionally
// duplicated from progress.ts rather than imported — progress.ts needs to
// call INTO this file (to persist an offline heart loss), and importing
// the other way too would create a circular import between the two
// modules. Keep these two constants in sync with progress.ts by hand if
// either changes.

import { offlineDb, type LocalProfileCache } from './offlineDb'
import { Profile } from './supabase'

const CACHE_ID = 'current' as const
const FREE_HEARTS_MAX_LOCAL = 5 // must match progress.ts's FREE_HEARTS_MAX

function localTodayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Called every time AuthContext gets a fresh profile from the server —
 *  keeps the cache reconciled with real server truth ("the server's real
 *  count wins once reachable" per the spec). */
export async function refreshLocalProfileCache(profile: Profile): Promise<void> {
  await offlineDb.local_profile_cache.put({
    id: CACHE_ID,
    profile,
    cachedAt: new Date().toISOString(),
  })
}

export async function getLocalProfileCache(): Promise<LocalProfileCache | undefined> {
  return offlineDb.local_profile_cache.get(CACHE_ID)
}

/** The whole last-known profile, or null if nothing's cached yet (only
 *  possible if the app has literally never been online while logged in,
 *  which shouldn't happen — logging in itself requires a connection). Used
 *  by AuthContext as a fallback when the live fetch fails. */
export async function getCachedProfileObject(): Promise<Profile | null> {
  const cache = await getLocalProfileCache()
  return cache?.profile ?? null
}

/** Hearts remaining right now, per the cache — same lazy-daily-reset shape
 *  as progress.ts's heartsRemaining(), just against the cached row instead
 *  of a live Profile. Use this when offline. */
export function heartsRemainingFromCache(cache: LocalProfileCache): number {
  const p = cache.profile
  if (p.plan !== 'free') return Infinity
  if (p.hearts_reset_date !== localTodayStr()) return FREE_HEARTS_MAX_LOCAL
  return p.hearts_current
}

/** Persists a heart loss into the cache immediately — the offline
 *  counterpart to the server write in loseHeart(). Called from
 *  loseHeart() itself when it detects there's no connection. */
export async function recordLocalHeartLoss(newHearts: number): Promise<void> {
  const existing = await getLocalProfileCache()
  if (!existing) return // shouldn't normally happen — the app requires being online at least once (to log in) before any offline session
  const updatedProfile: Profile = {
    ...existing.profile,
    hearts_current: newHearts,
    hearts_reset_date: localTodayStr(),
  }
  await offlineDb.local_profile_cache.update(CACHE_ID, {
    profile: updatedProfile,
    cachedAt: new Date().toISOString(),
  })
}
