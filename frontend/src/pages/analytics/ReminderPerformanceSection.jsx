import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { getReminderPerformance } from '../../services/api'
import { ChartCard, StatCard, SectionHeading, ChartTooltip, LANGUAGE_LABELS } from './shared'

export default function ReminderPerformanceSection({ fromDate, toDate, hospitalId }) {
  const params = { ...(fromDate ? { from_date: fromDate, to_date: toDate } : {}), ...(hospitalId ? { hospital_id: hospitalId } : {}) }

  const { data, isLoading } = useQuery({
    queryKey: ['analytics-reminder-performance', fromDate, toDate, hospitalId],
    queryFn: () => getReminderPerformance(params),
  })

  const byCarrier = data?.by_carrier ?? []
  const byLanguage = (data?.by_language ?? []).map(l => ({ ...l, label: LANGUAGE_LABELS[l.language] ?? l.language }))
  const failedByReason = data?.failed_by_reason ?? []

  return (
    <>
      <SectionHeading title="Reminder System" sub="SMS delivery performance across carriers and languages" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <StatCard value={isLoading ? '…' : data?.total_sent} label="Total SMS Sent" sub="in period" color="var(--teal-600)" icon="✉" />
        <StatCard value={isLoading ? '…' : (data?.delivery_rate != null ? `${data.delivery_rate}%` : '-')} label="Delivery Rate" sub="successfully sent" color="var(--teal-600)" icon="✓" />
        <StatCard value={isLoading ? '…' : (data?.failure_rate != null ? `${data.failure_rate}%` : '-')} label="Failure Rate" sub="failed to send" color="var(--red-600)" icon="✕" />
        <StatCard value={isLoading ? '…' : (data?.avg_reminders_before_attendance ?? '-')} label="Avg Reminders / Attendance" sub="before baby was seen" color="var(--gray-600)" icon="🔁" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
        <ChartCard
          title="Delivery Rate by Carrier"
          sub="MTN vs Airtel"
          loading={isLoading}
          empty={!isLoading && byCarrier.every(c => c.total === 0)}
          emptyText="No SMS data recorded yet"
        >
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byCarrier} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" />
              <XAxis dataKey="carrier" tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} domain={[0, 100]} unit="%" />
              <Tooltip content={<ChartTooltip valueLabel="%" />} cursor={{ fill: 'var(--gray-50)' }} />
              <Bar dataKey="rate" fill="var(--teal-500)" radius={[4, 4, 0, 0]} maxBarSize={64} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Delivery Rate by Language"
          sub="Does message language affect delivery?"
          loading={isLoading}
          empty={!isLoading && byLanguage.length === 0}
          emptyText="No SMS data recorded yet"
        >
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byLanguage} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} domain={[0, 100]} unit="%" />
              <Tooltip content={<ChartTooltip valueLabel="%" />} cursor={{ fill: 'var(--gray-50)' }} />
              <Bar dataKey="rate" fill="var(--teal-600)" radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Failed Reminders by Reason"
          sub="Categorized, human-readable"
          loading={isLoading}
          empty={!isLoading && failedByReason.length === 0}
          emptyText="No failed reminders in this period"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {failedByReason.map(r => (
              <div key={r.reason} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.82rem', padding: '.4rem .6rem', background: 'var(--red-50)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--gray-700)' }}>{r.reason}</span>
                <span style={{ fontWeight: 700, color: 'var(--red-600)' }}>{r.count}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>
    </>
  )
}
