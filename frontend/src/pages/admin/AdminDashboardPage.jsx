import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getAdminDashboard, getAdminHealth, pingAdmin } from '../../services/adminApi'

/* ── Palette ─────────────────────────────────────────────────────────────────── */
const C = {
  bg:         '#0A0F1E',
  card:       '#1A2235',
  cardBorder: '#1E3A5F',
  teal:       '#1E3A5F',
  tealDeep:   '#162D4A',
  blue:       '#3B82F6',
  purple:     '#8B5CF6',
  red:        '#EF4444',
  amber:      '#F59E0B',
  green:      '#10B981',
  textLabel:  '#64748B',
  textBody:   '#CBD5E1',
  textMuted:  '#94A3B8',
  white:      '#F8FAFC',
}

/* ── Count-up hook: animates from previous value to target over 600ms ───────── */
function useCountUp(target, duration = 600) {
  const [val, setVal] = useState(0)
  const prev = useRef(0)
  useEffect(() => {
    if (target == null || Number.isNaN(target)) return
    const from = prev.current
    const to = target
    if (from === to) { setVal(to); return }
    let raf
    let startTs = null
    const tick = (ts) => {
      if (startTs == null) startTs = ts
      const p = Math.min((ts - startTs) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setVal(Math.round(from + (to - from) * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
      else prev.current = to
    }
    raf = requestAnimationFrame(tick)
    return () => raf && cancelAnimationFrame(raf)
  }, [target, duration])
  return val
}

function CountNum({ value, style }) {
  const numeric = typeof value === 'number' && !Number.isNaN(value)
  const animated = useCountUp(numeric ? value : null)
  return <span style={style}>{numeric ? animated.toLocaleString() : (value ?? 'n/a')}</span>
}

/* ── Helpers ─────────────────────────────────────────────────────────────────── */
function timeAgo(iso) {
  if (!iso) return 'n/a'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/* ── Row 1: stat card ────────────────────────────────────────────────────────── */
function StatCard({ label, value, sub, topColor, onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: C.card,
        border: `1px solid ${hover ? topColor : C.cardBorder}`,
        borderTop: `2px solid ${topColor}`,
        borderRadius: 4,
        padding: '1.15rem 1.35rem',
        cursor: 'pointer',
        transition: 'transform .15s, box-shadow .15s, border-color .15s',
        transform: hover ? 'translateY(-2px)' : 'none',
        boxShadow: hover ? `0 8px 24px rgba(0,0,0,.45), 0 0 0 1px ${topColor}33` : 'none',
      }}
    >
      <div style={{
        fontSize: 13, color: C.textMuted, fontWeight: 500, marginBottom: '.5rem',
      }}>
        {label}
      </div>
      <CountNum value={value} style={{
        fontSize: 36, fontWeight: 700, color: C.white, lineHeight: 1,
        display: 'block', letterSpacing: '-.02em',
      }} />
      <div style={{ fontSize: 12, color: C.textLabel, marginTop: '.5rem' }}>
        {sub}
      </div>
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '.04em',
        color: hover ? topColor : C.textLabel, marginTop: '.7rem',
        transition: 'color .15s',
      }}>
        VIEW &rarr;
      </div>
    </div>
  )
}

/* ── Section label ───────────────────────────────────────────────────────────── */
function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em',
      color: C.textLabel, fontWeight: 600, marginBottom: '.7rem',
    }}>
      {children}
    </div>
  )
}

/* ── Row 2: wide card wrapper ────────────────────────────────────────────────── */
function WideCard({ title, accent, children }) {
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.cardBorder}`,
      borderTop: `2px solid ${accent}`,
      borderRadius: 4,
      padding: '1.25rem 1.4rem',
    }}>
      <SectionLabel>{title}</SectionLabel>
      {children}
    </div>
  )
}

/* ── Key/value stat line ─────────────────────────────────────────────────────── */
function StatLine({ label, value, valueColor, count }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '.5rem 0', borderBottom: `1px solid ${C.bg}`,
    }}>
      <span style={{ fontSize: 13, color: C.textMuted }}>{label}</span>
      {count
        ? <CountNum value={value} style={{ fontSize: 18, fontWeight: 700, color: valueColor || C.white }} />
        : <span style={{ fontSize: 14, fontWeight: 600, color: valueColor || C.textBody, textAlign: 'right' }}>
            {value ?? 'n/a'}
          </span>}
    </div>
  )
}

/* ── Care funnel bar ─────────────────────────────────────────────────────────── */
function FunnelBar({ enrolled, screened, treated }) {
  const max = Math.max(enrolled || 0, 1)
  const rows = [
    { label: 'Enrolled', n: enrolled || 0, color: C.blue },
    { label: 'Screened', n: screened || 0, color: C.teal },
    { label: 'Treated',  n: treated  || 0, color: C.tealDeep },
  ]
  return (
    <div style={{ marginTop: '.9rem' }}>
      <SectionLabel>Care funnel</SectionLabel>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '.4rem' }}>
          <span style={{ fontSize: 12, color: C.textMuted, width: 64, flexShrink: 0 }}>{r.label}</span>
          <div style={{ flex: 1, height: 14, background: C.bg, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min((r.n / max) * 100, 100)}%`, height: '100%',
              background: r.color, transition: 'width .6s ease',
            }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.white, width: 44, textAlign: 'right' }}>
            {r.n}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ── Row 3: system status indicator ──────────────────────────────────────────── */
function StatusIndicator({ label, value, dotColor, pulse, onClick, last }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: 1, display: 'flex', alignItems: 'center', gap: '.6rem',
        padding: '.85rem 1.1rem',
        borderRight: last ? 'none' : `1px solid ${C.cardBorder}`,
        background: hover ? 'rgba(255,255,255,.03)' : 'transparent',
        cursor: 'pointer', transition: 'background .15s', minWidth: 0,
      }}
    >
      <span style={{
        color: dotColor,
        width: 9, height: 9, borderRadius: '50%', background: dotColor, flexShrink: 0,
        animation: pulse ? 'adminPulse 1.8s ease-out infinite' : 'none',
      }} />
      <span style={{ minWidth: 0 }}>
        <span style={{
          fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em',
          color: C.textLabel, fontWeight: 600, display: 'block',
        }}>
          {label}
        </span>
        <span style={{
          fontSize: 13, color: C.textBody, fontWeight: 500,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block',
        }}>
          {value}
        </span>
      </span>
    </div>
  )
}

/* ── Page ────────────────────────────────────────────────────────────────────── */
export default function AdminDashboardPage() {
  const navigate = useNavigate()

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: getAdminDashboard,
    refetchInterval: 60_000,
  })
  const { data: health } = useQuery({
    queryKey: ['admin-health'],
    queryFn: getAdminHealth,
    staleTime: 60_000,
  })

  // Live API latency probe
  const [api, setApi] = useState(null)   // { ok, ms }
  useEffect(() => {
    const t = performance.now()
    pingAdmin()
      .then(() => setApi({ ok: true, ms: Math.round(performance.now() - t) }))
      .catch(() => setApi({ ok: false, ms: null }))
  }, [])

  if (isLoading) {
    return <div style={{ color: C.textMuted, fontSize: 14 }}>Loading control panel...</div>
  }
  if (error) {
    return <div style={{ color: C.red, fontSize: 14 }}>Failed to load dashboard stats.</div>
  }

  const inactiveHospitals = (data.total_hospitals || 0) - (data.active_hospitals || 0)

  /* ── System status computations ──────────────────────────────────────────── */
  const sms = health?.sms || {}
  const scheduler = health?.scheduler || {}
  const dbBytes = health?.db?.size_bytes || 0
  const dbMb = dbBytes / 1e6

  // API
  const apiStatus = api == null
    ? { value: 'Checking...', dot: C.textLabel, pulse: false }
    : api.ok
      ? { value: `Online (${api.ms}ms)`, dot: C.green, pulse: false }
      : { value: 'Unreachable', dot: C.red, pulse: true }

  // Database
  const dbWarn = dbMb > 400
  const dbStatus = health
    ? { value: `${dbMb.toFixed(1)} MB / 500 MB`, dot: dbWarn ? C.amber : C.green, pulse: dbWarn }
    : { value: 'n/a', dot: C.textLabel, pulse: false }

  // Scheduler
  let schedStatus = { value: 'n/a', dot: C.textLabel, pulse: false }
  if (health) {
    const lastRun = scheduler.last_any_run
    const ageH = lastRun ? (Date.now() - new Date(lastRun).getTime()) / 3600000 : null
    if (!scheduler.running) {
      schedStatus = { value: 'Stopped', dot: C.red, pulse: true }
    } else if (ageH != null && ageH > 26) {
      schedStatus = { value: `Stale (last run ${timeAgo(lastRun)})`, dot: C.amber, pulse: true }
    } else {
      schedStatus = {
        value: lastRun ? `Running (last run ${timeAgo(lastRun)})` : 'Running',
        dot: C.green, pulse: false,
      }
    }
  }

  // SMS gateway
  const smsStatus = health
    ? sms.at_simulating
      ? { value: 'Sandbox mode', dot: C.amber, pulse: false }
      : { value: 'Live', dot: C.green, pulse: false }
    : { value: 'n/a', dot: C.textLabel, pulse: false }

  const mostActive  = data.most_active_hospital
  const leastActive = data.least_active_hospital

  const cardGap = '1rem'

  return (
    <div>
      <style>{`
        @keyframes adminPulse {
          0%   { box-shadow: 0 0 0 0 currentColor; }
          70%  { box-shadow: 0 0 0 6px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
      `}</style>

      {/* Header */}
      <h1 style={{ margin: '0 0 .2rem', fontSize: 22, fontWeight: 700, color: C.white }}>
        System Overview
      </h1>
      <p style={{ margin: '0 0 1.5rem', fontSize: 13, color: C.textMuted }}>
        Network-wide control panel : data refreshes every 60 seconds
      </p>

      {/* ── Row 1: four stat cards ─────────────────────────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: cardGap, marginBottom: '1.25rem',
      }}>
        <StatCard
          label="Total Hospitals" value={data.total_hospitals}
          sub={`${data.active_hospitals} active`} topColor={C.teal}
          onClick={() => navigate('/sys-mgmt/hospitals')}
        />
        <StatCard
          label="Active Hospitals" value={data.active_hospitals}
          sub={`${inactiveHospitals} inactive`} topColor={C.teal}
          onClick={() => navigate('/sys-mgmt/hospitals')}
        />
        <StatCard
          label="Total Coordinators" value={data.total_coordinators}
          sub={`${data.active_coordinators} active`} topColor={C.purple}
          onClick={() => navigate('/sys-mgmt/coordinators')}
        />
        <StatCard
          label="Total Babies" value={data.total_babies}
          sub={`${data.babies_at_risk} at-risk`} topColor={C.blue}
          onClick={() => window.open('/', '_blank')}
        />
      </div>

      {/* ── Row 2: two wide cards ──────────────────────────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: cardGap, marginBottom: '1.25rem',
      }}>
        <WideCard title="Clinical Overview" accent={C.blue}>
          <StatLine label="Total babies enrolled" value={data.total_babies} count valueColor={C.white} />
          <StatLine label="At-risk (untreated)" value={data.babies_at_risk} count valueColor={C.red} />
          <StatLine label="LTFU this month" value={data.ltfu_this_month} count valueColor={C.amber} />
          <StatLine label="Exams this week" value={health?.activity?.exams_this_week} count valueColor={C.white} />
          <FunnelBar
            enrolled={data.total_babies}
            screened={data.babies_screened}
            treated={data.babies_treated}
          />
        </WideCard>

        <WideCard title="Network Activity" accent={C.teal}>
          <StatLine label="Last activity" value={timeAgo(health?.activity?.last_activity)} />
          <StatLine label="Logins today" value={health?.activity?.logins_today} count valueColor={C.white} />
          <StatLine
            label="Most active hospital today"
            value={mostActive?.name || 'No activity yet'}
            valueColor={C.teal}
          />
          {mostActive?.detail && (
            <div style={{ fontSize: 11, color: C.textLabel, textAlign: 'right', marginTop: '-.35rem', paddingBottom: '.35rem' }}>
              {mostActive.detail}
            </div>
          )}
          <StatLine
            label="Least active hospital"
            value={leastActive?.name || 'n/a'}
            valueColor={leastActive?.needs_attention ? C.amber : C.textBody}
          />
          {leastActive?.detail && (
            <div style={{
              fontSize: 11, textAlign: 'right', marginTop: '-.35rem', paddingBottom: '.35rem',
              color: leastActive.needs_attention ? C.amber : C.textLabel,
            }}>
              {leastActive.needs_attention ? '⚠ ' : ''}{leastActive.detail}
            </div>
          )}
          <StatLine
            label="SMS sent today"
            value={
              health
                ? `${health.sms?.sent_today ?? 0}` +
                  (health.sms?.delivery_rate_month != null
                    ? `  (${health.sms.delivery_rate_month}% delivered)` : '')
                : 'n/a'
            }
            valueColor={C.white}
          />
        </WideCard>
      </div>

      {/* ── Row 3: system status bar ───────────────────────────────────────── */}
      <SectionLabel>System Status</SectionLabel>
      <div style={{
        display: 'flex', background: C.card,
        border: `1px solid ${C.cardBorder}`, borderRadius: 4, overflow: 'hidden',
      }}>
        <StatusIndicator
          label="API" value={apiStatus.value} dotColor={apiStatus.dot} pulse={apiStatus.pulse}
          onClick={() => navigate('/sys-mgmt/health')}
        />
        <StatusIndicator
          label="Database" value={dbStatus.value} dotColor={dbStatus.dot} pulse={dbStatus.pulse}
          onClick={() => navigate('/sys-mgmt/health')}
        />
        <StatusIndicator
          label="Scheduler" value={schedStatus.value} dotColor={schedStatus.dot} pulse={schedStatus.pulse}
          onClick={() => navigate('/sys-mgmt/health')}
        />
        <StatusIndicator
          label="SMS Gateway" value={smsStatus.value} dotColor={smsStatus.dot} pulse={smsStatus.pulse}
          onClick={() => navigate('/sys-mgmt/health')} last
        />
      </div>
    </div>
  )
}
