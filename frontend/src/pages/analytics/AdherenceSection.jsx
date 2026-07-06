import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts'
import { getAdherence } from '../../services/api'
import { ChartCard, StatCard, SectionHeading, ChartTooltip, LANGUAGE_LABELS } from './shared'

export default function AdherenceSection({ fromDate, toDate, hospitalId }) {
  const params = { ...(fromDate ? { from_date: fromDate, to_date: toDate } : {}), ...(hospitalId ? { hospital_id: hospitalId } : {}) }

  const { data, isLoading } = useQuery({
    queryKey: ['analytics-adherence', fromDate, toDate, hospitalId],
    queryFn: () => getAdherence(params),
  })

  const overTime = data?.over_time ?? []
  const byReminder = data?.by_reminder_status ?? []
  const byLanguage = (data?.by_language ?? []).map(l => ({ ...l, label: LANGUAGE_LABELS[l.language] ?? l.language }))

  return (
    <>
      <SectionHeading title="Appointment Adherence" sub="Attendance trends and what drives them" />

      <ChartCard
        title="Adherence Rate Over Time"
        sub="Percentage of appointments attended per month"
        loading={isLoading}
        empty={!isLoading && overTime.length === 0}
        emptyText="No appointment data recorded yet"
      >
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={overTime} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} domain={[0, 100]} unit="%" />
            <Tooltip content={<ChartTooltip valueLabel="%" />} />
            <Line type="monotone" dataKey="rate" stroke="var(--teal-600)" strokeWidth={2.5} dot={{ r: 3, fill: 'var(--teal-600)', strokeWidth: 0 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
        <ChartCard
          title="Adherence by Reminder Status"
          sub="Did an SMS reminder improve attendance?"
          loading={isLoading}
          empty={!isLoading && byReminder.every(g => g.total === 0)}
          emptyText="No reminder data recorded yet"
        >
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byReminder} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" />
              <XAxis dataKey="group" tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} domain={[0, 100]} unit="%" />
              <Tooltip content={<ChartTooltip valueLabel="%" />} cursor={{ fill: 'var(--gray-50)' }} />
              <Bar dataKey="rate" fill="var(--teal-500)" radius={[4, 4, 0, 0]} maxBarSize={64} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Adherence by Language"
          sub="Does a language-matched SMS improve attendance?"
          loading={isLoading}
          empty={!isLoading && byLanguage.length === 0}
          emptyText="No reminder data recorded yet"
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

        <StatCard
          value={isLoading ? '…' : (data?.avg_reminders_before_attendance ?? '-')}
          label="Avg Reminders Before Attendance"
          sub="per attended appointment"
          color="var(--gray-600)"
          icon="✉"
        />
      </div>
    </>
  )
}
