import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type PremiumStatus = {
  status: 'free' | 'premium' | 'grace'
  ends_at: string | null
  grace_ends_at: string | null
  source: string | null
}

export const defaultPremiumStatus: PremiumStatus = {
  status: 'free',
  ends_at: null,
  grace_ends_at: null,
  source: null,
}

const PREMIUM_CACHE_KEY = 'iqra.premium.v1'

function safeReadCachedPremium(): PremiumStatus | null {
  try {
    const raw = localStorage.getItem(PREMIUM_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PremiumStatus
    if (!parsed || typeof parsed !== 'object') return null
    return {
      status: parsed.status === 'premium' || parsed.status === 'grace' ? parsed.status : 'free',
      ends_at: parsed.ends_at ?? null,
      grace_ends_at: parsed.grace_ends_at ?? null,
      source: parsed.source ?? null,
    }
  } catch {
    return null
  }
}

function safeWriteCachedPremium(status: PremiumStatus) {
  try {
    localStorage.setItem(PREMIUM_CACHE_KEY, JSON.stringify(status))
  } catch {
    // no-op: if storage is blocked, we gracefully degrade without crashing
  }
}

export async function getPremiumStatus(): Promise<PremiumStatus> {
  try {
    const { data, error } = await supabase.rpc('premium_status')

    if (error) throw error

    const payload = Array.isArray(data) ? data[0] : data
    if (!payload || typeof payload !== 'object') {
      const cached = safeReadCachedPremium()
      return cached ?? defaultPremiumStatus
    }

    const normalized: PremiumStatus = {
      status: payload.status === 'premium' || payload.status === 'grace' ? payload.status : 'free',
      ends_at: payload.ends_at ?? null,
      grace_ends_at: payload.grace_ends_at ?? null,
      source: payload.source ?? null,
    }

    safeWriteCachedPremium(normalized)
    return normalized
  } catch {
    const cached = safeReadCachedPremium()
    return cached ?? defaultPremiumStatus
  }
}

export function usePremium() {
  const [status, setStatus] = useState<PremiumStatus>(defaultPremiumStatus)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    void getPremiumStatus().then((next) => {
      if (!active) return
      setStatus(next)
      setLoading(false)
    }).catch(() => {
      if (!active) return
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [])

  return {
    ...status,
    isPremium: status.status === 'premium' || status.status === 'grace',
    loading,
  }
}
