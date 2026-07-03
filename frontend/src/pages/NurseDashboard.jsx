import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { getDashboard, updateDilation, createScreeningRequest, getActiveScreeningRequest } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { getBabyDisplayName } from '../utils/babyName'

const DILATION_OPTIONS = [
  { value: 'dilated',          label: 'Dilated and ready for screening' },
  { value: 'not_dilated',      label: 'Not yet dilated' },
  { value: 'dilation_refused', label: 'Dilation refused' },
]

const DILATION_STYLE = {
  dilated:          { bg: 'var(--teal-50,#f0fdfa)', color: 'var(--teal-700,#0f766e)', label: 'Dilated - ready' },
  not_dilated:      { bg: 'var(--gray-100)', color: 'var(--gray-500)', label: 'Not dilated' },
  dilation_refused: { bg: 'var(--red-50,#fef2f2)', color: 'var(--red-600,#dc2626)', label: 'Refused' },
}

function DilationBadge({ status }) {
  if (!status) return <span style={{ color: 'var(--gray-400)', fontSize: '.8rem', fontStyle: 'italic' }}>Not set</span>
  const s = DILATION_STYLE[status] || {}
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '.15rem .55rem', borderRadius: 999, fontSize: '.78rem', fontWeight: 600,
    }}>
      {s.label}
    </span>
  )
}

function BabyRow({ baby }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [showDilation, setShowDilation] = useState(false)
  const [showRequest, setShowRequest] = useState(false)
  const [requestNote, setRequestNote] = useState('')

  const dilate = useMutation({
    mutationFn: (val) => updateDilation(baby.id, val),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nurse-dashboard'] }); setShowDilation(false) },
  })

  const { data: activeRequest } = useQuery({
    queryKey: ['active-screening-request', baby.id],
    queryFn: () => getActiveScreeningRequest(baby.id),
  })

  const requestScreening = useMutation({
    mutationFn: () => createScreeningRequest(baby.id, requestNote || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-screening-request', baby.id] })
      setShowRequest(false)
      setRequestNote('')
    },
  })

  const isLtfu = baby.urgency === 'ltfu'
  const phone = baby.mtn_phone || baby.airtel_phone

  return (
    <div className={`baby-card ${baby.urgency}`}>
      <div
        className="baby-card-header"
        onClick={() => navigate(`/babies/${baby.id}`)}
        style={{ cursor: 'pointer' }}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && navigate(`/babies/${baby.id}`)}
      >
        <div>
          <div className="baby-card-name">{getBabyDisplayName(baby)}</div>
          <div className="baby-card-sub">
            {baby.sex === 'male' ? 'Male' : 'Female'}
            &nbsp;·&nbsp; DOB {format(new Date(baby.date_of_birth + 'T00:00:00'), 'dd MMM yyyy')}
            {baby.hospital_name && <>&nbsp;·&nbsp; {baby.hospital_name}</>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexShrink: 0, alignItems: 'flex-start' }}>
          {isLtfu && <span className="badge badge-ltfu">LTFU</span>}
        </div>
      </div>

      <div className="baby-card-body">
        <div style={{ gridColumn: 'span 2' }}>
          <div className="baby-card-field-label">Dilation Status</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
            <DilationBadge status={baby.dilation_status} />
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '.75rem' }}
              onClick={() => setShowDilation(v => !v)}
            >
              {showDilation ? 'Cancel' : 'Update'}
            </button>
          </div>

          {showDilation && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', marginTop: '.5rem' }}>
              {DILATION_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className="btn btn-secondary btn-sm"
                  style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                  disabled={dilate.isPending}
                  onClick={() => dilate.mutate(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ gridColumn: 'span 2' }}>
          <div className="baby-card-field-label">Screening Request</div>
          {activeRequest ? (
            <div style={{ fontSize: '.82rem', color: activeRequest.status === 'claimed' ? 'var(--teal-700,#0f766e)' : 'var(--gray-500)' }}>
              {activeRequest.status === 'pending' && 'Pending - waiting for ophthalmologist to claim'}
              {activeRequest.status === 'claimed' && `Claimed by Dr. ${activeRequest.claimed_by_name}`}
              {activeRequest.status === 'escalated' && 'Escalated to coordinator (no response in 24h)'}
            </div>
          ) : (
            <>
              <button
                className="btn btn-primary btn-sm"
                style={{ marginTop: '.25rem' }}
                onClick={() => setShowRequest(v => !v)}
              >
                {showRequest ? 'Cancel' : 'Request Screening'}
              </button>
              {showRequest && (
                <div style={{ marginTop: '.5rem', display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                  <textarea
                    className="form-input"
                    rows={2}
                    placeholder="Optional note for ophthalmologist..."
                    value={requestNote}
                    onChange={e => setRequestNote(e.target.value)}
                    style={{ fontSize: '.82rem' }}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={requestScreening.isPending}
                    onClick={() => requestScreening.mutate()}
                  >
                    Send Request
                  </button>
                  {requestScreening.isError && (
                    <div style={{ fontSize: '.78rem', color: 'var(--red-600,#dc2626)' }}>
                      {requestScreening.error?.response?.data?.detail || 'Failed to send request'}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {phone && (
          <div style={{ gridColumn: 'span 2' }}>
            <div className="baby-card-field-label">Caregiver</div>
            <div className="baby-card-field-value">{baby.caregiver_name} &nbsp;·&nbsp; {phone}</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function NurseDashboard() {
  const { user } = useAuth()

  const { data: babies = [], isLoading } = useQuery({
    queryKey: ['nurse-dashboard'],
    queryFn: getDashboard,
  })

  // Nurses only see babies at their hospital (API handles scoping)
  // Priority order: ltfu first, then due_today, due_soon, on_track
  const urgencyOrder = { ltfu: 0, due_today: 1, due_soon: 2, on_track: 3 }
  const sorted = [...babies].sort((a, b) => (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9))

  const awaitingFirst = sorted.filter(b => !b.last_exam_date)
  const needingAttention = sorted.filter(b => b.last_exam_date && ['ltfu', 'due_today', 'due_soon'].includes(b.urgency))
  const onTrack = sorted.filter(b => b.last_exam_date && b.urgency === 'on_track')

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h2>NICU Dashboard</h2>
          <p>{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
        </div>
        <Link to="/enroll" className="btn btn-primary">+ Enroll Baby</Link>
      </div>

      <div className="urgency-grid">
        <div className="urgency-card ltfu">
          <div className="urgency-card-icon">!</div>
          <div className="urgency-card-value">{babies.filter(b => b.urgency === 'ltfu').length}</div>
          <div className="urgency-card-label">Lost to Follow-Up</div>
        </div>
        <div className="urgency-card due-today">
          <div className="urgency-card-icon">!</div>
          <div className="urgency-card-value">{babies.filter(b => b.urgency === 'due_today').length}</div>
          <div className="urgency-card-label">Due Today</div>
        </div>
        <div className="urgency-card due-soon">
          <div className="urgency-card-icon">~</div>
          <div className="urgency-card-value">{babies.filter(b => b.urgency === 'due_soon').length}</div>
          <div className="urgency-card-label">Due in 1-2 Days</div>
        </div>
        <div className="urgency-card total">
          <div className="urgency-card-icon">+</div>
          <div className="urgency-card-value">{babies.length}</div>
          <div className="urgency-card-label">Total Enrolled</div>
        </div>
      </div>

      {isLoading ? (
        <div className="spinner-center"><div className="spinner" /></div>
      ) : (
        <>
          {awaitingFirst.length > 0 && (
            <div className="urgency-section">
              <div className="urgency-section-header">
                <span className="urgency-section-dot due_today" />
                <span className="urgency-section-title">Awaiting First Exam</span>
                <span className="urgency-section-count due_today">{awaitingFirst.length}</span>
                <span style={{ fontSize: '.78rem', color: 'var(--gray-400)', marginLeft: '.25rem' }}>
                  - No exam recorded yet, set dilation and request screening
                </span>
              </div>
              <div className="baby-cards-grid">
                {awaitingFirst.map(b => <BabyRow key={b.id} baby={b} />)}
              </div>
            </div>
          )}

          {needingAttention.length > 0 && (
            <div className="urgency-section">
              <div className="urgency-section-header">
                <span className="urgency-section-dot ltfu" />
                <span className="urgency-section-title">Needs Attention</span>
                <span className="urgency-section-count ltfu">{needingAttention.length}</span>
              </div>
              <div className="baby-cards-grid">
                {needingAttention.map(b => <BabyRow key={b.id} baby={b} />)}
              </div>
            </div>
          )}

          {onTrack.length > 0 && (
            <div className="urgency-section">
              <div className="urgency-section-header">
                <span className="urgency-section-dot on_track" />
                <span className="urgency-section-title">On Track</span>
                <span className="urgency-section-count on_track">{onTrack.length}</span>
              </div>
              <div className="baby-cards-grid">
                {onTrack.map(b => <BabyRow key={b.id} baby={b} />)}
              </div>
            </div>
          )}

          {babies.length === 0 && (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon">👶</div>
                <p>No babies enrolled yet.</p>
                <Link to="/enroll" className="btn btn-primary btn-sm" style={{ marginTop: '.25rem' }}>Enroll First Baby</Link>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
