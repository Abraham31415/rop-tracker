import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getReports, getPopulationReport, listHospitals, getOutcomesReport, downloadResearchCSV } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { generatePopulationPDF } from '../services/pdfExport'

// ── Quick date range presets ──────────────────────────────────────────────────
function getPresetDates(preset) {
  const today = new Date()
  const y = today.getFullYear()
  const m = today.getMonth()
  switch (preset) {
    case 'this_month':
      return { start: new Date(y, m, 1), end: today }
    case 'last_month': {
      const lm = new Date(y, m - 1, 1)
      return { start: lm, end: new Date(y, m, 0) }
    }
    case 'last_3m':
      return { start: new Date(y, m - 3, 1), end: today }
    case 'last_6m':
      return { start: new Date(y, m - 6, 1), end: today }
    case 'this_year':
      return { start: new Date(y, 0, 1), end: today }
    case 'all_time':
      return { start: null, end: null }
    default:
      return { start: null, end: null }
  }
}

function toIso(d) {
  if (!d) return ''
  return d.toISOString().slice(0, 10)
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StatCard({ value, label, sub, accent }) {
  return (
    <div className="report-stat-card">
      <div className="report-stat-value" style={accent ? { color: accent } : {}}>{value}</div>
      <div className="report-stat-label">{label}</div>
      {sub && <div className="report-stat-sub">{sub}</div>}
    </div>
  )
}

function BarChart({ data, valueKey, labelKey, maxValue, colorFn }) {
  const max = maxValue || Math.max(...data.map(d => d[valueKey] || 0), 1)
  return (
    <div className="bar-chart">
      {data.map((d, i) => {
        const pct = Math.round((d[valueKey] / max) * 100)
        return (
          <div key={i} className="bar-row">
            <div className="bar-row-label" title={d[labelKey]}>{d[labelKey]}</div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${pct}%`, background: colorFn ? colorFn(d) : 'var(--teal-500)' }}
              />
              <span className="bar-value">{d[valueKey]}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Population report filter panel ───────────────────────────────────────────
function PopulationReportPanel({ hospitals, isCentral }) {
  const { user } = useAuth()
  const [preset, setPreset] = useState('all_time')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [hospitalId, setHospitalId] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  const presets = [
    { value: 'this_month', label: 'This Month' },
    { value: 'last_month', label: 'Last Month' },
    { value: 'last_3m', label: 'Last 3 Months' },
    { value: 'last_6m', label: 'Last 6 Months' },
    { value: 'this_year', label: 'This Year' },
    { value: 'all_time', label: 'All Time' },
    { value: 'custom', label: 'Custom Range' },
  ]

  const applyPreset = (p) => {
    setPreset(p)
    if (p !== 'custom') {
      const { start, end } = getPresetDates(p)
      setStartDate(start ? toIso(start) : '')
      setEndDate(end ? toIso(end) : '')
    }
  }

  const handleGenerate = async () => {
    setError('')
    setGenerating(true)
    try {
      const params = {}
      if (startDate) params.start_date = startDate
      if (endDate)   params.end_date = endDate
      if (hospitalId) params.hospital_id = hospitalId

      const report = await getPopulationReport(params)
      await generatePopulationPDF(report)
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to generate report. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--teal-600)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.6rem' }}>
          Date Range
        </div>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.75rem' }}>
          {presets.map(p => (
            <button
              key={p.value}
              type="button"
              onClick={() => applyPreset(p.value)}
              style={{
                padding: '.35rem .75rem',
                borderRadius: 999,
                fontSize: '.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: '1.5px solid',
                transition: 'all .15s',
                background: preset === p.value ? 'var(--teal-600)' : 'var(--white)',
                color: preset === p.value ? 'var(--white)' : 'var(--gray-700)',
                borderColor: preset === p.value ? 'var(--teal-600)' : 'var(--gray-300)',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {(preset === 'custom' || startDate || endDate) && (
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ margin: 0, flex: '1 1 160px' }}>
              <label style={{ fontSize: '.8rem' }}>Start Date</label>
              <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPreset('custom') }} />
            </div>
            <div className="form-group" style={{ margin: 0, flex: '1 1 160px' }}>
              <label style={{ fontSize: '.8rem' }}>End Date</label>
              <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPreset('custom') }} />
            </div>
          </div>
        )}
      </div>

      {isCentral && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--teal-600)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.5rem' }}>
            Hospital
          </div>
          <select
            value={hospitalId}
            onChange={e => setHospitalId(e.target.value)}
            className="filter-select"
            style={{ maxWidth: 340 }}
          >
            <option value="">All Hospitals (Network-wide)</option>
            {hospitals.map(h => (
              <option key={h.id} value={h.id}>{h.name} ({h.district})</option>
            ))}
          </select>
        </div>
      )}

      {error && <div className="alert alert-error" style={{ marginBottom: '.75rem' }}>{error}</div>}

      <button
        className="btn btn-primary"
        onClick={handleGenerate}
        disabled={generating}
        style={{ gap: '.5rem' }}
      >
        {generating ? (
          <>
            <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,.4)', borderTopColor: 'white', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
            Generating PDF…
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            Generate Report PDF
          </>
        )}
      </button>
      <p style={{ fontSize: '.75rem', color: 'var(--gray-400)', marginTop: '.5rem' }}>
        PDF downloads automatically with cover page, all statistics, and hospital breakdown.
      </p>
    </div>
  )
}

// ── Outcomes tab ──────────────────────────────────────────────────────────────
function OutcomesTab({ isCentral }) {
  const [exporting, setExporting] = useState(false)

  const { data: outcomes, isLoading } = useQuery({
    queryKey: ['outcomes-report'],
    queryFn: () => getOutcomesReport({}),
  })

  const handleExportCSV = async () => {
    setExporting(true)
    try {
      const blob = await downloadResearchCSV({})
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `rop_research_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Failed to download CSV: ' + (e.response?.data?.detail || e.message))
    } finally {
      setExporting(false)
    }
  }

  if (isLoading) return <div className="spinner-center" style={{ padding: '3rem' }}><div className="spinner" /></div>
  if (!outcomes) return null

  const treatmentLabels = { none: 'None', laser: 'Laser', anti_vegf: 'Anti-VEGF', surgery: 'Surgery', combination: 'Combination' }
  const visualLabels = { good_vision: 'Good Vision', mild_impairment: 'Mild Impairment', severe_impairment: 'Severe Impairment', blind: 'Blind', too_young: 'Too Young', ltfu_before_outcome: 'LTFU Before Assessment', unknown: 'Unknown' }

  return (
    <div>
      {/* Headline stats */}
      <div className="report-stats-grid" style={{ marginBottom: '1.5rem' }}>
        <StatCard value={outcomes.total_outcomes} label="Outcomes Recorded" />
        <StatCard value={outcomes.blindness_prevented} label="Blindness Prevented" accent="var(--teal-600)" sub="Babies receiving active treatment" />
        <StatCard value={outcomes.referrals.total} label="Total Referrals" />
        <StatCard
          value={outcomes.referrals.total ? `${outcomes.referrals.success_rate}%` : '-'}
          label="Referral Success Rate"
          sub="Arrived & treated"
          accent={outcomes.referrals.success_rate >= 70 ? 'var(--green-600)' : 'var(--amber-600)'}
        />
      </div>

      <div className="report-two-col">
        {/* Treatment breakdown */}
        <div className="card">
          <div className="card-section-header">Treatment Type</div>
          {outcomes.treatment_breakdown.length === 0 ? (
            <p style={{ fontSize: '.85rem', color: 'var(--gray-400)' }}>No treatment data yet.</p>
          ) : (
            outcomes.treatment_breakdown.map(row => {
              const total = outcomes.total_outcomes || 1
              const pct = Math.round(row.count / total * 100)
              return (
                <div key={row.type} className="bar-row">
                  <div className="bar-row-label">{treatmentLabels[row.type] || row.type}</div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${pct}%`, background: row.type === 'none' ? 'var(--gray-300)' : 'var(--teal-500)' }} />
                    <span className="bar-value">{row.count}</span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Visual outcomes */}
        <div className="card">
          <div className="card-section-header">Visual Outcomes</div>
          {outcomes.visual_outcome_breakdown.length === 0 ? (
            <p style={{ fontSize: '.85rem', color: 'var(--gray-400)' }}>No visual outcome data yet.</p>
          ) : (
            outcomes.visual_outcome_breakdown.map(row => {
              const total = outcomes.total_outcomes || 1
              const pct = Math.round(row.count / total * 100)
              const color = row.outcome === 'good_vision' ? 'var(--green-500)' : row.outcome === 'blind' ? 'var(--red-500)' : 'var(--amber-500)'
              return (
                <div key={row.outcome} className="bar-row">
                  <div className="bar-row-label">{visualLabels[row.outcome] || row.outcome}</div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
                    <span className="bar-value">{row.count}</span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Referral stats */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-section-header">Referral Outcomes</div>
        {outcomes.referrals.total === 0 ? (
          <p style={{ fontSize: '.85rem', color: 'var(--gray-400)' }}>No referrals recorded yet.</p>
        ) : (
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Arrived & Treated', value: outcomes.referrals.arrived_treated, color: 'var(--green-600)' },
              { label: 'Pending', value: outcomes.referrals.pending, color: 'var(--amber-600)' },
              { label: 'Did Not Arrive', value: outcomes.referrals.did_not_arrive, color: 'var(--red-600)' },
            ].map(row => (
              <div key={row.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: row.color }}>{row.value}</div>
                <div style={{ fontSize: '.75rem', color: 'var(--gray-500)', fontWeight: 600 }}>{row.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Research export */}
      <div className="card" style={{ background: 'var(--teal-50)', border: '1px solid var(--teal-200)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--teal-700)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '.3rem' }}>Research Export</div>
            <p style={{ fontSize: '.87rem', color: 'var(--teal-800)', lineHeight: 1.6 }}>
              Download anonymised CSV with all clinical data. Patient names are replaced with sequential study IDs (ROP-0001, ROP-0002, …).
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleExportCSV}
            disabled={exporting}
            style={{ flexShrink: 0 }}
          >
            {exporting ? 'Preparing…' : '⬇ Export for Research'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const { user } = useAuth()
  const isCentral = user?.role === 'central_coordinator'
  const [activeTab, setActiveTab] = useState('overview')

  const { data, isLoading, error } = useQuery({
    queryKey: ['reports'],
    queryFn: getReports,
  })

  const { data: hospitals = [] } = useQuery({
    queryKey: ['hospitals'],
    queryFn: listHospitals,
    enabled: isCentral,
  })

  if (isLoading) return <div className="spinner-center"><div className="spinner" /></div>
  if (error) return (
    <div className="page-header">
      <div className="page-header-text"><h2>Reports</h2><p style={{ color: 'var(--red-600)' }}>Failed to load reports.</p></div>
    </div>
  )

  const { summary, enrollment_by_month, hospital_breakdown, stage_breakdown, sms_stats } = data

  const activeMonths = enrollment_by_month.filter(m => m.enrolled > 0 || m.ltfu > 0)
  const chartMonths = activeMonths.length > 0 ? activeMonths : enrollment_by_month.slice(-6)

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'population', label: 'Population Report' },
    { id: 'outcomes', label: 'Outcomes' },
  ]

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h2>Reports & Statistics</h2>
          <p>Network-wide performance overview</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '.25rem', borderBottom: '2px solid var(--gray-200)', marginBottom: '1.5rem' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '.6rem 1.2rem',
              fontSize: '.87rem', fontWeight: 700, color: activeTab === tab.id ? 'var(--teal-700)' : 'var(--gray-500)',
              borderBottom: activeTab === tab.id ? '2px solid var(--teal-600)' : '2px solid transparent',
              marginBottom: '-2px', transition: 'all .15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'population' && (
        <PopulationReportPanel hospitals={hospitals} isCentral={isCentral} />
      )}

      {activeTab === 'outcomes' && (
        <OutcomesTab isCentral={isCentral} />
      )}

      {activeTab === 'overview' && (
        <>
          {/* Live summary stats */}
          <div className="report-stats-grid">
            <StatCard value={summary.total_babies} label="Total Enrolled" />
            <StatCard value={summary.active} label="Active" accent="var(--green-600)" />
            <StatCard value={summary.ltfu} label="Lost to Follow-Up" accent="var(--red-600)" />
            <StatCard
              value={`${summary.ltfu_rate}%`}
              label="LTFU Rate"
              sub={summary.ltfu_rate < 10 ? 'Within target' : 'Above target'}
              accent={summary.ltfu_rate < 10 ? 'var(--green-600)' : 'var(--red-600)'}
            />
            <StatCard
              value={`${sms_stats.success_rate}%`}
              label="SMS Success Rate"
              sub={`${sms_stats.sent} sent / ${sms_stats.failed} failed`}
              accent={sms_stats.success_rate >= 90 ? 'var(--green-600)' : 'var(--amber-600)'}
            />
          </div>

          <div className="report-two-col">
            <div className="card">
              <div className="card-section-header">Enrollment by Month</div>
              {chartMonths.length === 0 ? (
                <p style={{ fontSize: '.85rem', color: 'var(--gray-400)' }}>No enrollment data yet.</p>
              ) : (
                <BarChart data={chartMonths} valueKey="enrolled" labelKey="label" colorFn={() => 'var(--teal-500)'} />
              )}
            </div>

            <div className="card">
              <div className="card-section-header">SMS Delivery (Last 30 days)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '.5rem' }}>
                {[
                  { label: 'Sent successfully', value: sms_stats.sent, color: 'var(--green-500)' },
                  { label: 'Failed', value: sms_stats.failed, color: 'var(--red-500)' },
                ].map(row => (
                  <div key={row.label} className="bar-row">
                    <div className="bar-row-label">{row.label}</div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: sms_stats.total ? `${Math.round(row.value / sms_stats.total * 100)}%` : '0%', background: row.color }} />
                      <span className="bar-value">{row.value}</span>
                    </div>
                  </div>
                ))}
                <p style={{ fontSize: '.8rem', color: 'var(--gray-400)', marginTop: '.25rem' }}>
                  {sms_stats.total} total messages. {sms_stats.success_rate}% delivery rate.
                </p>
              </div>
            </div>
          </div>

          <div className="report-two-col">
            <div className="card">
              <div className="card-section-header">By Hospital</div>
              {hospital_breakdown.length === 0 ? (
                <p style={{ fontSize: '.85rem', color: 'var(--gray-400)' }}>No hospital data.</p>
              ) : (
                <table className="report-table">
                  <thead>
                    <tr><th>Hospital</th><th>District</th><th>Total</th><th>LTFU</th><th>Rate</th></tr>
                  </thead>
                  <tbody>
                    {hospital_breakdown.map(h => (
                      <tr key={h.hospital_id}>
                        <td style={{ fontWeight: 500 }}>{h.hospital_name}</td>
                        <td style={{ color: 'var(--gray-500)', fontSize: '.82rem' }}>{h.district}</td>
                        <td>{h.total}</td>
                        <td style={{ color: h.ltfu > 0 ? 'var(--red-600)' : 'inherit' }}>{h.ltfu}</td>
                        <td style={{ color: h.total > 0 && h.ltfu / h.total > 0.1 ? 'var(--red-600)' : 'var(--green-600)', fontSize: '.82rem', fontWeight: 600 }}>
                          {h.total > 0 ? `${Math.round(h.ltfu / h.total * 100)}%` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <div className="card-section-header">By ROP Finding</div>
              {stage_breakdown.length === 0 ? (
                <p style={{ fontSize: '.85rem', color: 'var(--gray-400)' }}>No exam data yet.</p>
              ) : (
                <BarChart
                  data={stage_breakdown.slice(0, 10)}
                  valueKey="count"
                  labelKey="zone_stage"
                  colorFn={d => {
                    if (d.zone_stage.startsWith('zone_i/')) return 'var(--red-500)'
                    if (d.zone_stage.startsWith('zone_ii/')) return 'var(--amber-500)'
                    return 'var(--green-500)'
                  }}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
