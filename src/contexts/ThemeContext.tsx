import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

type ThemeMode = 'light' | 'dark' | 'system'

type ThemeContextValue = {
  mode: ThemeMode
  isDark: boolean
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)
const STORAGE_KEY = 'iqra-theme-mode'

function getSystemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(isDark: boolean) {
  document.documentElement.classList.toggle('dark', isDark)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null
    return saved ?? 'system'
  })
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null
    if (saved === 'dark') return true
    if (saved === 'light') return false
    return getSystemPrefersDark()
  })

  useEffect(() => {
    applyTheme(isDark)
  }, [isDark])

  useEffect(() => {
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => setIsDark(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [mode])

  function setMode(next: ThemeMode) {
    setModeState(next)
    localStorage.setItem(STORAGE_KEY, next)
    setIsDark(next === 'dark' ? true : next === 'light' ? false : getSystemPrefersDark())
  }

  return (
    <ThemeContext.Provider value={{ mode, isDark, setMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
