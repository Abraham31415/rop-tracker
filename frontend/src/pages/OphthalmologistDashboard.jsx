import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { getDashboard, getPendingScreeningRequests, claimScreeningRequest } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { getBabyDisplayName } from '../utils/babyName'

const DILATION_LABELS = {
  dilated:          { label: 'Dilated', color: 'var(--teal-700,#0f766e)' },
  not_dilated:      { label: 'Not dilated', color: 'var(--gray-500)' },
  dilation_refused: { label: 'Refused', color: 'var(--red-600,#dc2626)' },
}

function ScreeningRequestCard({ req }) {
  const qc = useQueryClient()
  const claim = useMutation({
    mutationFn: () => claimScreeningRequest(req.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pending-screening-requests'] }),
  })

  const isMine = req.status === 'claimed'

  return (
    <div className={`baby-card ${isMine ? 'due_today' : 'due_soon'}`}>
      <div className="baby-card-header">
        <div>
          <Link
            to={`/babies/${req.baby_id}`}
            className="baby-card-name"
            style={{ textDecoration: 'none', color: 'inherit' }}
            onClick={e => e.stopPropagation()}
          >{getBabyDisplayName(req.baby_name)}</Link>
          <div className="baby-card-sub">
            Requested by {req.requested_by_name}
            &nbsp;·&nbsp; {formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}
          </div>
        </div>
        {isMine
          ? <span className="badge badge-due_today">Claimed by you</span>
          : <span className="badge badge-due_soon">Pending</span>
        }
      </div>

      {req.notes && (
        <div style={{ padding: '.25rem 0', fontSize: '.82rem', color: 'var(--gray-600)' }}>
          {req.notes}
        </div>
      )}

      <div className="baby-card-footer" onClick={e => e.stopPropagation()}>
        <Link to={`/babies/${req.baby_id}`} className="btn btn-secondary btn-sm">View Baby</Link>
        {req.status === 'pending' && (
          <button
            className="btn btn-primary btn-sm"
            disabled={claim.isPending}
            onClick={() => claim.mutate()}
          >
            I will examine this baby
          </button>
        )}
        {isMine && (
          <Link to={`/babies/${req.baby_id}/exam`} className="btn btn-primary btn-sm">
            Record Exam
          </Link>
        )}
      </div>
    </div>
  )
}

function PatientCard({ baby }) {
  const navigate = useNavigate()
  const dil = DILATION_LABELS[baby.dilation_status]
  const phone = baby.mtn_phone || baby.airtel_phone

  return (
    <div
      className={`baby-card ${baby.urgency}`}
      onClick={() => navigate(`/babies/${baby.id}`)}
      style={{ cursor: 'pointer' }}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && navigate(`/babies/${baby.id}`)}
    >
      <div className="baby-card-header">
        <div>
          <div className="baby-card-name">{getBabyDisplayName(baby)}</div>
          <div className="baby-card-sub">
            {baby.hospital_name}
            &nbsp;·&nbsp; DOB {format(new Date(baby.date_of_birth + 'T00:00:00'), 'dd MMM yyyy')}
          </div>
        </div>
        <span className={`badge badge-${baby.urgency}`} style={{ flexShrink: 0 }}>
          {baby.urgency === 'ltfu' ? 'LTFU' : baby.urgency === 'due_today' ? 'Today' : baby.urgency === 'due_soon' ? 'Soon' : 'On Track'}
        </span>
      </div>

      <div className="baby-card-body">
        <div>
          <div className="baby-card-field-label">Gest. Age</div>
          <div className="baby-card-field-value">{baby.gestational_age_weeks != null ? `${baby.gestational_age_weeks}w` : '-'}</div>
        </div>
        <div>
          <div className="baby-card-field-label">Dilation</div>
          <div className="baby-card-field-value" style={{ color: dil?.color }}>
            {dil ? dil.label : <span style={{ color: 'var(--gray-400)', fontStyle: 'italic' }}>Not set</span>}
          </div>
        </div>
        {baby.last_stage && (
          <div style={{ gridColumn: 'span 2' }}>
            <div className="baby-card-field-label">Last Finding</div>
            <div className="baby-card-field-value finding">{baby.last_zone?.replace('_', ' ')} / {baby.last_stage?.replace(/_/g, ' ')}</div>
          </div>
        )}
        <div style={{ gridColumn: 'span 2' }}>
          <div className="baby-card-field-label">Next Exam Due</div>
          <div className="baby-card-field-value">
            {baby.next_due_date
              ? format(new Date(baby.next_due_date + 'T00:00:00'), 'dd MMM yyyy')
              : <span style={{ color: 'var(--gray-400)', fontStyle: 'italic' }}>Not scheduled</span>}
          </div>
        </div>
      </div>

      <div className="baby-card-footer" onClick={e => e.stopPropagation()}>
        <div className="baby-card-caregiver">
          <strong>{baby.caregiver_name}</strong>
          {phone && <span>{phone}</span>}
        </div>
        <Link to={`/babies/${baby.id}/exam`} className="btn btn-primary btn-sm">Examine</Link>
      </div>
    </div>
  )
}

export default function OphthalmologistDashboard() {
  const { user } = useAuth()

  const { data: myPatients = [], isLoading: loadingPatients } = useQuery({
    queryKey: ['ophthalm-dashboard'],
    queryFn: getDashboard,
  })

  const { data: screeningRequests = [], isLoading: loadingRequests } = useQuery({
    queryKey: ['pending-screening-requests'],
    queryFn: getPendingScreeningRequests,
    refetchInterval: 30_000,
  })

  const urgencyOrder = { ltfu: 0, due_today: 1, due_soon: 2, on_track: 3 }
  const sorted = [...myPatients].sort((a, b) => (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9))

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h2>Ophthalmologist Dashboard</h2>
          <p>{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
        </div>
      </div>

      {/* Screening requests section */}
      {(loadingRequests || screeningRequests.length > 0) && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{
            background: 'var(--amber-50)', border: '1px solid var(--amber-500)',
            borderRadius: 10, padding: '1rem 1.25rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '.75rem' }}>
              <span style={{
                background: 'var(--amber-500,#f59e0b)', color: '#fff',
                borderRadius: 999, width: 22, height: 22,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '.7rem', fontWeight: 700, flexShrink: 0,
              }}>!</span>
              <span style={{ fontWeight: 600, fontSize: '.95rem', color: 'var(--gray-800)' }}>
                Screening Requests
                {screeningRequests.length > 0 && (
                  <span style={{
                    marginLeft: '.5rem', background: 'var(--amber-500,#f59e0b)', color: '#fff',
                    borderRadius: 999, padding: '.05rem .5rem', fontSize: '.75rem',
                  }}>{screeningRequests.length}</span>
                )}
              </span>
            </div>
            {loadingRequests ? (
              <div className="spinner-center" style={{ minHeight: 60 }}><div className="spinner" /></div>
            ) : screeningRequests.length === 0 ? (
              <p style={{ color: 'var(--gray-500)', fontSize: '.85rem', margin: 0 }}>No pending screening requests.</p>
            ) : (
              <div className="baby-cards-grid">
                {screeningRequests.map(r => <ScreeningRequestCard key={r.id} req={r} />)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* My patients */}
      <div style={{ marginBottom: '.5rem', display: 'flex', alignItems: 'center', gap: '.75rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--gray-700)' }}>My Patients</h3>
        <span style={{ fontSize: '.8rem', color: 'var(--gray-400)' }}>Babies you have examined or enrolled</span>
      </div>

      {loadingPatients ? (
        <div className="spinner-center"><div className="spinner" /></div>
      ) : sorted.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">👁️</div>
            <p>No patients yet. Once you record exams, babies will appear here.</p>
          </div>
        </div>
      ) : (
        <div className="baby-cards-grid">
          {sorted.map(b => <PatientCard key={b.id} baby={b} />)}
        </div>
      )}
    </div>
  )
}
