import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import { getTreatmentAnalytics, getFlaggedUntreatedBabies } from '../../services/api'
import { getBabyDisplayName } from '../../utils/babyName'
import { ChartCard, SectionHeading, ChartTooltip, BabyModal, STAGE_LABELS, ZONE_LABELS, DONUT_COLORS } from './shared'

const FLAGGED_COLS = [
  { key: 'full_name',           label: 'Baby',             render: b => <Link to={`/babies/${b.id}`} style={{ color: 'var(--teal-600)', fontWeight: 600 }}>{getBabyDisplayName(b)}</Link> },
  { key: 'hospital_name',       label: 'Hospital' },
  { key: 'zone',                label: 'Zone',             render: b => ZONE_LABELS[b.zone] ?? b.zone ?? '—' },
  { key: 'stage',               label: 'Stage',            render: b => STAGE_LABELS[b.stage] ?? b.stage ?? '—' },
  { key: 'last_exam_date',      label: 'Last Exam',        render: b => b.last_exam_date ? format(new Date(b.last_exam_date), 'd MMM yyyy') : '—' },
  { key: 'days_since_diagnosis', label: 'Days Since Dx',  render: b => b.days_since_diagnosis != null ? `${b.days_since_diagnosis}d` : '—' },
]

export default function TreatmentSection({ fromDate, toDate, hospitalId }) {
  const [showFlagged, setShowFlagged] = useState(false)
  const params = { ...(fromDate ? { from_date: fromDate, to_date: toDate } : {}), ...(hospitalId ? { hospital_id: hospitalId } : {}) }

  const { data, isLoading } = useQuery({
    queryKey: ['analytics-treatment', fromDate, toDate, hospitalId],
    queryFn: () => getTreatmentAnalytics(params),
  })

  const { data: flaggedData, isLoading: flaggedLoading } = useQuery({
    queryKey: ['analytics-flagged-untreated', hospitalId],
    queryFn: () => getFlaggedUntreatedBabies(hospitalId ? { hospital_id: hospitalId } : {}),
    enabled: showFlagged,
  })

  const types = data?.types ?? []
  const typesWithData = types.filter(t => t.count > 0)
  const totalTreated = types.reduce((s, t) => s + t.count, 0)
  const timing = (data?.timing ?? []).map(t => ({ ...t, label: STAGE_LABELS[t.stage] ?? t.stage }))
  const flagged = data?.flagged_untreated_count

  return (
    <>
      <SectionHeading title="Treatment" sub="Treatment types, timing, and babies awaiting treatment" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>

        <ChartCard
          title="Treatment Types"
          sub="Distribution of treatments recorded"
          loading={isLoading}
          empty={!isLoading && totalTreated === 0}
          emptyText="No treatment data recorded yet"
        >
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={typesWithData} dataKey="count" nameKey="label" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {typesWithData.map((t, i) => <Cell key={t.type} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: '.75rem' }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Treatment Timing"
          sub="Stage at which babies were treated — ideal: mostly Stage 2-3"
          loading={isLoading}
          empty={!isLoading && timing.every(t => t.count === 0)}
          emptyText="No treated babies recorded yet"
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={timing} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip valueLabel=" babies" />} cursor={{ fill: 'var(--gray-50)' }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={48}>
                {timing.map(t => (
                  <Cell key={t.stage} fill={t.stage === 'stage_2' || t.stage === 'stage_3' ? 'var(--teal-500)' : 'var(--red-500, #ef4444)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <div
          className="card"
          onClick={() => setShowFlagged(true)}
          style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: '.5rem' }}
        >
          <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--red-600)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Flagged, Not Yet Treated
          </div>
          <div style={{ fontSize: '3rem', fontWeight: 800, color: 'var(--red-600)', lineHeight: 1 }}>
            {isLoading ? '…' : flagged ?? 0}
          </div>
          <div style={{ fontSize: '.8rem', color: 'var(--gray-500)' }}>
            Stage 2+ with no treatment recorded
          </div>
          <div style={{ fontSize: '.78rem', color: 'var(--red-600)', fontWeight: 700 }}>
            Require urgent follow-up →
          </div>
        </div>
      </div>

      {showFlagged && (
        <BabyModal
          title="Babies Flagged for Treatment"
          babies={flaggedData?.babies}
          loading={flaggedLoading}
          columns={FLAGGED_COLS}
          onClose={() => setShowFlagged(false)}
        />
      )}
    </>
  )
}
