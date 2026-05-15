import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAdminAuth } from '../contexts/AdminAuthContext'
import { getAdminDashboard } from '../services/adminApi'

const C = {
  bg:         '#0A0F1E',
  sidebar:    '#0D1426',
  cardBorder: '#1E3A5F',
  teal:       '#14B8A6',
  amber:      '#F59E0B',
  blue:       '#3B82F6',
  textLabel:  '#64748B',
  textBody:   '#CBD5E1',
  textMuted:  '#94A3B8',
  white:      '#F8FAFC',
}

const APP_VERSION = 'v1.0.0'

/* ── Inline SVG icons (no icon-library dependency) ──────────────────────────── */
const iconProps = {
  width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
}

function EyeLogo({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={C.teal} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3.2" fill={C.teal} stroke="none" />
    </svg>
  )
}
const IconDashboard = () => (
  <svg {...iconProps}><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" />
    <rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>
)
const IconUsers = () => (
  <svg {...iconProps}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
)
const IconBuilding = () => (
  <svg {...iconProps}><path d="M3 21h18" /><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" />
    <path d="M9 7h2M9 11h2M9 15h2M13 7h2M13 11h2M13 15h2" /></svg>
)
const IconPulse = () => (
  <svg {...iconProps}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
)
const IconList = () => (
  <svg {...iconProps}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
)
const IconLogout = () => (
  <svg {...iconProps} width={15} height={15}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
)
const IconWarning = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={C.amber}
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)

const NAV_GROUPS = [
  [{ to: '/sys-mgmt/dashboard', label: 'Dashboard', Icon: IconDashboard }],
  [
    { to: '/sys-mgmt/coordinators', label: 'Coordinators', Icon: IconUsers },
    { to: '/sys-mgmt/hospitals',    label: 'Hospitals',    Icon: IconBuilding },
  ],
  [
    { to: '/sys-mgmt/health', label: 'System Health', Icon: IconPulse },
    { to: '/sys-mgmt/audit',  label: 'Audit Log',     Icon: IconList },
  ],
]

function NavItem({ to, label, Icon }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center', gap: '.7rem',
        padding: '.6rem 1.4rem',
        color: isActive ? C.white : C.textMuted,
        background: isActive ? 'rgba(20,184,166,.10)' : 'transparent',
        textDecoration: 'none',
        fontSize: '.875rem',
        fontWeight: isActive ? 600 : 400,
        borderLeft: isActive ? `3px solid ${C.teal}` : '3px solid transparent',
        transition: 'color .15s, background .15s',
      })}
    >
      {({ isActive }) => (
        <>
          <span style={{ color: isActive ? C.teal : C.textLabel, display: 'flex' }}>
            <Icon />
          </span>
          {label}
        </>
      )}
    </NavLink>
  )
}

export default function AdminShell() {
  const { logout, email } = useAdminAuth()
  const navigate = useNavigate()
  const [logoutHover, setLogoutHover] = useState(false)

  const { data: stats } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: getAdminDashboard,
    staleTime: 60_000,
  })

  async function handleLogout() {
    await logout()
    navigate('/sys-mgmt/login')
  }

  const hospitalCount = stats?.total_hospitals
  const scopeText = hospitalCount != null
    ? `changes affect all ${hospitalCount} hospitals and users network-wide`
    : 'changes affect all hospitals and users network-wide'

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'inherit', background: C.bg }}>
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside style={{
        width: 220, background: C.sidebar, display: 'flex', flexDirection: 'column',
        flexShrink: 0, borderRight: `1px solid ${C.cardBorder}`,
      }}>
        {/* Logo */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '.6rem',
          padding: '1.3rem 1.4rem', borderBottom: `1px solid ${C.cardBorder}`,
        }}>
          <EyeLogo />
          <div>
            <div style={{
              fontSize: '.62rem', fontWeight: 700, letterSpacing: '.12em',
              color: C.teal, textTransform: 'uppercase',
            }}>
              ROP Tracker
            </div>
            <div style={{ fontSize: '.82rem', fontWeight: 600, color: C.white }}>
              System Admin
            </div>
          </div>
        </div>

        {/* Navigation, grouped with dividers */}
        <nav style={{ flex: 1, padding: '.6rem 0' }}>
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi}>
              {gi > 0 && (
                <div style={{
                  height: 1, background: C.cardBorder,
                  margin: '.55rem 1.4rem',
                }} />
              )}
              {group.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
            </div>
          ))}
        </nav>

        {/* Footer: admin identity + version */}
        <div style={{ padding: '.9rem 1.4rem', borderTop: `1px solid ${C.cardBorder}` }}>
          <div style={{
            fontSize: '.6rem', fontWeight: 600, letterSpacing: '.1em',
            color: C.textLabel, textTransform: 'uppercase', marginBottom: '.25rem',
          }}>
            Signed in as
          </div>
          <div style={{
            fontSize: '.74rem', color: C.textBody, wordBreak: 'break-all', marginBottom: '.7rem',
          }}>
            {email || 'administrator'}
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <button
              onClick={handleLogout}
              onMouseEnter={() => setLogoutHover(true)}
              onMouseLeave={() => setLogoutHover(false)}
              style={{
                display: 'flex', alignItems: 'center', gap: '.4rem',
                padding: '.4rem .7rem',
                background: 'transparent',
                border: `1px solid ${logoutHover ? '#475569' : C.cardBorder}`,
                color: logoutHover ? C.white : C.textMuted,
                borderRadius: 4, cursor: 'pointer', fontSize: '.75rem',
                transition: 'color .15s, border-color .15s',
              }}
            >
              <IconLogout /> Sign out
            </button>
            <span style={{ fontSize: '.68rem', color: C.textLabel, fontWeight: 500 }}>
              {APP_VERSION}
            </span>
          </div>
        </div>
      </aside>

      {/* ── Main content area ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: C.bg, minWidth: 0 }}>
        {/* Warning banner */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '.6rem',
          background: '#1A1A2E',
          borderLeft: `3px solid ${C.amber}`,
          borderBottom: `1px solid ${C.cardBorder}`,
          padding: '.6rem 1.5rem',
        }}>
          <IconWarning />
          <span style={{ fontSize: '.8rem', color: C.textBody, flex: 1 }}>
            <strong style={{ color: C.white }}>System Administration</strong>
            <span style={{ color: C.textLabel }}> : </span>
            {scopeText}
          </span>
          <span style={{ fontSize: '.78rem', color: C.textMuted }}>
            {email || 'administrator'}
          </span>
          <button
            onClick={handleLogout}
            style={{
              padding: '.32rem .7rem', background: 'transparent',
              border: `1px solid ${C.cardBorder}`, color: C.textMuted,
              borderRadius: 4, cursor: 'pointer', fontSize: '.74rem',
            }}
          >
            Logout
          </button>
        </div>

        <main style={{ flex: 1, padding: '1.75rem 2rem', overflow: 'auto' }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
