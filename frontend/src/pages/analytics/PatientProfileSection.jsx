import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { getPatientProfile } from '../../services/api'
import { ChartCard, SectionHeading, ChartTooltip } from './shared'

const STAGE_RANK_LABELS = { '-1': 'No ROP', '0': 'Immature', '1': 'Stage 1', '2': 'Stage 2', '3': 'Stage 3', '4': 'Stage 4', '5': 'Stage 5' }

export default function PatientProfileSection({ fromDate, toDate, hospitalId }) {
  const params = { ...(fromDate ? { from_date: fromDate, to_date: toDate } : {}), ...(hospitalId ? { hospital_id: hospitalId } : {}) }

  const { data, isLoading } = useQuery({
    queryKey: ['analytics-patient-profile', fromDate, toDate, hospitalId],
    queryFn: () => getPatientProfile(params),
  })

  const gaHistogram = data?.ga_histogram ?? []
  const weightBands = data?.weight_bands ?? []
  const riskFrequency = data?.risk_factor_frequency ?? []
  const correlation = data?.risk_factor_stage_correlation ?? []

  return (
    <>
      <SectionHeading title="Patient Profile" sub="Gestational age, birth weight, and risk factor distribution" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <ChartCard
          title="Gestational Age Distribution"
          sub="Babies by GA at birth, 2-week bands"
          loading={isLoading}
          empty={!isLoading && gaHistogram.length === 0}
          emptyText="No babies enrolled in this period"
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={gaHistogram} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" />
              <XAxis dataKey="band" tick={{ fontSize: 10, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip valueLabel=" babies" />} cursor={{ fill: 'var(--gray-50)' }} />
              <Bar dataKey="count" fill="var(--teal-500)" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Birth Weight Distribution"
          sub="Babies by weight band"
          loading={isLoading}
          empty={!isLoading && weightBands.every(w => w.count === 0)}
          emptyText="No babies enrolled in this period"
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weightBands} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip valueLabel=" babies" />} cursor={{ fill: 'var(--gray-50)' }} />
              <Bar dataKey="count" fill="var(--amber-500)" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard
        title="Risk Factor Frequency"
        sub="How many babies had each risk factor, most common first"
        loading={isLoading}
        empty={!isLoading && riskFrequency.every(r => r.count === 0)}
        emptyText="No babies enrolled in this period"
      >
        <ResponsiveContainer width="100%" height={Math.max(240, riskFrequency.length * 32)}>
          <BarChart data={riskFrequency} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" />
            <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 11, fill: 'var(--gray-600)' }} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip valueLabel=" babies" />} cursor={{ fill: 'var(--gray-50)' }} />
            <Bar dataKey="count" fill="var(--teal-600)" radius={[0, 4, 4, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="card" style={{ marginTop: '1rem', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem .5rem', fontWeight: 700, fontSize: '.9rem', color: 'var(--gray-900)' }}>
          Risk Factor vs. ROP Severity
        </div>
        <div style={{ padding: '0 1.25rem .5rem', fontSize: '.78rem', color: 'var(--gray-400)' }}>
          Average worst-ever ROP stage among babies with each risk factor (higher = more severe)
        </div>
        {correlation.every(c => c.n === 0) ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--gray-400)', fontSize: '.85rem' }}>
            No exam data recorded yet
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
              <thead>
                <tr style={{ background: 'var(--gray-50)' }}>
                  <th style={{ padding: '.6rem .9rem', textAlign: 'left', fontWeight: 600, color: 'var(--gray-500)', fontSize: '.75rem', textTransform: 'uppercase' }}>Risk Factor</th>
                  <th style={{ padding: '.6rem .9rem', textAlign: 'center', fontWeight: 600, color: 'var(--gray-500)', fontSize: '.75rem', textTransform: 'uppercase' }}>Babies Examined</th>
                  <th style={{ padding: '.6rem .9rem', textAlign: 'center', fontWeight: 600, color: 'var(--gray-500)', fontSize: '.75rem', textTransform: 'uppercase' }}>Avg Worst Stage</th>
                </tr>
              </thead>
              <tbody>
                {correlation.map((row, i) => (
                  <tr key={row.factor} style={{ borderTop: '1px solid var(--gray-100)', background: i % 2 ? 'var(--gray-50)' : 'var(--surface)' }}>
                    <td style={{ padding: '.6rem .9rem', fontWeight: 600, color: 'var(--gray-800)' }}>{row.label}</td>
                    <td style={{ padding: '.6rem .9rem', textAlign: 'center', color: 'var(--gray-700)' }}>{row.n}</td>
                    <td style={{ padding: '.6rem .9rem', textAlign: 'center', color: 'var(--gray-700)' }}>
                      {row.avg_worst_stage_rank != null ? `${row.avg_worst_stage_rank} (${STAGE_RANK_LABELS[String(Math.round(row.avg_worst_stage_rank))] ?? '-'})` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
