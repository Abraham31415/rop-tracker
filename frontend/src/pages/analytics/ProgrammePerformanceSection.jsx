import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { getProgrammePerformance } from '../../services/api'
import { ChartCard, StatCard, SectionHeading, ChartTooltip } from './shared'

export default function ProgrammePerformanceSection({ fromDate, toDate, hospitalId }) {
  const params = { ...(fromDate ? { from_date: fromDate, to_date: toDate } : {}), ...(hospitalId ? { hospital_id: hospitalId } : {}) }

  const { data, isLoading } = useQuery({
    queryKey: ['analytics-programme-performance', fromDate, toDate, hospitalId],
    queryFn: () => getProgrammePerformance(params),
  })

  const firstExamHist = data?.time_to_first_exam?.histogram ?? []
  const treatmentHist = data?.time_to_treatment?.histogram ?? []
  const firstExamTotal = firstExamHist.reduce((s, b) => s + b.count, 0)
  const treatmentTotal = treatmentHist.reduce((s, b) => s + b.count, 0)

  return (
    <>
      <SectionHeading title="Programme Performance" sub="How well the screening programme is meeting clinical timing targets" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <ChartCard
          title="Time: Birth → First Exam"
          sub={`Target: before 4 weeks for babies under 30wk GA${data?.time_to_first_exam?.pct_under_30wk_on_target != null ? ` (${data.time_to_first_exam.pct_under_30wk_on_target}% on target)` : ''}`}
          loading={isLoading}
          empty={!isLoading && firstExamTotal === 0}
          emptyText="No exam data recorded yet"
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={firstExamHist} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" />
              <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip valueLabel=" babies" />} cursor={{ fill: 'var(--gray-50)' }} />
              <Bar dataKey="count" fill="var(--teal-500)" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Time: Stage 2+ Diagnosis → Treatment"
          sub={`Target: under 7 days${data?.time_to_treatment?.pct_within_7_days != null ? ` (${data.time_to_treatment.pct_within_7_days}% within target)` : ''}`}
          loading={isLoading}
          empty={!isLoading && treatmentTotal === 0}
          emptyText="No treated babies recorded yet"
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={treatmentHist} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" />
              <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip valueLabel=" babies" />} cursor={{ fill: 'var(--gray-50)' }} />
              <Bar dataKey="count" fill="var(--amber-500)" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <StatCard
          value={isLoading ? '…' : (data?.exam_frequency_compliance_pct != null ? `${data.exam_frequency_compliance_pct}%` : '-')}
          label="Exam Frequency Compliance"
          sub="next exam within recommended interval"
          color="var(--teal-600)"
          icon="📆"
        />
        <StatCard
          value={isLoading ? '…' : (data?.bilateral_completeness_pct != null ? `${data.bilateral_completeness_pct}%` : '-')}
          label="Bilateral Exam Completeness"
          sub="exams with both eyes recorded"
          color="var(--teal-600)"
          icon="👁"
        />
      </div>
    </>
  )
}
