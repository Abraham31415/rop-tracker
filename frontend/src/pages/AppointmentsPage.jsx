import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, differenceInCalendarDays, addDays } from 'date-fns'
import { useAuth } from '../contexts/AuthContext'
import { listAllAppointments, markAppointmentAttended, rescheduleAppointment } from '../services/api'
import { useTheme } from '../contexts/ThemeContext'
import { getBabyDisplayName } from '../utils/babyName'
import { REVIEW_DATE_REASONS, resolveReason } from '../utils/reviewDate'

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_META_LIGHT = {
  scheduled: { label: 'Scheduled', bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  missed:    { label: 'Missed',    bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
  ltfu:      { label: 'LTFU',      bg: '#fee2e2', color: '#b91c1c', border: '#fca5a5' },
  attended:  { label: 'Attended',  bg: '#dcfce7', color: '#15803d', border: '#86efac' },
}
const STATUS_META_DARK = {
  scheduled: { label: 'Scheduled', bg: '#1e3a5f', color: '#93c5fd', border: '#2c4a70' },
  missed:    { label: 'Missed',    bg: '#78350f', color: '#fcd34d', border: '#92400e' },
  ltfu:      { label: 'LTFU',      bg: '#7f1d1d', color: '#fca5a5', border: '#991b1b' },
  attended:  { label: 'Attended',  bg: '#14532d', color: '#4ade80', border: '#166534' },
}

const TODAY = new Date()
TODAY.setHours(0, 0, 0, 0)

function isoToday() { return format(TODAY, 'yyyy-MM-dd') }
function isoIn(days) { return format(addDays(TODAY, days), 'yyyy-MM-dd') }

const DATE_PRESETS = [
  { id: 'week',    label: 'Next 7 days',  from: isoToday, to: () => isoIn(7) },
  { id: 'month',   label: 'Next 30 days', from: isoToday, to: () => isoIn(30) },
  { id: 'upcoming',label: 'All upcoming', from: isoToday, to: () => null },
  { id: 'custom',  label: 'Custom',       from: () => null, to: () => null },
]

const STATUS_TABS = [
  { id: 'active',    label: 'Upcoming',  statuses: ['scheduled', 'missed'] },
  { id: 'scheduled', label: 'Scheduled', statuses: ['scheduled'] },
  { id: 'missed',    label: 'Missed',    statuses: ['missed'] },
  { id: 'ltfu',      label: 'LTFU',      statuses: ['ltfu'] },
  { id: 'attended',  label: 'Attended',  statuses: ['attended'] },
  { id: 'all',       label: 'All',       statuses: [] },
]

// ── Attend confirmation dialog ─────────────────────────────────────────────────
function AttendDialog({ appt, onConfirm, onCancel, isPending }) {
  const [notes, setNotes] = useState('')
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,.35)', padding: '1rem',
    }}>
      <div style={{
        background: 'var(--surface)', borderRadius: 'var(--radius)',
        boxShadow: '0 8px 32px rgba(0,0,0,.18)', padding: '1.5rem',
        maxWidth: 420, width: '100%',
      }}>
        <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--gray-900)', marginBottom: '.5rem' }}>
          Confirm Attendance
        </div>
        <p style={{ fontSize: '.9rem', color: 'var(--gray-700)', marginBottom: '1rem', lineHeight: 1.5 }}>
          Confirm attendance for <strong>{getBabyDisplayName(appt.baby_name)}</strong> on{' '}
          <strong>{format(new Date(appt.due_date + 'T00:00:00'), 'dd MMMM yyyy')}</strong>?
        </p>
        <div className="form-group" style={{ marginBottom: '1rem' }}>
          <label className="form-label">
            Notes <span style={{ fontWeight: 400, color: 'var(--gray-400)' }}>(optional)</span>
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. Arrived late, caregiver had questions..."
            className="form-control"
            style={{ resize: 'vertical', fontSize: '.85rem' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary btn-sm" onClick={onCancel} disabled={isPending}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={() => onConfirm(notes)} disabled={isPending}>
            {isPending ? 'Saving...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Appointment card ──────────────────────────────────────────────────────────
function ApptCard({ appt, canAct, isCentral, onAttend, onRescheduleSuccess, queryKey }) {
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [reasonSelect, setReasonSelect] = useState('')
  const [reasonOther, setReasonOther] = useState('')
  const qc = useQueryClient()

  const reason = resolveReason(reasonSelect, reasonOther)

  const rescheduleMut = useMutation({
    mutationFn: () => rescheduleAppointment(appt.id, newDate, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey })
      setRescheduleOpen(false)
      setNewDate('')
      setReasonSelect('')
      setReasonOther('')
    },
  })

  const { resolved } = useTheme()
  const dark = resolved === 'dark'
  const STATUS_META = dark ? STATUS_META_DARK : STATUS_META_LIGHT
  const st = STATUS_META[appt.status] || STATUS_META.scheduled
  const dueDate = new Date(appt.due_date + 'T00:00:00')
  const daysOff = differenceInCalendarDays(dueDate, TODAY)
  const phone = appt.mtn_phone || appt.airtel_phone
  const network = appt.mtn_phone ? 'MTN' : appt.airtel_phone ? 'Airtel' : null

  let dueLine
  if (daysOff < 0)       dueLine = `${Math.abs(daysOff)}d overdue`
  else if (daysOff === 0) dueLine = 'Today'
  else if (daysOff === 1) dueLine = 'Tomorrow'
  else                    dueLine = `In ${daysOff} days`

  const isActionable = appt.status === 'scheduled' || appt.status === 'missed'
  const minRescheduleDate = format(addDays(TODAY, 1), 'yyyy-MM-dd')

  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 'var(--radius)',
      border: `1px solid var(--gray-200)`,
      borderLeft: `4px solid ${st.border}`,
      padding: '1rem 1.125rem', display: 'flex', flexDirection: 'column', gap: '.6rem',
    }}>
      {/* Top row: name + status + due date */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '.75rem', flexWrap: 'wrap' }}>
        <div>
          <Link
            to={`/babies/${appt.baby_id}`}
            style={{ fontWeight: 800, fontSize: '.95rem', color: 'var(--gray-900)', textDecoration: 'none' }}
          >
            {getBabyDisplayName(appt.baby_name)}
          </Link>
          {isCentral && appt.hospital_name && (
            <div style={{ fontSize: '.73rem', color: 'var(--gray-400)', marginTop: '.1rem' }}>
              {appt.hospital_name}
            </div>
          )}
        </div>
        <span style={{
          padding: '.2rem .65rem', borderRadius: 999, fontSize: '.72rem', fontWeight: 700,
          background: st.bg, color: st.color, flexShrink: 0,
        }}>
          {st.label}
        </span>
      </div>

      {/* Due date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ width: 14, height: 14, color: 'var(--gray-400)', flexShrink: 0 }}>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <span style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--gray-800)' }}>
          {format(dueDate, 'dd MMM yyyy')}
        </span>
        <span style={{
          fontSize: '.75rem', fontWeight: 600, padding: '.1rem .45rem', borderRadius: 999,
          background: daysOff < 0
            ? (dark ? '#7f1d1d' : '#fee2e2')
            : daysOff === 0 ? (dark ? '#78350f' : '#fef3c7') : (dark ? '#14532d' : '#f0fdf4'),
          color: daysOff < 0
            ? (dark ? '#fca5a5' : '#b91c1c')
            : daysOff === 0 ? (dark ? '#fcd34d' : '#92400e') : (dark ? '#4ade80' : '#15803d'),
        }}>
          {dueLine}
        </span>
      </div>

      {/* Caregiver */}
      <div style={{ fontSize: '.82rem', color: 'var(--gray-600)' }}>
        <span style={{ fontWeight: 600 }}>{appt.caregiver_name}</span>
        {phone && (
          <span style={{ color: 'var(--gray-400)', marginLeft: '.4rem' }}>
            {network}: {phone}
          </span>
        )}
      </div>

      {/* Notes (if any) */}
      {appt.notes && (
        <div style={{
          fontSize: '.78rem', color: 'var(--gray-500)', lineHeight: 1.5,
          padding: '.35rem .6rem', background: 'var(--gray-50)', borderRadius: 'var(--radius-sm)',
        }}>
          {appt.notes}
        </div>
      )}

      {/* Actions */}
      {canAct && isActionable && (
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', paddingTop: '.2rem', borderTop: '1px solid var(--gray-100)' }}>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onAttend(appt)}
          >
            Mark Attended
          </button>
          {appt.status === 'scheduled' && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setRescheduleOpen(o => !o)}
            >
              {rescheduleOpen ? 'Cancel' : 'Reschedule'}
            </button>
          )}
          <Link to={`/babies/${appt.baby_id}`} className="btn btn-ghost btn-sm">
            View Profile
          </Link>
        </div>
      )}

      {!canAct && (
        <div style={{ paddingTop: '.2rem', borderTop: '1px solid var(--gray-100)' }}>
          <Link to={`/babies/${appt.baby_id}`} className="btn btn-secondary btn-sm">
            View Profile
          </Link>
        </div>
      )}

      {/* Inline reschedule form */}
      {rescheduleOpen && (
        <div style={{
          padding: '.75rem', background: dark ? '#15233f' : '#eff6ff', borderRadius: 'var(--radius-sm)',
          border: `1px solid ${dark ? '#1e3a5f' : '#bfdbfe'}`, display: 'flex', flexDirection: 'column', gap: '.6rem',
        }}>
          <div style={{ fontSize: '.75rem', fontWeight: 700, color: dark ? '#93c5fd' : '#1d4ed8', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Reschedule
          </div>
          <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 140 }}>
              <label className="form-label">New Date</label>
              <input
                type="date"
                className="form-control"
                value={newDate}
                min={minRescheduleDate}
                onChange={e => setNewDate(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ margin: 0, flex: 2, minWidth: 160 }}>
              <label className="form-label">Reason *</label>
              <select
                className="form-control"
                value={reasonSelect}
                onChange={e => setReasonSelect(e.target.value)}
              >
                <option value="">Select a reason...</option>
                {REVIEW_DATE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              {reasonSelect === 'Other' && (
                <input
                  type="text"
                  className="form-control"
                  style={{ marginTop: '.4rem' }}
                  placeholder="Please specify the reason"
                  value={reasonOther}
                  onChange={e => setReasonOther(e.target.value)}
                />
              )}
            </div>
          </div>
          {rescheduleMut.error && (
            <div className="alert alert-error" style={{ fontSize: '.78rem', padding: '.35rem .6rem' }}>
              {rescheduleMut.error.response?.data?.detail || 'Failed to reschedule.'}
            </div>
          )}
          <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setRescheduleOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => rescheduleMut.mutate()}
              disabled={!newDate || !reason || rescheduleMut.isPending}
            >
              {rescheduleMut.isPending ? 'Saving...' : 'Confirm Reschedule'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AppointmentsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()

  const [statusTab, setStatusTab]   = useState('active')
  const [datePreset, setDatePreset] = useState('upcoming')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo]     = useState('')
  const [attendTarget, setAttendTarget] = useState(null)

  const isCentral  = user?.role === 'central_coordinator'
  const canAct     = ['hospital_coordinator', 'central_coordinator', 'ophthalmologist'].includes(user?.role)

  const currentTab    = STATUS_TABS.find(t => t.id === statusTab) || STATUS_TABS[0]
  const currentPreset = DATE_PRESETS.find(p => p.id === datePreset) || DATE_PRESETS[2]

  const fromDate = datePreset === 'custom' ? customFrom : currentPreset.from()
  const toDate   = datePreset === 'custom' ? customTo   : currentPreset.to()

  const queryParams = {
    ...(currentTab.statuses.length > 0 ? { status: currentTab.statuses } : {}),
    ...(fromDate ? { from_date: fromDate } : {}),
    ...(toDate   ? { to_date:   toDate   } : {}),
  }
  const queryKey = ['appointments-list', statusTab, datePreset, customFrom, customTo]

  const { data: appointments = [], isLoading, error } = useQuery({
    queryKey,
    queryFn: () => listAllAppointments(queryParams),
  })

  const attendMut = useMutation({
    mutationFn: ({ id, notes }) => markAppointmentAttended(id, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['alerts'] })
      qc.invalidateQueries({ queryKey: ['alert-count'] })
      setAttendTarget(null)
    },
  })

  const statusCounts = {}
  STATUS_TABS.forEach(t => { statusCounts[t.id] = 0 })

  return (
    <>
      {attendTarget && (
        <AttendDialog
          appt={attendTarget}
          isPending={attendMut.isPending}
          onConfirm={(notes) => attendMut.mutate({ id: attendTarget.id, notes })}
          onCancel={() => setAttendTarget(null)}
        />
      )}

      {/* Page header */}
      <div className="page-header">
        <div className="page-header-text">
          <h2>Appointments</h2>
          <p>
            {isLoading ? 'Loading...' : `${appointments.length} appointment${appointments.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* Status tabs */}
      <div style={{
        display: 'flex', gap: 0, borderBottom: '2px solid var(--gray-200)',
        marginBottom: '1rem', overflowX: 'auto',
      }}>
        {STATUS_TABS.map(tab => (
          <button key={tab.id} onClick={() => setStatusTab(tab.id)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '.55rem 1rem', fontSize: '.85rem', fontWeight: 700, whiteSpace: 'nowrap',
            color: statusTab === tab.id ? 'var(--teal-700)' : 'var(--gray-500)',
            borderBottom: statusTab === tab.id ? '2px solid var(--teal-700)' : '2px solid transparent',
            marginBottom: '-2px', transition: 'all .15s',
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Date filter */}
      <div style={{
        display: 'flex', gap: '.4rem', alignItems: 'center',
        flexWrap: 'wrap', marginBottom: '1.25rem',
      }}>
        {DATE_PRESETS.map(p => (
          <button
            key={p.id}
            onClick={() => setDatePreset(p.id)}
            className={datePreset === p.id ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
          >
            {p.label}
          </button>
        ))}

        {datePreset === 'custom' && (
          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="date"
              className="form-control"
              style={{ width: 'auto', fontSize: '.83rem', padding: '.3rem .55rem' }}
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
            />
            <span style={{ fontSize: '.8rem', color: 'var(--gray-400)' }}>to</span>
            <input
              type="date"
              className="form-control"
              style={{ width: 'auto', fontSize: '.83rem', padding: '.3rem .55rem' }}
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="spinner-center"><div className="spinner" /></div>
      )}

      {error && (
        <div className="alert alert-error">Failed to load appointments.</div>
      )}

      {!isLoading && !error && appointments.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                style={{ width: 40, height: 40, color: 'var(--gray-300)' }}>
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <p>No appointments found for the selected filters.</p>
          </div>
        </div>
      )}

      {!isLoading && appointments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          {appointments.map(appt => (
            <ApptCard
              key={appt.id}
              appt={appt}
              canAct={canAct}
              isCentral={isCentral}
              onAttend={setAttendTarget}
              queryKey={queryKey}
            />
          ))}
        </div>
      )}
    </>
  )
}
