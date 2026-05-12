import { createContext, useContext, useState, useCallback } from 'react'

const AdminAuthContext = createContext(null)

const STORAGE_KEY = 'admin_token'

export function AdminAuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY))

  const login = useCallback((newToken) => {
    localStorage.setItem(STORAGE_KEY, newToken)
    setToken(newToken)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setToken(null)
  }, [])

  return (
    <AdminAuthContext.Provider value={{ token, login, logout, isAuthenticated: !!token }}>
      {children}
    </AdminAuthContext.Provider>
  )
}

export function useAdminAuth() {
  return useContext(AdminAuthContext)
}
