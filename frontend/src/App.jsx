import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { AdminAuthProvider, useAdminAuth } from './contexts/AdminAuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import AppShell from './components/AppShell'
import AdminShell from './components/AdminShell'
import ProtectedRoute from './components/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import NetworkDashboardPage from './pages/NetworkDashboardPage'
import EnrollBabyPage from './pages/EnrollBabyPage'
import BabyDetailPage from './pages/BabyDetailPage'
import RecordExamPage from './pages/RecordExamPage'
import AllBabiesPage from './pages/AllBabiesPage'
import SearchPage from './pages/SearchPage'
import NotificationsPage from './pages/NotificationsPage'
import ReportsPage from './pages/ReportsPage'
import SettingsPage from './pages/SettingsPage'
import AppointmentsPage from './pages/AppointmentsPage'
import NotFoundPage from './pages/NotFoundPage'
import AnalyticsPage from './pages/AnalyticsPage'
import AdminLoginPage from './pages/admin/AdminLoginPage'
import AdminDashboardPage from './pages/admin/AdminDashboardPage'
import AdminCoordinatorsPage from './pages/admin/AdminCoordinatorsPage'
import AdminHospitalsPage from './pages/admin/AdminHospitalsPage'
import AdminAuditPage from './pages/admin/AdminAuditPage'
import AdminHealthPage from './pages/admin/AdminHealthPage'

const COORDINATORS = ['hospital_coordinator', 'central_coordinator']
const ENROLLERS    = ['nicu_nurse', 'ophthalmologist', 'hospital_coordinator', 'central_coordinator']
const OPHTHALM_UP  = ['ophthalmologist', 'hospital_coordinator', 'central_coordinator']

function PrivateRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="spinner-center"><div className="spinner" /></div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

function AdminRoute({ children }) {
  const { isAuthenticated, loading } = useAdminAuth()
  // While checking the session cookie with the server, show a blank screen
  if (loading || isAuthenticated === null) {
    return <div style={{ minHeight: '100vh', background: '#0F172A' }} />
  }
  if (!isAuthenticated) return <Navigate to="/sys-mgmt/login" replace />
  return children
}

export default function App() {
  return (
    <AdminAuthProvider>
    <AuthProvider>
    <ThemeProvider>
      <Routes>
        {/* ── Clinical app ──────────────────────────────────────────────── */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<PrivateRoute><AppShell /></PrivateRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />

          <Route path="dashboard"       element={<DashboardPage />} />
          <Route path="babies"          element={<AllBabiesPage />} />
          <Route path="babies/:id"      element={<BabyDetailPage />} />
          <Route path="search"          element={<SearchPage />} />
          <Route path="appointments"    element={<AppointmentsPage />} />

          <Route path="babies/:id/exam" element={
            <ProtectedRoute roles={OPHTHALM_UP}><RecordExamPage /></ProtectedRoute>
          } />
          <Route path="enroll" element={
            <ProtectedRoute roles={ENROLLERS}><EnrollBabyPage /></ProtectedRoute>
          } />
          <Route path="notifications" element={
            <ProtectedRoute roles={OPHTHALM_UP}><NotificationsPage /></ProtectedRoute>
          } />
          <Route path="reports" element={
            <ProtectedRoute roles={COORDINATORS}><ReportsPage /></ProtectedRoute>
          } />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="network" element={
            <ProtectedRoute roles={['central_coordinator']}><NetworkDashboardPage /></ProtectedRoute>
          } />
          <Route path="analytics" element={
            <ProtectedRoute roles={['central_coordinator']}><AnalyticsPage /></ProtectedRoute>
          } />
        </Route>

        {/* ── Admin panel — /sys-mgmt (separate cookie auth) ────────────── */}
        <Route path="/sys-mgmt/login" element={<AdminLoginPage />} />
        <Route path="/sys-mgmt" element={<AdminRoute><AdminShell /></AdminRoute>}>
          <Route index element={<Navigate to="/sys-mgmt/dashboard" replace />} />
          <Route path="dashboard"    element={<AdminDashboardPage />} />
          <Route path="coordinators" element={<AdminCoordinatorsPage />} />
          <Route path="hospitals"    element={<AdminHospitalsPage />} />
          <Route path="health"       element={<AdminHealthPage />} />
          <Route path="audit"        element={<AdminAuditPage />} />
        </Route>

        {/* Old /admin path intentionally not defined — falls through to 404 */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ThemeProvider>
    </AuthProvider>
    </AdminAuthProvider>
  )
}
