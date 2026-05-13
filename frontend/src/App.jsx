import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { AdminAuthProvider, useAdminAuth } from './contexts/AdminAuthContext'
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
  const { isAuthenticated } = useAdminAuth()
  if (!isAuthenticated) return <Navigate to="/admin/login" replace />
  return children
}

export default function App() {
  return (
    <AdminAuthProvider>
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<PrivateRoute><AppShell /></PrivateRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />

          {/* Dashboard — all roles, internally routes to role-specific view */}
          <Route path="dashboard" element={<DashboardPage />} />

          {/* Baby browsing — all roles */}
          <Route path="babies"          element={<AllBabiesPage />} />
          <Route path="babies/:id"      element={<BabyDetailPage />} />
          <Route path="search"          element={<SearchPage />} />
          <Route path="appointments"    element={<AppointmentsPage />} />

          {/* Record exam — ophthalmologists + coordinators */}
          <Route path="babies/:id/exam" element={
            <ProtectedRoute roles={OPHTHALM_UP}><RecordExamPage /></ProtectedRoute>
          } />

          {/* Enrollment — nurses + coordinators (not ophthalmologists) */}
          <Route path="enroll" element={
            <ProtectedRoute roles={ENROLLERS}><EnrollBabyPage /></ProtectedRoute>
          } />

          {/* Notifications — ophthalmologists + coordinators */}
          <Route path="notifications" element={
            <ProtectedRoute roles={OPHTHALM_UP}><NotificationsPage /></ProtectedRoute>
          } />

          {/* Reports — coordinators only */}
          <Route path="reports" element={
            <ProtectedRoute roles={COORDINATORS}><ReportsPage /></ProtectedRoute>
          } />

          {/* Settings — coordinators only */}
          <Route path="settings" element={
            <ProtectedRoute roles={COORDINATORS}><SettingsPage /></ProtectedRoute>
          } />

          {/* Network overview — central coordinator only */}
          <Route path="network" element={
            <ProtectedRoute roles={['central_coordinator']}><NetworkDashboardPage /></ProtectedRoute>
          } />

          {/* Analytics — central coordinator only */}
          <Route path="analytics" element={
            <ProtectedRoute roles={['central_coordinator']}><AnalyticsPage /></ProtectedRoute>
          } />
        </Route>
        {/* Admin panel — completely separate auth */}
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin" element={<AdminRoute><AdminShell /></AdminRoute>}>
          <Route index element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="dashboard"    element={<AdminDashboardPage />} />
          <Route path="coordinators" element={<AdminCoordinatorsPage />} />
          <Route path="hospitals"    element={<AdminHospitalsPage />} />
          <Route path="health"       element={<AdminHealthPage />} />
          <Route path="audit"        element={<AdminAuditPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
    </AdminAuthProvider>
  )
}
