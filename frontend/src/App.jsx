import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import AppShell from './components/AppShell'
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
          <Route path="dashboard"     element={<DashboardPage />} />
          <Route path="babies"        element={<AllBabiesPage />} />
          <Route path="babies/:id"    element={<BabyDetailPage />} />
          <Route path="babies/:id/exam" element={<RecordExamPage />} />
          <Route path="search"        element={<SearchPage />} />
          <Route path="enroll"        element={<EnrollBabyPage />} />
          <Route path="network"       element={<NetworkDashboardPage />} />
          <Route path="appointments"  element={<AppointmentsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="reports"       element={<ReportsPage />} />
          <Route path="settings"      element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  )
}
