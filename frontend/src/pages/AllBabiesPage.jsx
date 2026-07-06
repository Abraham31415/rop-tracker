import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { getDashboard, listHospitals } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { getBabyDisplayName } from '../utils/babyName'

const ZONE_LABELS  = { zone_i: 'Zone I', zone_ii: 'Zone II', zone_iii: 'Zone III' }
const STAGE_LABELS = { no_rop: 'No ROP', stage_1: 'St.1', stage_2: 'St.2', stage_3: 'St.3', immature: 'Immature' }

const URGENCY_OPTIONS = [
  { value: '', label: 'All urgencies' },
  { value: 'ltfu', label: 'LTFU' },
  { value: 'due_today', label: 'Due Today' },
  { value: 'due_soon', label: 'Due Soon' },
  { value: 'on_track', label: 'On Track' },
]
const STAGE_OPTIONS = [
  { value: '', label: 'All stages' },
  { value: 'no_rop', label: 'No ROP' },
  { value: 'stage_1', label: 'Stage 1' },
  { value: 'stage_2', label: 'Stage 2' },
  { value: 'stage_3', label: 'Stage 3' },
  { value: 'immature', label: 'Immature' },
]

function urgencyBadge(u) {
  const map = { ltfu: 'badge-ltfu', due_today: 'badge-due_today', due_soon: 'badge-due_soon', on_track: 'badge-on_track' }
  const label = { ltfu: 'LTFU', due_today: 'Today', due_soon: 'Soon', on_track: 'On Track' }
  return <span className={`badge ${map[u] || ''}`}>{label[u] || u}</span>
}

export default function AllBabiesPage() {
  const { user } = useAuth()
  const isCentral = user?.role === 'central_coordinator'
  const [searchParams] = useSearchParams()

  const [q, setQ] = useState('')
  const [urgency, setUrgency] = useState(() => searchParams.get('urgency') || '')
  const [stage, setStage] = useState('')
  const [hospitalId, setHospitalId] = useState('')

  const { data: babies = [], isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboard,
  })
  const { data: hospitals = [] } = useQuery({
    queryKey: ['hospitals'],
    queryFn: listHospitals,
    enabled: isCentral,
  })

  const filtered = useMemo(() => {
    let list = babies
    if (urgency) list = list.filter(b => b.urgency === urgency)
    if (stage)   list = list.filter(b => b.last_stage === stage)
    if (hospitalId) list = list.filter(b => {
      const h = hospitals.find(h => h.name === b.hospital_name)
      return h && h.id === hospitalId
    })
    if (q) {
      const lq = q.toLowerCase()
      list = list.filter(b =>
        b.full_name?.toLowerCase().includes(lq) ||
        b.caregiver_name?.toLowerCase().includes(lq) ||
        b.rop_id?.toLowerCase().includes(lq)
      )
    }
    return list
  }, [babies, urgency, stage, hospitalId, q, hospitals])

  const clearFilters = () => { setQ(''); setUrgency(''); setStage(''); setHospitalId('') }
  const hasFilters = q || urgency || stage || hospitalId

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h2>All Babies</h2>
          <p>{filtered.length} of {babies.length} enrolled babies</p>
        </div>
        <Link to="/enroll" className="btn btn-primary">+ Enroll Baby</Link>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <div className="filter-search-wrap">
          <svg className="filter-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="filter-search"
            placeholder="Search by name, caregiver, or ROP ID…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>

        <select className="filter-select" value={urgency} onChange={e => setUrgency(e.target.value)}>
          {URGENCY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select className="filter-select" value={stage} onChange={e => setStage(e.target.value)}>
          {STAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {isCentral && (
          <select className="filter-select" value={hospitalId} onChange={e => setHospitalId(e.target.value)}>
            <option value="">All hospitals</option>
            {hospitals.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        )}

        {hasFilters && (
          <button className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear filters</button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="spinner-center"><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🔍</div>
            <p>No babies match your filters.</p>
            {hasFilters && <button className="btn btn-secondary btn-sm" onClick={clearFilters} style={{ marginTop: '.5rem' }}>Clear filters</button>}
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="card-table-wrap">
          <table className="babies-table">
            <thead>
              <tr>
                <th>Baby</th>
                <th>ROP ID</th>
                <th>Caregiver / Phone</th>
                {isCentral && <th>Hospital</th>}
                <th>GA / Weight</th>
                <th>ROP Finding</th>
                <th>Next Exam</th>
                <th>Urgency</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => {
                const phone = b.mtn_phone || b.airtel_phone
                const finding = b.last_zone
                  ? `${ZONE_LABELS[b.last_zone] || b.last_zone} / ${STAGE_LABELS[b.last_stage] || b.last_stage || '-'}`
                  : '-'
                const dueText = b.next_due_date
                  ? format(new Date(b.next_due_date + 'T00:00:00'), 'dd MMM yyyy')
                  : '-'
                const dueClass = b.days_until_due < 0 ? 'text-red' : b.days_until_due <= 2 ? 'text-amber' : ''
                return (
                  <tr key={b.id}>
                    <td>
                      <div className="table-baby-name">{getBabyDisplayName(b)}</div>
                      <div className="table-baby-sub">
                        {b.sex === 'male' ? 'M' : 'F'} · DOB {b.date_of_birth ? format(new Date(b.date_of_birth + 'T00:00:00'), 'dd MMM yy') : '-'}
                      </div>
                    </td>
                    <td>
                      {b.rop_id ? (
                        <span style={{
                          fontFamily: 'monospace', fontSize: '.78rem', fontWeight: 700,
                          background: 'var(--teal-50)', color: 'var(--teal-700)',
                          border: '1px solid var(--teal-200)', borderRadius: 4,
                          padding: '2px 6px', whiteSpace: 'nowrap',
                        }}>{b.rop_id}</span>
                      ) : <span style={{ color: 'var(--gray-300)', fontSize: '.75rem' }}>-</span>}
                    </td>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: '.85rem' }}>{b.caregiver_name}</div>
                      {phone && <div style={{ fontSize: '.78rem', color: 'var(--gray-500)' }}>{phone}</div>}
                    </td>
                    {isCentral && <td style={{ fontSize: '.83rem' }}>{b.hospital_name || '-'}</td>}
                    <td style={{ fontSize: '.83rem', whiteSpace: 'nowrap' }}>
                      {b.gestational_age_weeks != null ? `${b.gestational_age_weeks}w` : '-'}
                      {' / '}
                      {b.birth_weight_grams != null ? `${Math.round(b.birth_weight_grams)}g` : '-'}
                    </td>
                    <td style={{ fontSize: '.83rem' }}>{finding}</td>
                    <td className={`table-due ${dueClass}`} style={{ fontSize: '.83rem', whiteSpace: 'nowrap' }}>
                      {dueText}
                      {b.days_until_due < 0 && b.next_due_date && (
                        <div style={{ fontSize: '.73rem' }}>{Math.abs(b.days_until_due)}d overdue</div>
                      )}
                    </td>
                    <td>{urgencyBadge(b.urgency)}</td>
                    <td>
                      <Link to={`/babies/${b.id}`} className="btn btn-secondary btn-sm">View</Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}
