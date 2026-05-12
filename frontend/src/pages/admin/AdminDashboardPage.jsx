import { useQuery } from '@tanstack/react-query'
import { getAdminDashboard } from '../../services/adminApi'

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #E2E8F0',
      borderRadius: 8,
      padding: '1.25rem 1.5rem',
      borderTop: `3px solid ${accent || '#3B82F6'}`,
    }}>
      <div style={{ fontSize: '.75rem', color: '#64748B', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.4rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '2rem', fontWeight: 700, color: '#0F172A', lineHeight: 1 }}>
        {value ?? '—'}
      </div>
      {sub && (
        <div style={{ fontSize: '.75rem', color: '#94A3B8', marginTop: '.35rem' }}>{sub}</div>
      )}
    </div>
  )
}

export default function AdminDashboardPage() {
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
        <h2 style={{ fontSize: '.8rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '.08em', margin: '0 0 .75rem' }}>
          Hospitals
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
          <StatCard label="Total hospitals" value={data.total_hospitals} accent="#0EA5E9" />
          <StatCard label="Active hospitals" value={data.active_hospitals}
            sub={`${data.total_hospitals - data.active_hospitals} inactive`} accent="#10B981" />
        </div>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '.8rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '.08em', margin: '0 0 .75rem' }}>
          Coordinators
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
          <StatCard label="Total coordinators" value={data.total_coordinators} accent="#8B5CF6" />
          <StatCard label="Active" value={data.active_coordinators}
            sub={`${data.total_coordinators - data.active_coordinators} inactive`} accent="#10B981" />
        </div>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '.8rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '.08em', margin: '0 0 .75rem' }}>
          Clinical
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
          <StatCard label="Total babies enrolled" value={data.total_babies} accent="#0EA5E9" />
          <StatCard label="At-risk (untreated)" value={data.babies_at_risk} accent="#EF4444" />
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: '.8rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '.08em', margin: '0 0 .75rem' }}>
          Activity
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
          <StatCard label="Audit entries (7 days)" value={data.recent_audit_entries} accent="#F59E0B" />
        </div>
      </section>
    </div>
  )
}
