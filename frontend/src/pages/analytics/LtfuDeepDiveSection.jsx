import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts'
import { getLtfuDeepDive, getLtfuRate } from '../../services/api'
import { ChartCard, StatCard, SectionHeading, ChartTooltip, rateColor } from './shared'

export default function LtfuDeepDiveSection({ fromDate, toDate, hospitalId }) {
  const params = { ...(fromDate ? { from_date: fromDate, to_date: toDate } : {}), ...(hospitalId ? { hospital_id: hospitalId } : {}) }

  const { data, isLoading } = useQuery({
    queryKey: ['analytics-ltfu-deep-dive', fromDate, toDate, hospitalId],
    queryFn: () => getLtfuDeepDive(params),
  })

  // LTFU-over-time always shown monthly, independent of the page's overall grouping
  const { data: overTimeData, isLoading: overTimeLoading } = useQuery({
    queryKey: ['analytics-ltfu-over-time', fromDate, toDate, hospitalId],
    queryFn: () => getLtfuRate({ ...params, group_by: 'month' }),
  })

  const byHospital = data?.by_hospital ?? []
  const byGaBand = data?.by_ga_band ?? []
  const overTime = overTimeData?.data ?? []

  return (
    <>
      <SectionHeading title="LTFU Analysis" sub="Loss-to-follow-up deep dive: where, when, and whether babies come back" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <StatCard value={isLoading ? '…' : data?.total_episodes} label="Total LTFU Episodes" sub="in period" color="var(--red-600)" icon="⚠" />
        <StatCard value={isLoading ? '…' : (data?.median_days_overdue != null ? `${data.median_days_overdue}d` : '-')} label="Median Days Overdue" sub="when flagged LTFU" color="var(--amber-600)" icon="⏱" />
        <StatCard value={isLoading ? '…' : (data?.recovery_rate != null ? `${data.recovery_rate}%` : '-')} label="Recovery Rate" sub="LTFU babies who came back" color="var(--teal-600)" icon="↩" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <ChartCard
          title="LTFU by Hospital"
          sub="Count and rate (green under 20%, amber 20-40%, red over 40%)"
          loading={isLoading}
          empty={!isLoading && byHospital.length === 0}
          emptyText="No LTFU data recorded yet"
        >
          <ResponsiveContainer width="100%" height={Math.max(220, byHospital.length * 28)}>
            <BarChart data={byHospital} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" />
              <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="hospital_name" width={140} tick={{ fontSize: 11, fill: 'var(--gray-600)' }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip valueLabel="%" />} cursor={{ fill: 'var(--gray-50)' }} />
              <Bar dataKey="rate" radius={[0, 4, 4, 0]} maxBarSize={18}>
                {byHospital.map(row => <Cell key={row.hospital_name} fill={rateColor(row.rate)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="LTFU by Gestational Age"
          sub="Which GA band is most likely to be lost"
          loading={isLoading}
          empty={!isLoading && byGaBand.every(b => b.ltfu_count === 0)}
          emptyText="No LTFU data recorded yet"
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byGaBand} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} domain={[0, 100]} unit="%" />
              <Tooltip content={<ChartTooltip valueLabel="%" />} cursor={{ fill: 'var(--gray-50)' }} />
              <Bar dataKey="rate" radius={[4, 4, 0, 0]} maxBarSize={48}>
                {byGaBand.map(row => <Cell key={row.band} fill={rateColor(row.rate)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard
        title="LTFU Rate Over Time"
        sub="Monthly trend: the clearest signal of whether the programme is improving"
        loading={overTimeLoading}
        empty={!overTimeLoading && overTime.length === 0}
        emptyText="No appointment data recorded yet"
      >
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={overTime} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} domain={[0, 100]} unit="%" />
            <Tooltip content={<ChartTooltip valueLabel="%" />} />
            <Line type="monotone" dataKey="rate" stroke="var(--red-600)" strokeWidth={2.5} dot={{ r: 3, fill: 'var(--red-600)', strokeWidth: 0 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </>
  )
}
