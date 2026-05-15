import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const ThemeContext = createContext(null)

export const THEMES = ['light', 'dark', 'navy', 'slate']
const STORAGE_KEY = 'rop-theme'

function readInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && THEMES.includes(saved)) return saved
  } catch (_) { /* localStorage unavailable */ }
  return 'light'
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readInitialTheme)

  // Apply the theme to <html data-theme="..."> and persist the choice
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem(STORAGE_KEY, theme) } catch (_) { /* ignore */ }
  }, [theme])

  const setTheme = useCallback((next) => {
    if (THEMES.includes(next)) setThemeState(next)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext) || { theme: 'light', setTheme: () => {} }
}
