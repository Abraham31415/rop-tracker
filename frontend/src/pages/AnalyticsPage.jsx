import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { subDays, format } from 'date-fns'
import { getBabyDisplayName } from '../utils/babyName'
import {
  ResponsiveContainer,
  BarChart, Bar,
  AreaChart, Area,
  XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts'
import {
  getScreeningVolume,
  getLtfuRate,
  getAtRiskTrend,
  getAtRiskBabies,
  getLtfuBabies,
  getKpiExtra,
  listHospitals,
} from '../services/api'
import { ChartTooltip, StatCard, ChartCard, BabyModal, STAGE_LABELS, ZONE_LABELS } from './analytics/shared'
import { generateAnalyticsDashboardPDF } from '../services/pdfExport'
import DiseaseBurdenSection from './analytics/DiseaseBurdenSection'
import TreatmentSection from './analytics/TreatmentSection'
import LtfuDeepDiveSection from './analytics/LtfuDeepDiveSection'
import AdherenceSection from './analytics/AdherenceSection'
import ProgrammePerformanceSection from './analytics/ProgrammePerformanceSection'
import PatientProfileSection from './analytics/PatientProfileSection'
import VisualOutcomesSection from './analytics/VisualOutcomesSection'
import ReminderPerformanceSection from './analytics/ReminderPerformanceSection'
import HospitalComparisonSection from './analytics/HospitalComparisonSection'

// ── Timeframe presets ─────────────────────────────────────────────────────────
const today = () => format(new Date(), 'yyyy-MM-dd')
const daysAgo = (n) => format(subDays(new Date(), n), 'yyyy-MM-dd')

const TIMEFRAMES = [
  { key: '7d',  label: '7D',   from: () => daysAgo(7),   group_by: 'day'   },
  { key: '1m',  label: '1M',   from: () => daysAgo(30),  group_by: 'week'  },
  { key: '3m',  label: '3M',   from: () => daysAgo(90),  group_by: 'month' },
  { key: '6m',  label: '6M',   from: () => daysAgo(180), group_by: 'month' },
  { key: '1y',  label: '1Y',   from: () => daysAgo(365), group_by: 'month' },
  { key: 'all', label: 'All',  from: () => null,          group_by: 'month' },
]

// ── Column definitions ────────────────────────────────────────────────────────
const AT_RISK_COLS = [
  { key: 'full_name',           label: 'Baby',              render: b => <Link to={`/babies/${b.id}`} style={{ color: 'var(--teal-600)', fontWeight: 600 }}>{getBabyDisplayName(b)}</Link> },
  { key: 'hospital_name',       label: 'Hospital' },
  { key: 'zone',                label: 'Zone',              render: b => ZONE_LABELS[b.zone]  ?? b.zone  ?? '—' },
  { key: 'stage',               label: 'Stage',             render: b => STAGE_LABELS[b.stage] ?? b.stage ?? '—' },
  { key: 'treatment_recommended', label: 'Treatment',       render: b => b.treatment_recommended ?? '—' },
  { key: 'last_exam_date',      label: 'Last Exam',         render: b => b.last_exam_date ? format(new Date(b.last_exam_date), 'd MMM yyyy') : '—' },
  { key: 'days_since_diagnosis', label: 'Days Since Dx',   render: b => b.days_since_diagnosis != null ? `${b.days_since_diagnosis}d` : '—' },
]

const LTFU_COLS = [
  { key: 'full_name',           label: 'Baby',              render: b => <Link to={`/babies/${b.id}`} style={{ color: 'var(--teal-600)', fontWeight: 600 }}>{getBabyDisplayName(b)}</Link> },
  { key: 'hospital_name',       label: 'Hospital' },
  { key: 'zone',                label: 'Zone',              render: b => ZONE_LABELS[b.zone]  ?? b.zone  ?? '—' },
  { key: 'stage',               label: 'Stage',             render: b => STAGE_LABELS[b.stage] ?? b.stage ?? '—' },
  { key: 'last_exam_date',      label: 'Last Exam',         render: b => b.last_exam_date ? format(new Date(b.last_exam_date), 'd MMM yyyy') : '—' },
  { key: 'missed_appointment_date', label: 'Missed Appt',  render: b => b.missed_appointment_date ? format(new Date(b.missed_appointment_date), 'd MMM yyyy') : '—' },
  { key: 'days_overdue',        label: 'Days Overdue',      render: b => b.days_overdue != null ? `${b.days_overdue}d` : '—' },
]

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [tfKey, setTfKey]   = useState('6m')
  const [modal, setModal]   = useState(null)  // null | 'ltfu' | 'at-risk'
  const [ltfuPeriod, setLtfuPeriod] = useState(null)  // { from, to } for LTFU drill-down
  const [hospitalId, setHospitalId] = useState(null)  // set by clicking a row in Hospital Comparison
  const [exporting, setExporting] = useState(false)

  const tf = TIMEFRAMES.find(t => t.key === tfKey)
  const fromDate  = tf.from()
  const toDate    = today()
  const group_by  = tf.group_by
  const params    = { group_by, ...(fromDate ? { from_date: fromDate, to_date: toDate } : {}), ...(hospitalId ? { hospital_id: hospitalId } : {}) }
  const scopeParams = { ...(fromDate ? { from_date: fromDate, to_date: toDate } : {}), ...(hospitalId ? { hospital_id: hospitalId } : {}) }

  const { data: hospitals = [] } = useQuery({ queryKey: ['hospitals'], queryFn: listHospitals })
  const hospitalName = hospitalId ? (hospitals.find(h => h.id === hospitalId)?.name ?? '…') : null

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: volData,   isLoading: volLoading  } = useQuery({ queryKey: ['analytics-volume',   tfKey, hospitalId], queryFn: () => getScreeningVolume(params) })
  const { data: ltfuData,  isLoading: ltfuLoading } = useQuery({ queryKey: ['analytics-ltfu',     tfKey, hospitalId], queryFn: () => getLtfuRate(params) })
  const { data: riskData,  isLoading: riskLoading } = useQuery({ queryKey: ['analytics-at-risk',  tfKey, hospitalId], queryFn: () => getAtRiskTrend(params) })
  const { data: kpiExtra,  isLoading: kpiLoading }  = useQuery({ queryKey: ['analytics-kpi-extra', tfKey, hospitalId], queryFn: () => getKpiExtra(scopeParams) })

  const ltfuQueryParams = ltfuPeriod
    ? { from_date: ltfuPeriod.from, to_date: ltfuPeriod.to, ...(hospitalId ? { hospital_id: hospitalId } : {}) }
    : scopeParams

  const { data: atRiskBabiesData, isLoading: arLoading } = useQuery({
    queryKey: ['analytics-at-risk-babies', hospitalId],
    queryFn:  () => getAtRiskBabies(hospitalId ? { hospital_id: hospitalId } : {}),
    enabled:  modal === 'at-risk',
  })
  const { data: ltfuBabiesData, isLoading: lbLoading } = useQuery({
    queryKey: ['analytics-ltfu-babies', ltfuPeriod, tfKey, hospitalId],
    queryFn:  () => getLtfuBabies(ltfuQueryParams),
    enabled:  modal === 'ltfu',
  })

  // ── Chart click handlers ───────────────────────────────────────────────────
  const onLtfuBarClick = useCallback((data) => {
    if (!data?.activePayload?.[0]) return
    const period = data.activePayload[0].payload.period
    // Derive date range for the clicked period
    let from, to
    if (group_by === 'month') {
      from = period + '-01'
      const d = new Date(from)
      d.setMonth(d.getMonth() + 1)
      d.setDate(d.getDate() - 1)
      to = format(d, 'yyyy-MM-dd')
    } else if (group_by === 'week') {
      const [year, week] = period.split('-W').map(Number)
      const jan4 = new Date(year, 0, 4)
      const startOfWeek1 = new Date(jan4)
      startOfWeek1.setDate(jan4.getDate() - jan4.getDay() + 1)
      const start = new Date(startOfWeek1)
      start.setDate(start.getDate() + (week - 1) * 7)
      const end = new Date(start)
      end.setDate(end.getDate() + 6)
      from = format(start, 'yyyy-MM-dd')
      to   = format(end,   'yyyy-MM-dd')
    } else {
      from = period
      to   = period
    }
    setLtfuPeriod({ from, to })
    setModal('ltfu')
  }, [group_by])

  const onAtRiskClick = useCallback(() => {
    setLtfuPeriod(null)
    setModal('at-risk')
  }, [])

  const closeModal = useCallback(() => {
    setModal(null)
    setLtfuPeriod(null)
  }, [])

  // ── Derived stat values ────────────────────────────────────────────────────
  const totalScreened  = volData?.data?.reduce((s, d) => s + d.count, 0) ?? null
  const avgLtfuRate    = ltfuData?.data?.length
    ? (ltfuData.data.reduce((s, d) => s + d.rate, 0) / ltfuData.data.length).toFixed(1)
    : null
  const currentAtRisk  = riskData?.current_count ?? null

  const modalTitle = modal === 'ltfu'
    ? ltfuPeriod ? `LTFU Babies (${ltfuPeriod.from} to ${ltfuPeriod.to})` : 'LTFU Babies'
    : 'At-Risk Babies (Treatment Recommended)'

  const handleExportPdf = async () => {
    setExporting(true)
    try {
      await generateAnalyticsDashboardPDF({
        periodLabel: tf.label,
        hospitalName: hospitalName || 'All Hospitals (Network-wide)',
        params: scopeParams,
        kpis: {
          totalScreened, avgLtfuRate, currentAtRisk,
          totalExams: kpiExtra?.total_exams,
          treatmentRate: kpiExtra?.treatment_rate,
          screeningCoverage: kpiExtra?.screening_coverage,
          avgDaysToFirstExam: kpiExtra?.avg_days_to_first_exam,
        },
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--gray-900)', margin: 0 }}>Analytics</h1>
          <p style={{ fontSize: '.85rem', color: 'var(--gray-400)', margin: '.25rem 0 0' }}>
            Network-wide trends for the selected period
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={handleExportPdf} disabled={exporting}>
          {exporting ? 'Exporting…' : '⬇ Export PDF Report'}
        </button>
      </div>

      {/* Timeframe selector + hospital filter chip */}
      <div style={{ display: 'flex', gap: '.4rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {TIMEFRAMES.map(t => (
          <button
            key={t.key}
            onClick={() => setTfKey(t.key)}
            style={{
              padding: '.35rem .85rem',
              borderRadius: 'var(--radius)',
              border: '1.5px solid',
              borderColor: tfKey === t.key ? 'var(--teal-600)' : 'var(--gray-200)',
              background: tfKey === t.key ? 'var(--teal-600)' : 'var(--surface)',
              color: tfKey === t.key ? 'var(--white)' : 'var(--gray-600)',
              fontWeight: 600, fontSize: '.82rem', cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
        {hospitalId && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '.4rem',
            padding: '.3rem .7rem', borderRadius: 999,
            background: 'var(--teal-50)', color: 'var(--teal-700)',
            fontSize: '.8rem', fontWeight: 600, marginLeft: '.5rem',
          }}>
            Filtered to: {hospitalName}
            <button
              onClick={() => setHospitalId(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal-700)', fontWeight: 800, padding: 0, lineHeight: 1 }}
            >
              ✕
            </button>
          </span>
        )}
      </div>

      {/* Stat cards — 8 KPIs, two rows of four */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <StatCard
          value={volLoading ? '…' : totalScreened}
          label="Babies Screened"
          sub="enrolled in period"
          color="var(--teal-600)"
          icon="👶"
        />
        <StatCard
          value={ltfuLoading ? '…' : (avgLtfuRate != null ? `${avgLtfuRate}%` : null)}
          label="Avg LTFU Rate"
          sub="of appointments missed"
          color="var(--red-600)"
          icon="⚠"
        />
        <StatCard
          value={riskLoading ? '…' : currentAtRisk}
          label="At-Risk Now"
          sub="diagnosed, not yet treated"
          color="var(--amber-600)"
          icon="👁"
          onClick={onAtRiskClick}
        />
        <StatCard
          value={kpiLoading ? '…' : kpiExtra?.total_exams}
          label="Exams Recorded"
          sub="in period"
          color="var(--teal-600)"
          icon="🔬"
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <StatCard
          value={kpiLoading ? '…' : (kpiExtra?.treatment_rate != null ? `${kpiExtra.treatment_rate}%` : null)}
          label="Treatment Rate"
          sub="of screened babies"
          color="var(--amber-600)"
          icon="⚕"
        />
        <StatCard
          value={kpiLoading ? '…' : (kpiExtra?.screening_coverage != null ? `${kpiExtra.screening_coverage}%` : null)}
          label="Screening Coverage"
          sub="enrolled babies examined"
          color="var(--teal-600)"
          icon="✓"
        />
        <StatCard
          value={kpiLoading ? '…' : (kpiExtra?.avg_days_to_first_exam != null ? `${kpiExtra.avg_days_to_first_exam}d` : null)}
          label="Avg Days to First Exam"
          sub="from enrollment"
          color="var(--gray-600)"
          icon="📅"
        />
        <div />
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>

        {/* Screening volume */}
        <ChartCard
          title="Screening Volume"
          sub="Babies enrolled per period"
          loading={volLoading}
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={volData?.data ?? []} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip valueLabel=" babies" />} cursor={{ fill: 'var(--gray-50)' }} />
              <Bar dataKey="count" fill="var(--teal-500)" radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* LTFU rate */}
        <ChartCard
          title="Loss to Follow-Up Rate"
          sub="Click a bar to see the babies"
          loading={ltfuLoading}
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ltfuData?.data ?? []} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} onClick={onLtfuBarClick}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} domain={[0, 100]} unit="%" />
              <Tooltip content={<ChartTooltip valueLabel="%" />} cursor={{ fill: 'var(--gray-50)', cursor: 'pointer' }} />
              <Bar dataKey="rate" fill="var(--red-400)" radius={[4, 4, 0, 0]} maxBarSize={48} style={{ cursor: 'pointer' }} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* At-risk trend */}
        <ChartCard
          title="At-Risk Babies"
          sub="New diagnoses requiring treatment per period"
          loading={riskLoading}
        >
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={riskData?.data ?? []} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="atRiskGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--amber-400)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--amber-400)" stopOpacity={0}   />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--gray-400)' }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip valueLabel=" babies" />} cursor={{ fill: 'var(--gray-50)' }} />
              <Area
                type="monotone" dataKey="count"
                stroke="var(--amber-500)" strokeWidth={2}
                fill="url(#atRiskGrad)"
                dot={{ r: 3, fill: 'var(--amber-500)', strokeWidth: 0 }}
                activeDot={{ r: 5, fill: 'var(--amber-600)', strokeWidth: 0, cursor: 'pointer' }}
                onClick={onAtRiskClick}
              />
            </AreaChart>
          </ResponsiveContainer>
          <div style={{ textAlign: 'center', marginTop: '-.25rem' }}>
            <button
              onClick={onAtRiskClick}
              style={{ fontSize: '.78rem', color: 'var(--amber-600)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
            >
              View all {currentAtRisk ?? '…'} at-risk babies →
            </button>
          </div>
        </ChartCard>
      </div>

      <DiseaseBurdenSection fromDate={fromDate} toDate={toDate} hospitalId={hospitalId} />
      <TreatmentSection fromDate={fromDate} toDate={toDate} hospitalId={hospitalId} />
      <LtfuDeepDiveSection fromDate={fromDate} toDate={toDate} hospitalId={hospitalId} tfKey={tfKey} />
      <AdherenceSection fromDate={fromDate} toDate={toDate} hospitalId={hospitalId} />
      <ProgrammePerformanceSection fromDate={fromDate} toDate={toDate} hospitalId={hospitalId} />
      <PatientProfileSection fromDate={fromDate} toDate={toDate} hospitalId={hospitalId} />
      <VisualOutcomesSection fromDate={fromDate} toDate={toDate} hospitalId={hospitalId} />
      <ReminderPerformanceSection fromDate={fromDate} toDate={toDate} hospitalId={hospitalId} />
      <HospitalComparisonSection fromDate={fromDate} toDate={toDate} onSelectHospital={setHospitalId} />

      {/* Drill-down modal */}
      {modal && (
        <BabyModal
          title={modalTitle}
          babies={modal === 'at-risk' ? atRiskBabiesData?.babies : ltfuBabiesData?.babies}
          loading={modal === 'at-risk' ? arLoading : lbLoading}
          columns={modal === 'at-risk' ? AT_RISK_COLS : LTFU_COLS}
          onClose={closeModal}
        />
      )}
    </div>
  )
}
