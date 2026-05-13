import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAdminHealth, pingAdmin } from '../../services/adminApi'

const DB_FREE_TIER_BYTES = 500 * 1024 * 1024  // 500 MB Render free tier

const ALERT_LABELS = {
  sms_delivery_rate: 'SMS delivery rate dropped below 75%',
  at_balance_low: "Africa's Talking balance critically low",
  scheduler_stale: 'Reminder scheduler not running for over 26 hours',
}

const JOB_LABELS = {
  reminder_t_minus_3:         '3-Day Reminder SMS',
  reminder_t_minus_1:         '1-Day Reminder SMS',
  mark_missed_ltfu:           'Mark Missed Appointments',
  escalate_screening_requests: 'Escalate Unactioned Screening Requests',
}

const AT_SANDBOX_TOOLTIP =
  "This value is estimated because the Africa's Talking sandbox does not return real balance data. " +
  "Connect a live AT account to see actual balance."

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtBytes(bytes) {
  if (bytes == null) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtAgo(isoStr) {
  if (!isoStr) return 'never'
  const secs = Math.round((Date.now() - new Date(isoStr).getTime()) / 1000)
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function fmtIn(isoStr) {
  if (!isoStr) return null
  const ms = new Date(isoStr).getTime() - Date.now()
  if (ms <= 0) return null
  const secs = Math.round(ms / 1000)
  if (secs < 60) return `in ${secs}s`
  if (secs < 3600) return `in ${Math.floor(secs / 60)}m`
  return `in ${Math.floor(secs / 3600)}h`
}

function fmtDuration(ms) {
  const secs = Math.round(Math.abs(ms) / 1000)
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  return `${Math.floor(secs / 3600)}h`
}

function fmtDatetime(isoStr) {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

// ── Primitives ────────────────────────────────────────────────────────────────

function Dot({ status, size = 10 }) {
  const colors = {
    green: '#10B981',
    yellow: '#F59E0B',
    red: '#EF4444',
    blue: '#3B82F6',
    grey: '#CBD5E1',
  }
  return (
    <span style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      background: colors[status] || colors.grey, flexShrink: 0,
    }} />
  )
}

function InfoTooltip({ text }) {
  const [show, setShow] = useState(false)
  return (
    <span
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'help' }}
    >
      <span style={{
        fontSize: '.65rem', color: '#94A3B8', border: '1px solid #CBD5E1',
        borderRadius: '50%', width: 13, height: 13, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', lineHeight: 1, flexShrink: 0,
      }}>?</span>
      {show && (
        <span style={{
          position: 'absolute', bottom: 'calc(100% + 5px)', left: '50%',
          transform: 'translateX(-50%)',
          background: '#1E293B', color: '#E2E8F0',
          fontSize: '.72rem', lineHeight: 1.5,
          padding: '.4rem .6rem', borderRadius: 5,
          width: 240, zIndex: 50, pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,.25)',
          whiteSpace: 'normal',
        }}>
          {text}
        </span>
      )}
    </span>
  )
}

// labelSub: small grey subtitle under the label text
// subColor: override colour of the sub (right-side) annotation
function HealthRow({ label, labelSub, value, status, sub, subColor }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '.5rem',
      padding: '.4rem 0', borderBottom: '1px solid #F1F5F9',
    }}>
      <Dot status={status} style={{ marginTop: 3 }} />
      <span style={{ fontSize: '.82rem', color: '#475569', flex: 1 }}>
        {label}
        {labelSub && (
          <span style={{ display: 'block', fontSize: '.7rem', color: '#94A3B8', marginTop: '.1rem' }}>
            {labelSub}
          </span>
        )}
      </span>
      <span style={{ fontSize: '.85rem', fontWeight: 600, color: '#0F172A', display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}>
        {value ?? '—'}
      </span>
      {sub && (
        <span style={{ fontSize: '.72rem', color: subColor || '#94A3B8', marginLeft: '.1rem', whiteSpace: 'nowrap' }}>
          {sub}
        </span>
      )}
    </div>
  )
}

function HealthCard({ title, accent, children }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #E2E8F0', borderTop: `3px solid ${accent}`,
      borderRadius: 8, padding: '1rem 1.25rem',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.6rem' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

// ── Recent Alerts ─────────────────────────────────────────────────────────────

function RecentAlerts({ alerts }) {
  if (!alerts || alerts.length === 0) {
    return (
      <div style={{
        background: '#F0FDF4', border: '1px solid #BBF7D0',
        borderLeft: '3px solid #10B981', borderRadius: 8,
        padding: '1rem 1.25rem',
        display: 'flex', alignItems: 'center', gap: '.6rem',
        fontSize: '.83rem', color: '#166534', fontWeight: 500,
      }}>
        <Dot status="green" />
        No alerts in the last 7 days — all systems stable.
      </div>
    )
  }

  return (
    <div style={{
      background: '#FEF2F2', border: '1px solid #FECACA',
      borderLeft: '3px solid #EF4444', borderRadius: 8,
      padding: '1rem 1.25rem',
    }}>
      {alerts.map((a, i) => (
        <div key={a.id} style={{
          display: 'flex', alignItems: 'flex-start', gap: '.65rem',
          paddingBottom: i < alerts.length - 1 ? '.85rem' : 0,
          marginBottom: i < alerts.length - 1 ? '.85rem' : 0,
          borderBottom: i < alerts.length - 1 ? '1px solid #FECACA' : 'none',
        }}>
          <Dot status="red" size={8} style={{ marginTop: 4 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '.83rem', fontWeight: 600, color: '#991B1B' }}>
              {ALERT_LABELS[a.alert_key] || a.alert_key.replace(/_/g, ' ')}
            </div>
            <div style={{ fontSize: '.75rem', color: '#64748B', marginTop: '.2rem' }}>
              {a.message}
            </div>
          </div>
          <span style={{ fontSize: '.72rem', color: '#EF4444', flexShrink: 0, paddingTop: '.15rem', fontWeight: 500 }}>
            {fmtDatetime(a.created_at)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminHealthPage() {
  const [latencyMs, setLatencyMs] = useState(null)
  const [secondsAgo, setSecondsAgo] = useState(0)
  const fetchedAtRef = useRef(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-health'],
    queryFn: getAdminHealth,
    refetchInterval: 60_000,
  })

  useEffect(() => {
    async function measure() {
      const t0 = performance.now()
      try { await pingAdmin() } catch (_) {}
      setLatencyMs(Math.round(performance.now() - t0))
    }
    measure()
    const id = setInterval(measure, 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (data?.fetched_at) fetchedAtRef.current = data.fetched_at
    const id = setInterval(() => {
      if (fetchedAtRef.current) {
        setSecondsAgo(Math.round((Date.now() - new Date(fetchedAtRef.current).getTime()) / 1000))
      }
    }, 1000)
    return () => clearInterval(id)
  }, [data])

  if (isLoading) return <div style={{ color: '#64748B' }}>Loading health data…</div>
  if (error) return <div style={{ color: '#EF4444' }}>Failed to load health data.</div>

  const { sms, activity, scheduler, db } = data
  const recentAlerts = data.recent_alerts ?? []

  // ── Status computations ───────────────────────────────────────────────────
  const smsDeliveryStatus = sms.at_simulating || sms.delivery_rate_month == null ? 'grey'
    : sms.delivery_rate_month >= 90 ? 'green'
    : sms.delivery_rate_month >= 75 ? 'yellow'
    : 'red'

  const atStatus = sms.at_simulating || sms.at_balance == null ? 'grey'
    : sms.at_balance >= 5000 ? 'green'
    : sms.at_balance >= 2000 ? 'yellow'
    : 'red'

  const schedLastRun = scheduler.last_any_run
  const schedAgeH = schedLastRun
    ? (Date.now() - new Date(schedLastRun).getTime()) / 3600000
    : null
  const schedStatus = !scheduler.running ? 'red'
    : schedAgeH == null ? 'grey'
    : schedAgeH < 25 ? 'green'
    : schedAgeH < 48 ? 'yellow'
    : 'red'

  const lastActivityAgeH = activity.last_activity
    ? (Date.now() - new Date(activity.last_activity).getTime()) / 3600000
    : null
  const lastActivityStatus = lastActivityAgeH == null ? 'grey'
    : lastActivityAgeH < 4 ? 'green'
    : lastActivityAgeH < 24 ? 'blue'
    : 'yellow'

  // ── Alert banners ─────────────────────────────────────────────────────────
  const alerts = []
  if (smsDeliveryStatus === 'red')
    alerts.push(`SMS delivery rate is ${sms.delivery_rate_month}% this month (below 75% threshold).`)
  if (atStatus === 'red')
    alerts.push(`Africa's Talking balance is critically low: ${sms.at_balance?.toLocaleString()} UGX.`)
  if (schedStatus === 'red' && !scheduler.running)
    alerts.push('Reminder scheduler is NOT running. Background jobs are halted.')
  if (schedStatus === 'red' && scheduler.running && schedAgeH > 48)
    alerts.push(`Scheduler jobs have not run in over ${Math.round(schedAgeH)} hours.`)

  // ── DB size display ───────────────────────────────────────────────────────
  const dbPct = db.size_bytes ? ((db.size_bytes / DB_FREE_TIER_BYTES) * 100).toFixed(1) : null
  const dbValue = db.size_bytes
    ? `${fmtBytes(db.size_bytes)} / 500 MB`
    : '—'
  const dbSub = dbPct ? `${dbPct}% used` : undefined
  const dbStatus = dbPct == null ? 'grey'
    : dbPct < 60 ? 'blue'
    : dbPct < 85 ? 'yellow'
    : 'red'

  // ── Simulated labels (with tooltip) ──────────────────────────────────────
  const simulatedLabel = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}>
      Simulated
      <InfoTooltip text={AT_SANDBOX_TOOLTIP} />
    </span>
  )
  const sandboxLabel = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}>
      Sandbox mode
      <InfoTooltip text={AT_SANDBOX_TOOLTIP} />
    </span>
  )

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <div>
          <h1 style={{ margin: '0 0 .25rem', fontSize: '1.25rem', fontWeight: 700, color: '#0F172A' }}>
            System Health
          </h1>
          <p style={{ margin: 0, fontSize: '.85rem', color: '#64748B' }}>
            Live platform monitoring - refreshes every 60 seconds
          </p>
        </div>
        <span style={{ fontSize: '.72rem', color: '#94A3B8', paddingTop: '.25rem' }}>
          Updated {secondsAgo < 5 ? 'just now' : `${secondsAgo}s ago`} — auto-refreshes every 60s
        </span>
      </div>

      {/* Alert banners */}
      {alerts.map((msg, i) => (
        <div key={i} style={{
          background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6,
          padding: '.6rem 1rem', marginBottom: '.5rem', fontSize: '.82rem',
          color: '#991B1B', display: 'flex', gap: '.5rem', alignItems: 'flex-start',
        }}>
          <span>&#9888;</span>
          <span>{msg}</span>
        </div>
      ))}

      {/* Cards — 2x2 grid: SMS+Activity row 1, Pipeline+Server row 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '2rem' }}>

        <HealthCard title="SMS Reminders" accent="#8B5CF6">
          <HealthRow label="Sent Today"
            value={sms.sent_today}
            status={sms.sent_today > 0 ? 'green' : 'blue'} />
          <HealthRow label="Sent This Week"
            value={sms.sent_this_week}
            status="blue" />
          <HealthRow label="Failed This Week"
            value={sms.failed_this_week}
            status={sms.failed_this_week === 0 ? 'green' : sms.failed_this_week < 5 ? 'yellow' : 'red'} />
          <HealthRow label="Delivery Rate (30d)"
            value={sms.at_simulating ? simulatedLabel : sms.delivery_rate_month != null ? `${sms.delivery_rate_month}%` : '—'}
            status={smsDeliveryStatus} />
          <HealthRow label="AT Balance"
            value={sms.at_simulating ? sandboxLabel : sms.at_balance != null ? `${sms.at_balance.toLocaleString()} UGX` : '—'}
            status={atStatus} />
        </HealthCard>

        <HealthCard title="Application Activity" accent="#0EA5E9">
          <HealthRow
            label="Active Users (15 min)"
            labelSub="Users active in the last 15 minutes"
            value={activity.active_users_15m}
            status={activity.active_users_15m > 0 ? 'green' : 'blue'} />
          <HealthRow label="Logins Today"
            value={activity.logins_today}
            status="blue" />
          <HealthRow label="Enrollments Today"
            value={activity.enrollments_today}
            status="blue" />
          <HealthRow label="Enrollments This Week"
            value={activity.enrollments_this_week}
            status="blue" />
          <HealthRow label="Exams This Week"
            value={activity.exams_this_week}
            status="blue" />
          <HealthRow label="Last Activity"
            value={fmtAgo(activity.last_activity)}
            status={lastActivityStatus} />
        </HealthCard>

        <HealthCard title="Reminder Pipeline" accent="#F59E0B">
          <HealthRow label="Scheduler Status"
            value={scheduler.running ? 'Running' : 'Stopped'}
            status={scheduler.running ? 'green' : 'red'} />
          <HealthRow label="Last Job Run"
            value={fmtAgo(scheduler.last_any_run)}
            status={schedStatus} />
          {Object.entries(scheduler.jobs || {}).map(([id, j]) => {
            const isOverdue = j.next_run && new Date(j.next_run).getTime() < Date.now()
            const overdueMs = isOverdue ? Date.now() - new Date(j.next_run).getTime() : 0
            const nextSub = isOverdue
              ? `Overdue by ${fmtDuration(overdueMs)}`
              : (fmtIn(j.next_run) ? `next: ${fmtIn(j.next_run)}` : undefined)
            const jobStatus = isOverdue ? 'yellow' : j.last_run ? 'green' : 'grey'
            return (
              <HealthRow key={id}
                label={JOB_LABELS[id] || id.replace(/_/g, ' ')}
                value={j.last_run ? fmtAgo(j.last_run) : 'pending'}
                sub={nextSub}
                subColor={isOverdue ? '#F59E0B' : undefined}
                status={jobStatus} />
            )
          })}
        </HealthCard>

        <HealthCard title="Server &amp; Database" accent="#10B981">
          <HealthRow label="API Latency"
            value={latencyMs != null ? `${latencyMs} ms` : '—'}
            status={latencyMs == null ? 'grey' : latencyMs < 200 ? 'green' : latencyMs < 500 ? 'yellow' : 'red'} />
          <HealthRow label="DB Size"
            value={dbValue}
            sub={dbSub}
            status={dbStatus} />
        </HealthCard>
      </div>

      {/* Recent Alerts */}
      <div>
        <h2 style={{ fontSize: '.8rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '.08em', margin: '0 0 .75rem' }}>
          Recent Alerts (last 7 days)
        </h2>
        <RecentAlerts alerts={recentAlerts} />
      </div>
    </div>
  )
}
