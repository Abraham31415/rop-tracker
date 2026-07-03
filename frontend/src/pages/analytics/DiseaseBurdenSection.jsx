import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
} from 'recharts'
import { getRopFindingsDistribution } from '../../services/api'
import { ChartCard, SectionHeading, STAGE_LABELS, STAGE_COLORS } from './shared'

export default function DiseaseBurdenSection({ fromDate, toDate, hospitalId }) {
  const params = { ...(fromDate ? { from_date: fromDate, to_date: toDate } : {}), ...(hospitalId ? { hospital_id: hospitalId } : {}) }

  const { data, isLoading } = useQuery({
    queryKey: ['analytics-rop-findings', fromDate, toDate, hospitalId],
    queryFn: () => getRopFindingsDistribution(params),
  })

  const overall = data?.overall ?? []
  const total = overall.reduce((s, d) => s + d.count, 0)
  const byHospital = data?.by_hospital ?? []

  const pieData = overall.map(d => ({ ...d, label: STAGE_LABELS[d.stage] ?? d.stage }))

  return (
    <>
      <SectionHeading title="ROP Findings Distribution" sub="Breakdown of each examined baby's worst-ever finding" />
      <ChartCard
        title="Worst Finding Across All Babies"
        sub="Count and share of babies at each stage"
        loading={isLoading}
        empty={!isLoading && total === 0}
        emptyText="No exam data recorded yet"
      >
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={pieData}
              dataKey="count"
              nameKey="label"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
              label={({ label, count, pct }) => count ? `${label}: ${count} (${pct}%)` : ''}
            >
              {pieData.map(d => <Cell key={d.stage} fill={STAGE_COLORS[d.stage] || 'var(--gray-400)'} />)}
            </Pie>
            <Tooltip formatter={(value, name, props) => [`${value} (${props.payload.pct}%)`, name]} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="card" style={{ marginTop: '1rem', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem .5rem', fontWeight: 700, fontSize: '.9rem', color: 'var(--gray-900)' }}>
          By Hospital
        </div>
        {byHospital.length === 0 ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--gray-400)', fontSize: '.85rem' }}>
            No exam data recorded yet
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
              <thead>
                <tr style={{ background: 'var(--gray-50)' }}>
                  <th style={{ padding: '.6rem .9rem', textAlign: 'left', fontWeight: 600, color: 'var(--gray-500)', fontSize: '.75rem', textTransform: 'uppercase' }}>Hospital</th>
                  {Object.keys(STAGE_LABELS).map(s => (
                    <th key={s} style={{ padding: '.6rem .9rem', textAlign: 'center', fontWeight: 600, color: 'var(--gray-500)', fontSize: '.75rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                      {STAGE_LABELS[s]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byHospital.map((row, i) => (
                  <tr key={row.hospital_name} style={{ borderTop: '1px solid var(--gray-100)', background: i % 2 ? 'var(--gray-50)' : 'var(--surface)' }}>
                    <td style={{ padding: '.6rem .9rem', fontWeight: 600, color: 'var(--gray-800)', whiteSpace: 'nowrap' }}>{row.hospital_name}</td>
                    {Object.keys(STAGE_LABELS).map(s => (
                      <td key={s} style={{ padding: '.6rem .9rem', textAlign: 'center', color: 'var(--gray-700)' }}>{row[s] ?? 0}</td>
                    ))}
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
