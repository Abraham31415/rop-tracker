import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

/**
 * Wrap a route that should only be accessible by certain roles.
 * Unauthenticated users go to /login, with the current location saved in
 * state so LoginPage can redirect back after a successful sign-in.
 * Wrong-role users go to /dashboard with a state flag so DashboardPage
 * can optionally show a toast (currently silent redirect).
 *
 * Usage:
 *   <ProtectedRoute roles={['hospital_coordinator', 'central_coordinator']}>
 *     <ReportsPage />
 *   </ProtectedRoute>
 */
export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <div className="spinner-center"><div className="spinner" /></div>
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />

  return children
}
