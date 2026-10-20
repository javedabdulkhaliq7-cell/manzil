// One-year validity of downloaded papers (Phase 11).
//
// A saved copy is valid for 365 days from the last successful ONLINE check. That check asks the
// server for the time, so the student cannot extend it by changing the phone's clock. While offline
// we can only use the phone's clock, so we also remember the latest time the phone has shown:
// if the clock is ever wound backwards, the copies stay locked until the student reconnects once.
import { supabase } from './supabase'
import { kvGet, kvSet, keys } from './offlineStore'

export const VALID_MS = 365 * 24 * 60 * 60 * 1000
export const CLOCK_TOLERANCE_MS = 5 * 60 * 1000

export type Validity = 'valid' | 'expired' | 'clock' | 'none'

export type ValidityMeta = {
  serverMs: number // the server's time at the last successful online check
  deviceMs: number // the phone's clock at that same moment
  maxDeviceMs: number // the latest phone-clock time ever seen since
}

export type ValidityResult = { status: Validity; maxDeviceMs: number; expiresAtMs: number | null }

// Pure rule, so it can be tested without a phone.
export function evaluateValidity(meta: ValidityMeta | undefined, now: number): ValidityResult {
  if (!meta) return { status: 'none', maxDeviceMs: now, expiresAtMs: null }
  const expiresAtMs = meta.deviceMs + VALID_MS
  if (now < meta.maxDeviceMs - CLOCK_TOLERANCE_MS) return { status: 'clock', maxDeviceMs: meta.maxDeviceMs, expiresAtMs }
  const maxDeviceMs = Math.max(meta.maxDeviceMs, now)
  if (now - meta.deviceMs >= VALID_MS) return { status: 'expired', maxDeviceMs, expiresAtMs }
  return { status: 'valid', maxDeviceMs, expiresAtMs }
}

export async function validityStatus(uid: string, now: number = Date.now()): Promise<ValidityResult> {
  const meta = await kvGet<ValidityMeta>(keys.meta(uid))
  const r = evaluateValidity(meta, now)
  if (meta && r.maxDeviceMs !== meta.maxDeviceMs) await kvSet(keys.meta(uid), { ...meta, maxDeviceMs: r.maxDeviceMs })
  return r
}

// Ask the server for the time and restart the 365 days. Returns false if we could not reach it.
export async function recordOnlineCheck(uid: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('server_time')
    if (error || !data) return false
    const serverMs = new Date(data as string).getTime()
    if (!Number.isFinite(serverMs)) return false
    const now = Date.now()
    await kvSet(keys.meta(uid), { serverMs, deviceMs: now, maxDeviceMs: now } satisfies ValidityMeta)
    return true
  } catch { return false }
}
