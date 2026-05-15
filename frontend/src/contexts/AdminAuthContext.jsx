import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { getAdminMe, adminLogout } from '../services/adminApi'

const AdminAuthContext = createContext(null)

export function AdminAuthProvider({ children }) {
  // null = still checking, true/false = known
  const [isAuthenticated, setIsAuthenticated] = useState(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')

  // On mount, verify the HttpOnly session cookie with the server
  useEffect(() => {
    getAdminMe()
      .then((data) => {
        setIsAuthenticated(true)
        setEmail(data?.email || '')
      })
      .catch(() => setIsAuthenticated(false))
      .finally(() => setLoading(false))
  }, [])

  // Called after successful TOTP verification — cookie is set by the server.
  // Re-fetch /me so the admin email is available immediately in the shell.
  const login = useCallback(async () => {
    setIsAuthenticated(true)
    try {
      const data = await getAdminMe()
      setEmail(data?.email || '')
    } catch (_) { /* ignore — email is non-critical */ }
  }, [])

  const logout = useCallback(async () => {
    try { await adminLogout() } catch (_) { /* ignore */ }
    setIsAuthenticated(false)
    setEmail('')
  }, [])

  return (
    <AdminAuthContext.Provider value={{ isAuthenticated, loading, email, login, logout }}>
      {children}
    </AdminAuthContext.Provider>
  )
}

export function useAdminAuth() {
  return useContext(AdminAuthContext)
}
