import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getAdminDashboard, getAdminHealth } from '../../services/adminApi'

function StatCard({ label, value, sub, accent, onClick }) {
  const [hovered, setHovered] = useState(false)
  const clickable = !!onClick

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => clickable && setHovered(true)}
      onMouseLeave={() => clickable && setHovered(false)}
      style={{
        background: '#fff',
        border: hovered ? `1px solid ${accent || '#3B82F6'}` : '1px solid #E2E8F0',
        borderRadius: 8,
        padding: '1.25rem 1.5rem',
        borderTop: `3px solid ${accent || '#3B82F6'}`,
        cursor: clickable ? 'pointer' : 'default',
        transition: 'border-color .15s, box-shadow .15s',
        boxShadow: hovered ? `0 0 0 3px ${accent}22` : 'none',
      }}
    >
      <div style={{ fontSize: '.75rem', color: '#64748B', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.4rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '2rem', fontWeight: 700, color: '#0F172A', lineHeight: 1 }}>
        {value ?? '—'}
      </div>
      {sub && (
        <div style={{ fontSize: '.75rem', color: '#94A3B8', marginTop: '.35rem' }}>{sub}</div>
      )}
      {clickable && (
        <div style={{ fontSize: '.7rem', color: hovered ? (accent || '#3B82F6') : '#CBD5E1', marginTop: '.5rem', transition: 'color .15s' }}>
          View details →
        </div>
      )}
    </div>
  )
}

function SectionHeader({ title }) {
  return (
    <h2 style={{
      fontSize: '.8rem', fontWeight: 600, color: '#94A3B8',
      textTransform: 'uppercase', letterSpacing: '.08em', margin: '0 0 .75rem',
    }}>
      {title}
    </h2>
  )
}

function HealthSummaryRow() {
  const navigate = useNavigate()
  const [hovered, setHovered] = useState(false)
  const { data } = useQuery({
    queryKey: ['admin-health'],
    queryFn: getAdminHealth,
    staleTime: 60_000,
  })

  let dot = 'grey'
  let label = 'System Health'
  let detail = 'Loading...'

  if (data) {
    const { sms, scheduler } = data
    const issues = []

    const schedLastRun = scheduler.last_any_run
    const schedAgeH = schedLastRun
      ? (Date.now() - new Date(schedLastRun).getTime()) / 3600000
      : null
    if (!scheduler.running) issues.push('scheduler stopped')
    else if (schedAgeH != null && schedAgeH > 48) issues.push('scheduler stale')

    if (!sms.at_simulating) {
      if (sms.delivery_rate_month != null && sms.delivery_rate_month < 75)
        issues.push('SMS delivery low')
      if (sms.at_balance != null && sms.at_balance < 2000)
        issues.push('AT balance critical')
    }

    if (issues.length === 0) {
      dot = 'green'
      detail = 'All systems operational'
    } else if (issues.length === 1) {
      dot = issues[0].includes('critical') || issues[0].includes('stopped') ? 'red' : 'yellow'
      detail = `1 issue: ${issues[0]}`
    } else {
      dot = 'red'
      detail = `${issues.length} issues detected`
    }
  }

  const dotColors = { green: '#10B981', yellow: '#F59E0B', red: '#EF4444', grey: '#CBD5E1' }

  return (
    <div
      onClick={() => navigate('/sys-mgmt/health')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '.75rem',
        padding: '.75rem 1rem',
        background: '#fff',
        border: hovered ? '1px solid #CBD5E1' : '1px solid #E2E8F0',
        borderRadius: 8,
        cursor: 'pointer',
        transition: 'border-color .15s',
      }}
    >
      <span style={{
        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
        background: dotColors[dot],
      }} />
      <span style={{ fontSize: '.85rem', fontWeight: 500, color: '#0F172A' }}>{label}</span>
      <span style={{ fontSize: '.82rem', color: '#64748B', flex: 1 }}>{detail}</span>
      <span style={{ fontSize: '.75rem', color: hovered ? '#3B82F6' : '#CBD5E1', transition: 'color .15s' }}>
        View →
      </span>
    </div>
  )
}

export default function AdminDashboardPage() {
  const navigate = useNavigate()
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: getAdminDashboard,
    refetchInterval: 60_000,
  })

  if (isLoading) return <div style={{ color: '#64748B' }}>Loading…</div>
  if (error) return <div style={{ color: '#EF4444' }}>Failed to load dashboard stats.</div>

  return (
    <div>
      <h1 style={{ margin: '0 0 .25rem', fontSize: '1.25rem', fontWeight: 700, color: '#0F172A' }}>
        Dashboard
      </h1>
      <p style={{ margin: '0 0 2rem', fontSize: '.85rem', color: '#64748B' }}>
        System-wide overview
      </p>

      <section style={{ marginBottom: '2rem' }}>
        <SectionHeader title="Hospitals" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
          <StatCard label="Total hospitals" value={data.total_hospitals} accent="#0EA5E9"
            onClick={() => navigate('/sys-mgmt/hospitals')} />
          <StatCard label="Active hospitals" value={data.active_hospitals}
            sub={`${data.total_hospitals - data.active_hospitals} inactive`} accent="#10B981"
            onClick={() => navigate('/sys-mgmt/hospitals')} />
        </div>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <SectionHeader title="Coordinators" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
          <StatCard label="Total coordinators" value={data.total_coordinators} accent="#8B5CF6"
            onClick={() => navigate('/sys-mgmt/coordinators')} />
          <StatCard label="Active" value={data.active_coordinators}
            sub={`${data.total_coordinators - data.active_coordinators} inactive`} accent="#10B981"
            onClick={() => navigate('/sys-mgmt/coordinators')} />
        </div>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <SectionHeader title="Clinical" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
          <StatCard label="Total babies enrolled" value={data.total_babies} accent="#0EA5E9"
            onClick={() => window.open('/', '_blank')} />
          <StatCard label="At-risk (untreated)" value={data.babies_at_risk} accent="#EF4444"
            onClick={() => window.open('/?urgency=at_risk', '_blank')} />
        </div>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <SectionHeader title="Activity" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
          <StatCard label="Audit entries (7 days)" value={data.recent_audit_entries} accent="#F59E0B" />
        </div>
      </section>

      <section>
        <SectionHeader title="System Health" />
        <HealthSummaryRow />
      </section>
    </div>
  )
}
