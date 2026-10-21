import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export async function isAdminUser(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('is_admin')
    if (error) return false
    return !!data
  } catch {
    return false
  }
}

export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    void isAdminUser().then((value) => {
      if (!active) return
      setIsAdmin(value)
      setLoading(false)
    }).catch(() => {
      if (!active) return
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [])

  return { isAdmin, loading }
}
