import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { getDashboard, getAlerts, dismissAlert } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { format, differenceInDays } from 'date-fns'
import NurseDashboard from './NurseDashboard'
import OphthalmologistDashboard from './OphthalmologistDashboard'

// ── Dummy data (dates computed relative to today so the demo never goes stale) ─
function _d(offsetDays) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

const DUMMY_BABIES = [
  { id: '1', full_name: 'Baby Nakamya A.',  sex: 'female', date_of_birth: _d(-56), urgency: 'ltfu',      hospital_name: 'Mulago NRH',   next_due_date: _d(-10), days_until_due: -10, last_exam_date: _d(-24), last_zone: 'zone_ii',  last_stage: 'stage_2', gestational_age_weeks: 28, birth_weight_grams: 1150, caregiver_name: 'Prossy Nakamya',  mtn_phone: '+256772000001', airtel_phone: null },
  { id: '2', full_name: 'Baby Otim B.',     sex: 'male',   date_of_birth: _d(-69), urgency: 'ltfu',      hospital_name: 'Mulago NRH',   next_due_date: _d(-8),  days_until_due: -8,  last_exam_date: _d(-22), last_zone: 'zone_i',   last_stage: 'stage_1', gestational_age_weeks: 26, birth_weight_grams: 900,  caregiver_name: 'David Otim',      mtn_phone: '+256772000002', airtel_phone: null },
  { id: '3', full_name: 'Baby Tumusiime C.', sex: 'female', date_of_birth: _d(-49), urgency: 'due_today', hospital_name: 'Mulago NRH',   next_due_date: _d(0),   days_until_due: 0,   last_exam_date: _d(-14), last_zone: 'zone_ii',  last_stage: 'stage_1', gestational_age_weeks: 30, birth_weight_grams: 1380, caregiver_name: 'Rose Tumusiime',   mtn_phone: null,            airtel_phone: '+256752000003' },
  { id: '4', full_name: 'Baby Okello D.',   sex: 'male',   date_of_birth: _d(-42), urgency: 'due_soon',  hospital_name: 'Mulago NRH',   next_due_date: _d(2),   days_until_due: 2,   last_exam_date: _d(-12), last_zone: 'zone_ii',  last_stage: 'stage_1', gestational_age_weeks: 29, birth_weight_grams: 1240, caregiver_name: 'Margaret Okello', mtn_phone: '+256772000004', airtel_phone: null },
  { id: '5', full_name: 'Baby Namukasa E.', sex: 'female', date_of_birth: _d(-35), urgency: 'due_soon',  hospital_name: 'Kiruddu GH',   next_due_date: _d(1),   days_until_due: 1,   last_exam_date: _d(-13), last_zone: 'zone_iii', last_stage: 'no_rop',  gestational_age_weeks: 32, birth_weight_grams: 1550, caregiver_name: 'Fatuma Namukasa', mtn_phone: '+256772000005', airtel_phone: null },
  { id: '6', full_name: 'Baby Ayebare F.',  sex: 'female', date_of_birth: _d(-28), urgency: 'on_track',  hospital_name: 'Mulago NRH',   next_due_date: _d(14),  days_until_due: 14,  last_exam_date: _d(-14), last_zone: 'zone_iii', last_stage: 'no_rop',  gestational_age_weeks: 31, birth_weight_grams: 1420, caregiver_name: 'Alice Ayebare',   mtn_phone: null,            airtel_phone: '+256752000006' },
  { id: '7', full_name: 'Baby Wanyama G.',  sex: 'male',   date_of_birth: _d(-21), urgency: 'on_track',  hospital_name: 'Mbarara RRRH', next_due_date: _d(21),  days_until_due: 21,  last_exam_date: _d(-7),  last_zone: 'zone_iii', last_stage: 'no_rop',  gestational_age_weeks: 33, birth_weight_grams: 1700, caregiver_name: 'Peter Wanyama',   mtn_phone: '+256772000007', airtel_phone: null },
]

// ── Labels & helpers ──────────────────────────────────────────────────────────
const ZONE_LABELS  = { zone_i: 'Zone I', zone_ii: 'Zone II', zone_iii: 'Zone III' }
const STAGE_LABELS = { no_rop: 'No ROP', stage_1: 'Stage 1', stage_2: 'Stage 2', stage_3: 'Stage 3', stage_4: 'Stage 4', stage_5: 'Stage 5', immature: 'Immature' }

const URGENCY_GROUPS = [
  { key: 'ltfu',      label: 'Lost to Follow-Up',  subtitle: 'Missed their appointment - immediate contact required' },
  { key: 'due_today', label: 'Due Today',           subtitle: 'Exam scheduled for today' },
  { key: 'due_soon',  label: 'Due in 1–2 Days',    subtitle: 'Upcoming exam - remind caregiver' },
  { key: 'on_track',  label: 'On Track',            subtitle: 'Next exam more than 2 days away' },
]

function dueDateClass(days) {
  if (days < 0)  return 'overdue'
  if (days === 0) return 'today'
  if (days <= 2)  return 'soon'
  return 'ok'
}

function dueDateText(days, dateStr) {
  if (!dateStr) return '-'
  const formatted = format(new Date(dateStr + 'T00:00:00'), 'dd MMM yyyy')
  if (days < 0)  return `${formatted} · ${Math.abs(days)}d overdue`
  if (days === 0) return 'Today'
  return formatted
}

function UrgencyCard({ value, label, type, icon, to }) {
  const navigate = useNavigate()
  return (
    <div
      className={`urgency-card ${type}`}
      onClick={() => navigate(to)}
      style={{ cursor: 'pointer' }}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && navigate(to)}
    >
      <div className="urgency-card-icon">{icon}</div>
      <div className="urgency-card-value">{value}</div>
      <div className="urgency-card-label">{label}</div>
    </div>
  )
}

// ── Baby card ────────────────────────────────────────────────────────────────
function BabyCard({ baby }) {
  const navigate = useNavigate()
  const phone = baby.mtn_phone || baby.airtel_phone
  const network = baby.mtn_phone ? 'MTN' : baby.airtel_phone ? 'Airtel' : null
  const daysClass = dueDateClass(baby.days_until_due)

  const finding = baby.last_zone
    ? `${ZONE_LABELS[baby.last_zone]} / ${STAGE_LABELS[baby.last_stage] || '-'}`
    : null

  return (
    <div
      className={`baby-card ${baby.urgency}`}
      onClick={() => navigate(`/babies/${baby.id}`)}
      style={{ cursor: 'pointer' }}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && navigate(`/babies/${baby.id}`)}
    >
      <div className="baby-card-header">
        <div>
          <div className="baby-card-name">{baby.full_name}</div>
          <div className="baby-card-sub">
            {baby.sex === 'male' ? 'Male' : 'Female'}
            &nbsp;·&nbsp; DOB {format(new Date(baby.date_of_birth + 'T00:00:00'), 'dd MMM yyyy')}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '.3rem', flexShrink: 0 }}>
          <span className={`badge badge-${baby.urgency}`}>
            {baby.urgency === 'ltfu' ? 'LTFU' : baby.urgency === 'due_today' ? 'Today' : baby.urgency === 'due_soon' ? 'Soon' : 'On Track'}
          </span>
          {baby.sms_failed_recently && (
            <span style={{
              fontSize: '.68rem', fontWeight: 700,
              background: 'var(--amber-50)', color: 'var(--amber-600)',
              border: '1px solid var(--amber-500)',
              borderRadius: 999, padding: '.1rem .45rem',
              whiteSpace: 'nowrap',
            }}>
              SMS failed
            </span>
          )}
        </div>
      </div>

      <div className="baby-card-body">
        <div>
          <div className="baby-card-field-label">Gest. Age</div>
          <div className="baby-card-field-value">
            {baby.gestational_age_weeks != null ? `${baby.gestational_age_weeks}w` : '-'}
          </div>
        </div>
        <div>
          <div className="baby-card-field-label">Birth Weight</div>
          <div className="baby-card-field-value">
            {baby.birth_weight_grams != null ? `${Math.round(baby.birth_weight_grams)}g` : '-'}
          </div>
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <div className="baby-card-field-label">ROP Finding</div>
          {finding ? (
            <div className="baby-card-field-value finding">{finding}</div>
          ) : (
            <div style={{ fontSize: '.82rem', color: 'var(--gray-400)', fontStyle: 'italic' }}>No exam recorded yet</div>
          )}
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <div className="baby-card-field-label">Next Exam Due</div>
          <div className={`baby-card-field-value baby-card-due ${daysClass}`}>
            {dueDateText(baby.days_until_due, baby.next_due_date)}
            {!baby.next_due_date && <span style={{ color: 'var(--gray-400)', fontStyle: 'italic', fontWeight: 400 }}>Not scheduled</span>}
          </div>
        </div>
      </div>

      <div className="baby-card-footer">
        <div className="baby-card-caregiver">
          <strong>{baby.caregiver_name || '-'}</strong>
          {phone && <span>{network}: {phone}</span>}
        </div>
      </div>
    </div>
  )
}

// ── Urgency section ──────────────────────────────────────────────────────────
function UrgencySection({ group, babies }) {
  if (babies.length === 0) return null
  return (
    <div className="urgency-section">
      <div className="urgency-section-header">
        <span className={`urgency-section-dot ${group.key}`} />
        <span className="urgency-section-title">{group.label}</span>
        <span className={`urgency-section-count ${group.key}`}>{babies.length}</span>
        <span style={{ fontSize: '.78rem', color: 'var(--gray-400)', fontWeight: 400, marginLeft: '.25rem' }}>
          - {group.subtitle}
        </span>
      </div>
      <div className="baby-cards-grid">
        {babies.map(b => <BabyCard key={b.id} baby={b} />)}
      </div>
    </div>
  )
}

// ── LTFU Alert panel ─────────────────────────────────────────────────────────
function AlertPanel() {
  const qc = useQueryClient()
  const { data: alerts = [] } = useQuery({ queryKey: ['alerts'], queryFn: getAlerts })
  const dismiss = useMutation({
    mutationFn: (id) => dismissAlert(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] })
      qc.invalidateQueries({ queryKey: ['alert-count'] })
    },
  })

  if (alerts.length === 0) return null

  return (
    <div className="alert-panel">
      <div className="alert-panel-header">
        <span className="alert-panel-icon">!</span>
        <span className="alert-panel-title">LTFU Alerts - {alerts.length} baby{alerts.length !== 1 ? 'ies' : ''} require immediate follow-up</span>
      </div>
      <div className="alert-panel-list">
        {alerts.map(a => (
          <div key={a.id} className="alert-item">
            <div className="alert-item-body">
              <div className="alert-item-title">{a.title}</div>
              <div className="alert-item-text">{a.body}</div>
            </div>
            <div className="alert-item-actions">
              <Link to={`/babies/${a.baby_id}`} className="btn btn-secondary btn-sm">View Profile</Link>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => dismiss.mutate(a.id)}
                disabled={dismiss.isPending}
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Dashboard page (role dispatcher) ─────────────────────────────────────────
export default function DashboardPage() {
  const { user } = useAuth()

  if (user?.role === 'nicu_nurse') return <NurseDashboard />
  if (user?.role === 'ophthalmologist') return <OphthalmologistDashboard />
  // hospital_coordinator and central_coordinator fall through to the full dashboard below

  const { data: babies, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboard,
  })

  const displayBabies = error ? DUMMY_BABIES : (babies || [])
  const isUsingDummy  = !!error

  const grouped = {}
  URGENCY_GROUPS.forEach(g => { grouped[g.key] = [] })
  displayBabies.forEach(b => {
    if (grouped[b.urgency]) grouped[b.urgency].push(b)
  })

  const counts = {
    ltfu:      grouped.ltfu?.length      ?? 0,
    due_today: grouped.due_today?.length ?? 0,
    due_soon:  grouped.due_soon?.length  ?? 0,
    on_track:  grouped.on_track?.length  ?? 0,
  }

  const roleLabel = {
    hospital_coordinator: 'Hospital Dashboard',
    central_coordinator:  'Network Dashboard',
    ophthalmologist:      'Dashboard',
    nicu_nurse:           'Dashboard',
  }[user?.role] || 'Dashboard'

  const isCoordinator = user?.role === 'hospital_coordinator' || user?.role === 'central_coordinator'

  return (
    <div>
      {/* LTFU alert panel - coordinators only */}
      {isCoordinator && <AlertPanel />}

      {/* Page header */}
      <div className="page-header">
        <div className="page-header-text">
          <h2>{roleLabel}</h2>
          <p>{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          {isUsingDummy && (
            <span className="demo-notice" style={{ padding: '.35rem .9rem', fontSize: '.78rem' }}>
              Demo data - API offline
            </span>
          )}
          <Link to="/enroll" className="btn btn-primary">+ Enroll Baby</Link>
        </div>
      </div>

      {/* Summary stat cards */}
      <div className="urgency-grid">
        <UrgencyCard value={counts.ltfu}          label="Lost to Follow-Up" type="ltfu"      icon="!" to="/babies?urgency=ltfu" />
        <UrgencyCard value={counts.due_today}     label="Due Today"          type="due-today" icon="!" to="/babies?urgency=due_today" />
        <UrgencyCard value={counts.due_soon}      label="Due in 1–2 Days"   type="due-soon"  icon="~" to="/babies?urgency=due_soon" />
        <UrgencyCard value={counts.on_track}      label="On Track"           type="on-track"  icon="✓" to="/babies?urgency=on_track" />
        <UrgencyCard value={displayBabies.length} label="Total Enrolled"     type="total"     icon="+" to="/babies" />
      </div>

      {isLoading ? (
        <div className="spinner-center"><div className="spinner" /></div>
      ) : displayBabies.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">👶</div>
            <p>No babies enrolled yet.</p>
            <Link to="/enroll" className="btn btn-primary btn-sm" style={{ marginTop: '.25rem' }}>Enroll First Baby</Link>
          </div>
        </div>
      ) : (
        URGENCY_GROUPS.map(group => (
          <UrgencySection key={group.key} group={group} babies={grouped[group.key]} />
        ))
      )}
    </div>
  )
}
