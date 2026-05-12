import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../contexts/AdminAuthContext'

const NAV = [
  { to: '/admin/dashboard',     label: 'Dashboard' },
  { to: '/admin/coordinators',  label: 'Coordinators' },
  { to: '/admin/audit',         label: 'Audit Log' },
]

export default function AdminShell() {
  const { logout } = useAdminAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/admin/login')
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'inherit' }}>
      {/* Sidebar */}
      <aside style={{
        width: 220,
        background: '#0F172A',
        color: '#CBD5E1',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #1E293B' }}>
          <div style={{ fontSize: '.65rem', fontWeight: 700, letterSpacing: '.12em', color: '#64748B', textTransform: 'uppercase', marginBottom: '.25rem' }}>
            ROP Tracker
          </div>
          <div style={{ fontSize: '.9rem', fontWeight: 600, color: '#F1F5F9' }}>
            System Administration
          </div>
        </div>

        <nav style={{ flex: 1, padding: '.75rem 0' }}>
          {NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              style={({ isActive }) => ({
                display: 'block',
                padding: '.6rem 1.5rem',
                color: isActive ? '#F1F5F9' : '#94A3B8',
                background: isActive ? '#1E293B' : 'transparent',
                textDecoration: 'none',
                fontSize: '.875rem',
                fontWeight: isActive ? 500 : 400,
                borderLeft: isActive ? '3px solid #3B82F6' : '3px solid transparent',
                transition: 'color .15s',
              })}
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <button
          onClick={handleLogout}
          style={{
            margin: '1rem',
            padding: '.5rem',
            background: 'transparent',
            border: '1px solid #334155',
            color: '#94A3B8',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: '.8rem',
          }}
        >
          Sign out
        </button>
      </aside>

      {/* Main content area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#F8FAFC', minWidth: 0 }}>
        {/* Warning banner */}
        <div style={{
          background: '#FEF3C7',
          borderBottom: '1px solid #F59E0B',
          padding: '.5rem 1.5rem',
          fontSize: '.8rem',
          color: '#92400E',
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: '.5rem',
        }}>
          <span>&#9888;</span>
          You are in the system administration panel. Actions here affect all hospitals and coordinators network-wide.
        </div>

        <main style={{ flex: 1, padding: '2rem', overflow: 'auto' }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
