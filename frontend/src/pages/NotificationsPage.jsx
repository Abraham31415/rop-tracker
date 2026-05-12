import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { formatDistanceToNow, format } from 'date-fns'
import { getNotifications, dismissAlert, getPendingScreeningRequests, claimScreeningRequest } from '../services/api'
import { useAuth } from '../contexts/AuthContext'

const TYPE_META = {
  ltfu:      { label: 'LTFU',        cls: 'notif-ltfu',     icon: '!' },
  missed:    { label: 'Missed',      cls: 'notif-missed',   icon: '!' },
  due_today: { label: 'Due Today',   cls: 'notif-due',      icon: '~' },
  sms_failed:{ label: 'SMS Failed',  cls: 'notif-sms',      icon: 'x' },
}

const TYPE_ORDER = { ltfu: 0, missed: 1, due_today: 2, sms_failed: 3 }

function NotifCard({ item, onDismiss }) {
  const meta = TYPE_META[item.type] || { label: item.type, cls: '', icon: '•' }
  const ts = item.triggered_at ? new Date(item.triggered_at) : null
  return (
    <div className={`notif-card ${meta.cls}`}>
      <div className="notif-card-icon">{meta.icon}</div>
      <div className="notif-card-body">
        <div className="notif-card-header-row">
          <span className={`notif-type-badge ${meta.cls}`}>{meta.label}</span>
          {ts && (
            <span className="notif-time" title={format(ts, 'dd MMM yyyy HH:mm')}>
              {formatDistanceToNow(ts, { addSuffix: true })}
            </span>
          )}
        </div>
        <div className="notif-title">{item.title}</div>
        <div className="notif-body">{item.body}</div>
        <div className="notif-actions">
          {item.baby_id && (
            <Link to={`/babies/${item.baby_id}`} className="btn btn-secondary btn-sm">
              View Baby Record
            </Link>
          )}
          {item.is_dismissible && item.alert_id && (
            <button className="btn btn-ghost btn-sm" onClick={() => onDismiss(item.alert_id)}>
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ScreeningRequestsPanel() {
  const qc = useQueryClient()
  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['pending-screening-requests'],
    queryFn: getPendingScreeningRequests,
    refetchInterval: 30_000,
  })
  const claim = useMutation({
    mutationFn: claimScreeningRequest,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pending-screening-requests'] }),
  })

  if (isLoading || requests.length === 0) return null

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div className="notif-section-label" style={{ color: '#7c3aed' }}>
        Screening Requests ({requests.length})
      </div>
      {requests.map(req => (
        <div key={req.id} className="notif-card" style={{ borderLeft: '4px solid #7c3aed' }}>
          <div className="notif-card-icon" style={{ background: '#f5f3ff', color: '#7c3aed' }}>🔬</div>
          <div className="notif-card-body">
            <div className="notif-card-header-row">
              <span className="notif-type-badge" style={{ background: '#f5f3ff', color: '#7c3aed' }}>
                {req.status === 'claimed' ? 'Claimed by you' : 'Pending'}
              </span>
              <span className="notif-time">{formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}</span>
            </div>
            <div className="notif-title">{req.baby_name}</div>
            <div className="notif-body">
              Requested by {req.requested_by_name}
              {req.notes && ` - ${req.notes}`}
            </div>
            <div className="notif-actions">
              {req.baby_id && <Link to={`/babies/${req.baby_id}`} className="btn btn-secondary btn-sm">View Baby</Link>}
              {req.status === 'pending' && (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={claim.isPending}
                  onClick={() => claim.mutate(req.id)}
                >
                  I will examine this baby
                </button>
              )}
              {req.status === 'claimed' && req.baby_id && (
                <Link to={`/babies/${req.baby_id}/exam`} className="btn btn-primary btn-sm">Record Exam</Link>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function NotificationsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const isOphthalm = user?.role === 'ophthalmologist'

  const { data: notifications = [], isLoading, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: getNotifications,
    refetchInterval: 60_000,
    enabled: !isOphthalm,
  })

  const dismiss = useMutation({
    mutationFn: dismissAlert,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['alerts'] })
      qc.invalidateQueries({ queryKey: ['alert-count'] })
    },
  })

  const grouped = { ltfu: [], missed: [], due_today: [], sms_failed: [] }
  notifications.forEach(n => {
    if (grouped[n.type]) grouped[n.type].push(n)
    else grouped.sms_failed.push(n)
  })

  const counts = {
    ltfu: grouped.ltfu.length,
    missed: grouped.missed.length,
    due_today: grouped.due_today.length,
    sms_failed: grouped.sms_failed.length,
  }
  const total = notifications.length

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h2>Notifications</h2>
          <p>{isOphthalm ? 'Screening requests assigned to you' : `${total} active notification${total !== 1 ? 's' : ''}`}</p>
        </div>
        {!isOphthalm && <button className="btn btn-secondary btn-sm" onClick={() => refetch()}>Refresh</button>}
      </div>

      {/* Ophthalmologist view: screening requests */}
      {isOphthalm && <ScreeningRequestsPanel />}

      {/* Coordinator view: standard alerts */}
      {!isOphthalm && (
        <>
          <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            {[
              { key: 'ltfu',       label: 'LTFU alerts',   cls: 'notif-ltfu' },
              { key: 'missed',     label: 'Missed appts',  cls: 'notif-missed' },
              { key: 'due_today',  label: 'Due today',     cls: 'notif-due' },
              { key: 'sms_failed', label: 'SMS failures',  cls: 'notif-sms' },
            ].map(({ key, label, cls }) => (
              <div key={key} className={`notif-count-chip ${cls}`}>
                <span className="notif-count-chip-num">{counts[key]}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>

          {isLoading ? (
            <div className="spinner-center"><div className="spinner" /></div>
          ) : total === 0 ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon" style={{ fontSize: '2.5rem' }}>✓</div>
                <p style={{ fontWeight: 600 }}>All clear - no active notifications</p>
                <p style={{ fontSize: '.85rem', color: 'var(--gray-400)', marginTop: '.25rem' }}>
                  LTFU alerts, missed appointments, and SMS failures will appear here.
                </p>
              </div>
            </div>
          ) : (
            <div className="notif-list">
              {['ltfu', 'missed', 'due_today', 'sms_failed'].map(type => (
                grouped[type].length > 0 && (
                  <div key={type}>
                    <div className="notif-section-label">
                      {TYPE_META[type]?.label} ({grouped[type].length})
                    </div>
                    {grouped[type].map(item => (
                      <NotifCard key={item.id} item={item} onDismiss={id => dismiss.mutate(id)} />
                    ))}
                  </div>
                )
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
