import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import AppShell from './components/AppShell'
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

const COORDINATORS = ['hospital_coordinator', 'central_coordinator']
const ENROLLERS    = ['nicu_nurse', 'ophthalmologist', 'hospital_coordinator', 'central_coordinator']
const OPHTHALM_UP  = ['ophthalmologist', 'hospital_coordinator', 'central_coordinator']

function PrivateRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="spinner-center"><div className="spinner" /></div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
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
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  )
}
