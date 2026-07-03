import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { searchBabies } from '../services/api'
import { getBabyDisplayName } from '../utils/babyName'

const ZONE_LABELS  = { zone_i: 'Zone I', zone_ii: 'Zone II', zone_iii: 'Zone III' }
const STAGE_LABELS = { no_rop: 'No ROP', stage_1: 'Stage 1', stage_2: 'Stage 2', stage_3: 'Stage 3', immature: 'Immature' }
const URGENCY_MAP  = { ltfu: ['badge-ltfu', 'LTFU'], due_today: ['badge-due_today', 'Today'], due_soon: ['badge-due_soon', 'Soon'], on_track: ['badge-on_track', 'On Track'] }

export default function SearchPage() {
  const [q, setQ] = useState('')

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['search', q],
    queryFn: () => searchBabies(q),
    enabled: q.trim().length >= 2,
    staleTime: 5000,
  })

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h2>Search</h2>
          <p>Find a baby by name, or a caregiver by name or phone number</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="search-page-input-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 22, height: 22, color: 'var(--teal-600)', flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            autoFocus
            className="search-page-input"
            placeholder="Type a baby name, caregiver name, or phone number…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          {isFetching && <div className="spinner" style={{ width: 18, height: 18, flexShrink: 0 }} />}
        </div>
        {q.length > 0 && q.length < 2 && (
          <p style={{ fontSize: '.8rem', color: 'var(--gray-400)', marginTop: '.75rem', paddingLeft: '2.5rem' }}>
            Type at least 2 characters to search…
          </p>
        )}
      </div>

      {q.trim().length >= 2 && !isFetching && results.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🔍</div>
            <p>No results for "<strong>{q}</strong>"</p>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '.75rem 1.25rem', borderBottom: '1px solid var(--gray-100)', fontSize: '.8rem', color: 'var(--gray-500)', fontWeight: 600 }}>
            {results.length} result{results.length !== 1 ? 's' : ''} for "{q}"
          </div>
          {results.map(b => {
            const [badgeClass, badgeLabel] = URGENCY_MAP[b.urgency] || ['', b.urgency]
            const phone = b.mtn_phone || b.airtel_phone
            const finding = b.last_zone
              ? `${ZONE_LABELS[b.last_zone] || b.last_zone} / ${STAGE_LABELS[b.last_stage] || b.last_stage}`
              : null
            return (
              <div key={b.id} className="search-result-row">
                <div className="search-result-main">
                  <div className="search-result-name">{getBabyDisplayName(b)}</div>
                  <div className="search-result-meta">
                    <span>{b.caregiver_name}</span>
                    {phone && <span>· {phone}</span>}
                    {b.hospital_name && <span>· {b.hospital_name}</span>}
                    {finding && <span>· {finding}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexShrink: 0 }}>
                  <span className={`badge ${badgeClass}`}>{badgeLabel}</span>
                  <Link to={`/babies/${b.id}`} className="btn btn-secondary btn-sm">View Profile</Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
