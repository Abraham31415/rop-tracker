import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
} from 'recharts'
import { getVisualOutcomes } from '../../services/api'
import { ChartCard, SectionHeading, DONUT_COLORS } from './shared'

export default function VisualOutcomesSection({ fromDate, toDate, hospitalId }) {
  const params = { ...(fromDate ? { from_date: fromDate, to_date: toDate } : {}), ...(hospitalId ? { hospital_id: hospitalId } : {}) }

  const { data, isLoading } = useQuery({
    queryKey: ['analytics-visual-outcomes', fromDate, toDate, hospitalId],
    queryFn: () => getVisualOutcomes(params),
  })

  // Spec: only show this section at all once outcome data exists
  if (!isLoading && !data?.has_data) return null

  const distribution = (data?.distribution ?? []).filter(d => d.count > 0)
  const byTreatment = data?.by_treatment ?? []
  const discharge = (data?.discharge_status ?? []).filter(d => d.count > 0)

  return (
    <>
      <SectionHeading title="Visual Outcomes" sub="Final visual results and discharge status for babies with recorded outcomes" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <ChartCard title="Final Visual Outcome" sub="All babies with an outcome recorded" loading={isLoading}>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={distribution} dataKey="count" nameKey="label" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {distribution.map((d, i) => <Cell key={d.outcome} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: '.72rem' }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <div
          className="card"
          style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: '.5rem' }}
        >
          <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--teal-600)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Blindness Prevention
          </div>
          <div style={{ fontSize: '3rem', fontWeight: 800, color: 'var(--teal-600)', lineHeight: 1 }}>
            {isLoading ? '…' : data?.blindness_prevention_count ?? 0}
          </div>
          <div style={{ fontSize: '.85rem', color: 'var(--gray-600)', maxWidth: 220 }}>
            babies treated before Stage 4/5 — blindness potentially prevented
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
        <ChartCard
          title="Outcomes by Treatment Type"
          sub="Did laser, anti-VEGF, or surgery lead to different outcomes?"
          loading={isLoading}
          empty={!isLoading && byTreatment.every(t => t.n === 0)}
          emptyText="No treated babies with a recorded outcome yet"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            {byTreatment.filter(t => t.n > 0).map(t => (
              <div key={t.treatment_type}>
                <div style={{ fontSize: '.82rem', fontWeight: 700, color: 'var(--gray-800)', marginBottom: '.3rem' }}>{t.label} ({t.n})</div>
                <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                  {Object.entries(t.outcomes).map(([outcome, count]) => (
                    <span key={outcome} style={{ fontSize: '.75rem', padding: '.2rem .55rem', borderRadius: 999, background: 'var(--gray-100)', color: 'var(--gray-700)' }}>
                      {outcome.replace(/_/g, ' ')}: {count}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard
          title="Discharge Status"
          sub="Where babies stand in the follow-up journey"
          loading={isLoading}
          empty={!isLoading && discharge.length === 0}
          emptyText="No discharge data recorded yet"
        >
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={discharge} dataKey="count" nameKey="label" innerRadius={50} outerRadius={85} paddingAngle={2}>
                {discharge.map((d, i) => <Cell key={d.status} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: '.72rem' }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </>
  )
}
