import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import api from '../services/api'
import { useAuth } from './AuthContext'

const ThemeContext = createContext(null)

export const THEME_OPTIONS = ['light', 'dark', 'system']
const STORAGE_KEY = 'rop-theme'

function getSystemTheme() {
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
    ? 'dark' : 'light'
}

function readStoredPreference() {
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    if (THEME_OPTIONS.includes(s)) return s
  } catch (_) { /* localStorage unavailable */ }
  return 'system'
}

export function ThemeProvider({ children }) {
  const auth = useAuth()
  const user = auth?.user

  // preference = what the user chose: 'light' | 'dark' | 'system'
  const [preference, setPreference] = useState(readStoredPreference)
  // systemTheme = the OS setting, tracked live
  const [systemTheme, setSystemTheme] = useState(getSystemTheme)

  // resolved = the theme actually applied: 'light' | 'dark'
  const resolved = preference === 'system' ? systemTheme : preference

  // Apply resolved theme to <html data-theme="...">
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved)
  }, [resolved])

  // Persist the preference locally for instant load next time
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, preference) } catch (_) { /* ignore */ }
  }, [preference])

  // React to OS light/dark changes while the app is open
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e) => setSystemTheme(e.matches ? 'dark' : 'light')
    if (mq.addEventListener) mq.addEventListener('change', handler)
    else mq.addListener(handler)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler)
      else mq.removeListener(handler)
    }
  }, [])

  // On login, adopt the theme saved on the user's profile (cross-device sync)
  const syncedUserId = useRef(null)
  useEffect(() => {
    if (user && user.id !== syncedUserId.current) {
      syncedUserId.current = user.id
      if (user.theme && THEME_OPTIONS.includes(user.theme) && user.theme !== preference) {
        setPreference(user.theme)
      }
    }
    if (!user) syncedUserId.current = null
  }, [user])  // eslint-disable-line react-hooks/exhaustive-deps

  // Change theme: update state, persist locally + to the user's profile
  const setTheme = useCallback((pref) => {
    if (!THEME_OPTIONS.includes(pref)) return
    setPreference(pref)
    api.patch('/api/auth/me/theme', { theme: pref }).catch(() => { /* offline / not critical */ })
  }, [])

  return (
    <ThemeContext.Provider value={{ theme: preference, resolved, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext) || { theme: 'system', resolved: 'light', setTheme: () => {} }
}
