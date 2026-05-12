import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { subDays, format } from 'date-fns'
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
} from '../services/api'

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

// ── Shared custom tooltip ─────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, valueLabel }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--white)', border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius)', padding: '.5rem .75rem',
      fontSize: '.82rem', boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{ color: 'var(--gray-500)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 700, color: 'var(--gray-900)' }}>
        {payload[0].value}{valueLabel}
      </div>
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ value, label, sub, color, icon, onClick }) {
  return (
    <div
      className="card"
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', gap: '.3rem' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{
          width: 38, height: 38, borderRadius: 'var(--radius)',
          background: color + '18',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color, fontSize: '1.1rem', flexShrink: 0,
        }}>{icon}</div>
        {onClick && (
          <span style={{ fontSize: '.72rem', color: 'var(--gray-400)', marginTop: 4 }}>View list →</span>
        )}
      </div>
      <div style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-.04em', color: 'var(--gray-900)', lineHeight: 1, marginTop: '.4rem' }}>
        {value ?? '—'}
      </div>
      <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--gray-600)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {label}
      </div>
      {sub && <div style={{ fontSize: '.75rem', color: 'var(--gray-400)', marginTop: '.1rem' }}>{sub}</div>}
    </div>
  )
}

// ── Chart card wrapper ────────────────────────────────────────────────────────
function ChartCard({ title, sub, children, loading }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--gray-900)' }}>{title}</div>
        {sub && <div style={{ fontSize: '.78rem', color: 'var(--gray-400)', marginTop: 2 }}>{sub}</div>}
      </div>
      {loading ? (
        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="spinner" />
        </div>
      ) : children}
    </div>
  )
}

// ── Baby detail modal ─────────────────────────────────────────────────────────
function BabyModal({ title, babies, loading, columns, onClose }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.1rem 1.25rem', borderBottom: '1px solid var(--gray-100)' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--gray-900)' }}>{title}</div>
            {!loading && <div style={{ fontSize: '.78rem', color: 'var(--gray-400)', marginTop: 2 }}>{babies?.length ?? 0} babies</div>}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', fontSize: '1.25rem', lineHeight: 1, padding: '4px 8px' }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ padding: '2rem', display: 'flex', justifyContent: 'center' }}>
              <div className="spinner" />
            </div>
          ) : !babies?.length ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-400)', fontSize: '.88rem' }}>
              No babies found for this period.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
              <thead>
                <tr style={{ background: 'var(--gray-50)' }}>
                  {columns.map(c => (
                    <th key={c.key} style={{ padding: '.6rem .9rem', textAlign: 'left', fontWeight: 600, color: 'var(--gray-500)', fontSize: '.75rem', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {babies.map((b, i) => (
                  <tr key={b.id} style={{ borderTop: '1px solid var(--gray-100)', background: i % 2 ? 'var(--gray-50)' : 'var(--white)' }}>
                    {columns.map(c => (
                      <td key={c.key} style={{ padding: '.65rem .9rem', color: 'var(--gray-800)', whiteSpace: c.wrap ? 'normal' : 'nowrap' }}>
                        {c.render ? c.render(b) : (b[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Column definitions ────────────────────────────────────────────────────────
const STAGE_LABELS = {
  no_rop: 'No ROP', immature: 'Immature',
  stage_1: 'Stage 1', stage_2: 'Stage 2', stage_3: 'Stage 3',
  stage_4: 'Stage 4', stage_5: 'Stage 5',
}
const ZONE_LABELS  = { zone_i: 'Zone I', zone_ii: 'Zone II', zone_iii: 'Zone III' }

const AT_RISK_COLS = [
  { key: 'full_name',           label: 'Baby',              render: b => <Link to={`/babies/${b.id}`} style={{ color: 'var(--teal-600)', fontWeight: 600 }}>{b.full_name}</Link> },
  { key: 'hospital_name',       label: 'Hospital' },
  { key: 'zone',                label: 'Zone',              render: b => ZONE_LABELS[b.zone]  ?? b.zone  ?? '—' },
  { key: 'stage',               label: 'Stage',             render: b => STAGE_LABELS[b.stage] ?? b.stage ?? '—' },
  { key: 'treatment_recommended', label: 'Treatment',       render: b => b.treatment_recommended ?? '—' },
  { key: 'last_exam_date',      label: 'Last Exam',         render: b => b.last_exam_date ? format(new Date(b.last_exam_date), 'd MMM yyyy') : '—' },
  { key: 'days_since_diagnosis', label: 'Days Since Dx',   render: b => b.days_since_diagnosis != null ? `${b.days_since_diagnosis}d` : '—' },
]

const LTFU_COLS = [
  { key: 'full_name',           label: 'Baby',              render: b => <Link to={`/babies/${b.id}`} style={{ color: 'var(--teal-600)', fontWeight: 600 }}>{b.full_name}</Link> },
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

  const tf = TIMEFRAMES.find(t => t.key === tfKey)
  const fromDate  = tf.from()
  const toDate    = today()
  const group_by  = tf.group_by
  const params    = { group_by, ...(fromDate ? { from_date: fromDate, to_date: toDate } : {}) }

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: volData,   isLoading: volLoading  } = useQuery({ queryKey: ['analytics-volume',   tfKey], queryFn: () => getScreeningVolume(params) })
  const { data: ltfuData,  isLoading: ltfuLoading } = useQuery({ queryKey: ['analytics-ltfu',     tfKey], queryFn: () => getLtfuRate(params) })
  const { data: riskData,  isLoading: riskLoading } = useQuery({ queryKey: ['analytics-at-risk',  tfKey], queryFn: () => getAtRiskTrend(params) })

  const ltfuQueryParams = ltfuPeriod
    ? { from_date: ltfuPeriod.from, to_date: ltfuPeriod.to }
    : (fromDate ? { from_date: fromDate, to_date: toDate } : {})

  const { data: atRiskBabiesData, isLoading: arLoading } = useQuery({
    queryKey: ['analytics-at-risk-babies'],
    queryFn:  getAtRiskBabies,
    enabled:  modal === 'at-risk',
  })
  const { data: ltfuBabiesData, isLoading: lbLoading } = useQuery({
    queryKey: ['analytics-ltfu-babies', ltfuPeriod, tfKey],
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

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--gray-900)', margin: 0 }}>Analytics</h1>
        <p style={{ fontSize: '.85rem', color: 'var(--gray-400)', margin: '.25rem 0 0' }}>
          Network-wide trends for the selected period
        </p>
      </div>

      {/* Timeframe selector */}
      <div style={{ display: 'flex', gap: '.4rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {TIMEFRAMES.map(t => (
          <button
            key={t.key}
            onClick={() => setTfKey(t.key)}
            style={{
              padding: '.35rem .85rem',
              borderRadius: 'var(--radius)',
              border: '1.5px solid',
              borderColor: tfKey === t.key ? 'var(--teal-600)' : 'var(--gray-200)',
              background: tfKey === t.key ? 'var(--teal-600)' : 'var(--white)',
              color: tfKey === t.key ? 'var(--white)' : 'var(--gray-600)',
              fontWeight: 600, fontSize: '.82rem', cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
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
