import { supabase } from './supabase'

export type PublicSettings = {
  'limit.hearts_max': number
  'limit.free_ai_per_day': number
  'limit.free_mock_per_subject_per_day': number
  'limit.free_paper_per_subject_per_day': number
  'limit.free_offline_chapters': number
  'limit.premium_ai_per_day'?: number
  'premium.reminder_days': number
  'premium.grace_days': number
  'payment.hold_days': number
  'welcome.premium_days': number
  'ads.enabled': boolean
  'ads.new_user_free_days': number
  'app.min_version': string
  'ai.global_daily_cap'?: number
  'ai.kill_switch'?: boolean
  'ai.max_message_chars'?: number
}

export const fallbackPublicSettings: PublicSettings = {
  'limit.hearts_max': 5,
  'limit.free_ai_per_day': 10,
  'limit.free_mock_per_subject_per_day': 1,
  'limit.free_paper_per_subject_per_day': 1,
  'limit.free_offline_chapters': 2,
  'premium.reminder_days': 3,
  'premium.grace_days': 3,
  'payment.hold_days': 3,
  'welcome.premium_days': 3,
  'ads.enabled': true,
  'ads.new_user_free_days': 2,
  'app.min_version': '0.0.0',
}

const PRIVATE_KEYS = new Set([
  'limit.premium_ai_per_day',
  'ai.global_daily_cap',
  'ai.kill_switch',
  'ai.max_message_chars',
])

function normalizeSettingsObject(raw: Record<string, unknown> | null | undefined): PublicSettings {
  if (!raw) return fallbackPublicSettings

  const merged = { ...fallbackPublicSettings }
  Object.entries(raw).forEach(([key, value]) => {
    if (value === undefined || value === null) return
    if (key in merged) {
      ;(merged as Record<string, unknown>)[key] = value as never
    }
  })

  return merged as PublicSettings
}

export async function getPublicSettings(): Promise<PublicSettings> {
  try {
    const { data, error } = await supabase.rpc('get_public_settings')
    if (error) throw error

    if (!data || typeof data !== 'object') return fallbackPublicSettings
    return normalizeSettingsObject(data as Record<string, unknown>)
  } catch {
    return fallbackPublicSettings
  }
}

export async function getSetting<T = unknown>(key: string, fallback?: T): Promise<T | null> {
  try {
    const { data, error } = await supabase.rpc('get_setting', { p_key: key })
    if (error) {
      if (fallback !== undefined) return fallback
      return null
    }

    if (data === null || data === undefined) {
      if (fallback !== undefined) return fallback
      return null
    }

    return (data as T) ?? (fallback as T)
  } catch {
    if (fallback !== undefined) return fallback
    return null
  }
}

export function isPrivateSettingKey(key: string): boolean {
  return PRIVATE_KEYS.has(key)
}
