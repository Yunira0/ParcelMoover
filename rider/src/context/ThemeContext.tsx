import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'riderTheme'

function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'system' || v === 'light' || v === 'dark'
}

function getStoredPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return isThemePreference(raw) ? raw : 'system'
  } catch {
    return 'system'
  }
}

// Only "light"/"dark" ever reach the DOM as data-theme - "system" means no
// override, so index.css's @media (prefers-color-scheme: dark) block decides.
function applyPreference(pref: ThemePreference) {
  if (pref === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', pref)
}

// Applied once at module load, synchronously, before the first paint (and
// before ThemeProvider's own effect would run) - otherwise the app would
// flash in the wrong theme in the moment before a mounted effect fires.
applyPreference(getStoredPreference())

interface ThemeState {
  preference: ThemePreference
  setPreference: (pref: ThemePreference) => void
}

const ThemeContext = createContext<ThemeState | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(getStoredPreference)

  const setPreference = useCallback((pref: ThemePreference) => {
    applyPreference(pref)
    try { localStorage.setItem(STORAGE_KEY, pref) } catch { /* best-effort */ }
    setPreferenceState(pref)
  }, [])

  return (
    <ThemeContext.Provider value={{ preference, setPreference }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useThemePreference() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useThemePreference must be used inside ThemeProvider')
  return ctx
}
