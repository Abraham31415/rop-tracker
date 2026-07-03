import { Outlet, NavLink, useNavigate, useLocation, Link } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { getAlertCount, searchBabies } from '../services/api'
import { getBabyDisplayName } from '../utils/babyName'


const ROLE_LABELS = {
  nicu_nurse: 'NICU Nurse',
  ophthalmologist: 'Ophthalmologist',
  hospital_coordinator: 'Hospital Coordinator',
  central_coordinator: 'Central Coordinator',
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const Icon = ({ d, size = 20 }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" style={{ width: size, height: size, flexShrink: 0 }}>
    {d}
  </svg>
)
const IconGrid     = () => <Icon d={<><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></>} />
const IconList     = () => <Icon d={<><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>} />
const IconSearch   = () => <Icon d={<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>} />
const IconBell     = () => <Icon d={<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>} />
const IconBarChart = () => <Icon d={<><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>} />
const IconSettings = () => <Icon d={<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>} />
const IconNetwork  = () => <Icon d={<><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><line x1="12" y1="8" x2="5.5" y2="16"/><line x1="12" y1="8" x2="18.5" y2="16"/></>} />
const IconCalendar = () => <Icon d={<><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>} />
const IconPlus     = () => <Icon d={<><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></>} />
const IconEye      = () => <Icon size={22} d={<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>} />
const IconLogout   = () => <Icon size={15} d={<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>} />
const IconMenu     = () => <Icon size={22} d={<><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>} />
const IconChevron  = () => <Icon size={14} d={<><polyline points="9 18 15 12 9 6"/></>} />

function initials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

// ── Role-based nav config ─────────────────────────────────────────────────────
function navItems(role) {
  const all = [
    { to: '/dashboard',      label: 'Dashboard',       icon: <IconGrid />,     roles: ['nicu_nurse','ophthalmologist','hospital_coordinator','central_coordinator'] },
    { to: '/babies',         label: 'All Babies',      icon: <IconList />,     roles: ['nicu_nurse','ophthalmologist','hospital_coordinator','central_coordinator'] },
    { to: '/search',         label: 'Search',          icon: <IconSearch />,   roles: ['nicu_nurse','ophthalmologist','hospital_coordinator','central_coordinator'] },
    { to: '/enroll',         label: 'Enroll Baby',     icon: <IconPlus />,     roles: ['nicu_nurse','hospital_coordinator','central_coordinator'] },
    { to: '/appointments',   label: 'Appointments',    icon: <IconCalendar />, roles: ['ophthalmologist','hospital_coordinator','central_coordinator'] },
    { to: '/notifications',  label: 'Notifications',   icon: <IconBell />,     roles: ['ophthalmologist','hospital_coordinator','central_coordinator'] },
    { to: '/reports',        label: 'Reports',         icon: <IconBarChart />, roles: ['hospital_coordinator','central_coordinator'] },
    { to: '/network',        label: 'Network Overview',icon: <IconNetwork />,  roles: ['central_coordinator'] },
    { to: '/analytics',      label: 'Analytics',       icon: <IconBarChart />, roles: ['central_coordinator'] },
    { to: '/settings',       label: 'Settings',        icon: <IconSettings />, roles: ['nicu_nurse','ophthalmologist','hospital_coordinator','central_coordinator'] },
  ]
  return all.filter(item => item.roles.includes(role))
}

// ── Global quick-search overlay ──────────────────────────────────────────────
const URGENCY_MAP = { ltfu: ['badge-ltfu','LTFU'], due_today: ['badge-due_today','Today'], due_soon: ['badge-due_soon','Soon'], on_track: ['badge-on_track','On Track'] }

function SearchOverlay({ onClose }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const inputRef = useRef(null)

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['quick-search', q],
    queryFn: () => searchBabies(q),
    enabled: q.trim().length >= 2,
    staleTime: 5000,
  })

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const go = (id) => { navigate(`/babies/${id}`); onClose() }

  return (
    <div className="search-overlay-backdrop" onClick={onClose}>
      <div className="search-overlay-panel" onClick={e => e.stopPropagation()}>
        <div className="search-overlay-input-row">
          <IconSearch />
          <input
            ref={inputRef}
            className="search-overlay-input"
            placeholder="Search babies, caregivers, or phone numbers…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          {isFetching && <div className="spinner" style={{ width: 16, height: 16 }} />}
          <button className="search-overlay-close" onClick={onClose}>Esc</button>
        </div>

        {q.length >= 2 && (
          <div className="search-overlay-results">
            {results.length === 0 && !isFetching && (
              <div className="search-overlay-empty">No results for "{q}"</div>
            )}
            {results.map(b => {
              const [cls, label] = URGENCY_MAP[b.urgency] || ['', b.urgency]
              const phone = b.mtn_phone || b.airtel_phone
              return (
                <button key={b.id} className="search-overlay-row" onClick={() => go(b.id)}>
                  <div>
                    <div className="search-overlay-name">{getBabyDisplayName(b)}</div>
                    <div className="search-overlay-meta">
                      {b.caregiver_name}{phone ? ` · ${phone}` : ''}{b.hospital_name ? ` · ${b.hospital_name}` : ''}
                    </div>
                  </div>
                  <span className={`badge ${cls}`}>{label}</span>
                </button>
              )
            })}
            {results.length > 0 && (
              <button className="search-overlay-see-all" onClick={() => { navigate(`/search?q=${encodeURIComponent(q)}`); onClose() }}>
                See all results for "{q}" →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Breadcrumbs ───────────────────────────────────────────────────────────────
function Breadcrumbs() {
  const location = useLocation()
  const crumbs = useBreadcrumbs(location.pathname)
  if (crumbs.length <= 1) return null
  return (
    <nav className="breadcrumbs">
      {crumbs.map((crumb, i) => (
        <span key={i} className="breadcrumb-item">
          {i < crumbs.length - 1 ? (
            <>
              <Link to={crumb.to} className="breadcrumb-link">{crumb.label}</Link>
              <span className="breadcrumb-sep"><IconChevron /></span>
            </>
          ) : (
            <span className="breadcrumb-current">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

function useBreadcrumbs(path) {
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0 || segments[0] === 'dashboard') return [{ label: 'Dashboard', to: '/dashboard' }]
  if (segments[0] === 'babies' && segments.length >= 2) {
    const base = [{ label: 'Dashboard', to: '/dashboard' }, { label: 'All Babies', to: '/babies' }]
    if (segments.length === 2) return [...base, { label: 'Baby Profile', to: path }]
    if (segments[2] === 'exam') return [...base, { label: 'Baby Profile', to: `/babies/${segments[1]}` }, { label: 'Record Exam', to: path }]
    return base
  }
  const PAGE_LABELS = { enroll: 'Enroll Baby', network: 'Network Overview', analytics: 'Analytics', notifications: 'Notifications', reports: 'Reports', settings: 'Settings', search: 'Search', appointments: 'Appointments' }
  if (PAGE_LABELS[segments[0]]) return [{ label: 'Dashboard', to: '/dashboard' }, { label: PAGE_LABELS[segments[0]], to: path }]
  return [{ label: 'Dashboard', to: '/dashboard' }]
}

// ── Notification count badge (coordinators: alerts; ophthalmologists: screening requests) ──
function useNotifCount(role) {
  const isCoordinator = role === 'hospital_coordinator' || role === 'central_coordinator'
  const isOphthalm = role === 'ophthalmologist'

  const { data: alertData } = useQuery({
    queryKey: ['alert-count'],
    queryFn: () => import('../services/api').then(m => m.getAlertCount()),
    enabled: isCoordinator,
    refetchInterval: 60_000,
  })
  const { data: screeningData } = useQuery({
    queryKey: ['pending-screening-requests'],
    queryFn: () => import('../services/api').then(m => m.getPendingScreeningRequests()),
    enabled: isOphthalm,
    refetchInterval: 30_000,
    select: (d) => ({ count: Array.isArray(d) ? d.filter(r => r.status === 'pending').length : 0 }),
  })

  if (isCoordinator) return alertData?.count ?? 0
  if (isOphthalm) return screeningData?.count ?? 0
  return 0
}

// ── Bottom Navigation (mobile) ────────────────────────────────────────────────
function BottomNav({ role, alertCount, onSearchOpen, onMenuOpen }) {
  const canEnroll = ['nicu_nurse', 'hospital_coordinator', 'central_coordinator'].includes(role)
  const canNotif  = ['ophthalmologist', 'hospital_coordinator', 'central_coordinator'].includes(role)

  return (
    <nav className="bottom-nav">
      <NavLink to="/dashboard" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
        <IconGrid />
        <span>Home</span>
      </NavLink>

      <NavLink to="/babies" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
        <IconList />
        <span>Babies</span>
      </NavLink>

      {canEnroll ? (
        <NavLink to="/enroll" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <div className="bottom-nav-fab">
            <IconPlus />
          </div>
          <span style={{ marginTop: '2px' }}>Enroll</span>
        </NavLink>
      ) : (
        <button className="bottom-nav-item" onClick={onSearchOpen}>
          <IconSearch />
          <span>Search</span>
        </button>
      )}

      {canNotif ? (
        <NavLink to="/notifications" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <IconBell />
          {alertCount > 0 && <span className="bottom-nav-badge">{alertCount > 99 ? '99+' : alertCount}</span>}
          <span>Alerts</span>
        </NavLink>
      ) : (
        <button className="bottom-nav-item" onClick={onSearchOpen}>
          <IconSearch />
          <span>Search</span>
        </button>
      )}

      <button className="bottom-nav-item" onClick={onMenuOpen}>
        <IconMenu />
        <span>More</span>
      </button>
    </nav>
  )
}

// ── AppShell ──────────────────────────────────────────────────────────────────
export default function AppShell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const isCoordinator = user?.role === 'hospital_coordinator' || user?.role === 'central_coordinator'
  const alertCount = useNotifCount(user?.role)
  const items = navItems(user?.role || '')
  const handleLogout = () => { logout(); navigate('/login') }

  // Cmd/Ctrl+K opens search
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 99 }}
          onClick={() => setSidebarOpen(false)} />
      )}

      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}

      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-logo">
          <div className="sidebar-logo-inner">
            <div className="sidebar-logo-icon"><IconEye /></div>
            <div className="sidebar-logo-text">
              <div className="sidebar-logo-title">ROP Tracker</div>
              <div className="sidebar-logo-sub">Uganda Network</div>
            </div>
          </div>
        </div>

        <div className="sidebar-section-label">Navigation</div>
        <nav className="sidebar-nav">
          {items.map(item => (
            <NavLink key={item.to} to={item.to} onClick={() => setSidebarOpen(false)}>
              {item.icon}
              {item.label}
              {item.to === '/notifications' && alertCount > 0 && (
                <span className="sidebar-notif-badge">{alertCount > 99 ? '99+' : alertCount}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar">{initials(user?.full_name)}</div>
            <div>
              <div className="sidebar-user-name">{user?.full_name}</div>
              <div className="sidebar-user-role">{ROLE_LABELS[user?.role] || user?.role}</div>
            </div>
          </div>
          <button className="sidebar-logout" onClick={handleLogout}>
            <IconLogout /> Sign out
          </button>
        </div>
      </aside>

      <div className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-toggle" onClick={() => setSidebarOpen(o => !o)} aria-label="Menu">
              <IconMenu />
            </button>
            <span className="topbar-title">ROP Tracker Uganda</span>
          </div>
          <div className="topbar-right">
            <button className="alert-bell" onClick={() => setSearchOpen(true)} title="Search (Ctrl+K)">
              <IconSearch />
            </button>
            {(isCoordinator || user?.role === 'ophthalmologist') && (
              <NavLink to="/notifications" className="alert-bell" title="Notifications">
                <IconBell />
                {alertCount > 0 && (
                  <span className="alert-bell-badge">{alertCount > 99 ? '99+' : alertCount}</span>
                )}
              </NavLink>
            )}
            <div className="topbar-badge">
              <span className="dot" />
              {ROLE_LABELS[user?.role] || 'Staff'}
            </div>
          </div>
        </header>

        <main className="page-body">
          <Breadcrumbs />
          <Outlet />
        </main>
      </div>

      <BottomNav
        role={user?.role}
        alertCount={alertCount}
        onSearchOpen={() => setSearchOpen(true)}
        onMenuOpen={() => setSidebarOpen(true)}
      />
    </div>
  )
}
