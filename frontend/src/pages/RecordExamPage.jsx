import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getBaby, recordExam } from '../services/api'
import { format, addWeeks } from 'date-fns'

// ── ROP scheduling logic ──────────────────────────────────────────────────────
const ZONE_RANK  = { zone_i: 1, zone_ii: 2, zone_iii: 3 }
const STAGE_RANK = { stage_5: 5, stage_4: 4, stage_3: 3, stage_2: 2, stage_1: 1, immature: 0, no_rop: -1 }

function deriveWorstFinding(rZ, rS, rP, lZ, lS, lP) {
  let worstZone = null, worstStage = null, hasPlus = false
  for (const [zone, stage, plus] of [[rZ, rS, rP], [lZ, lS, lP]]) {
    if (!zone) continue
    if (!worstZone || ZONE_RANK[zone] < ZONE_RANK[worstZone]) worstZone = zone
    if (stage != null && (!worstStage || STAGE_RANK[stage] > STAGE_RANK[worstStage])) worstStage = stage
    if (plus === 'plus' || plus === 'pre_plus') hasPlus = true
  }
  return { worstZone, worstStage, hasPlus }
}

function calcNextExamWeeks(worstZone, worstStage) {
  if (!worstZone) return null
  if (worstZone === 'zone_i') return 1
  if (worstZone === 'zone_ii') {
    if (['stage_2', 'stage_3', 'stage_4', 'stage_5'].includes(worstStage)) return 1
    return 2
  }
  if (worstStage === 'stage_1') return 2
  return 4
}

// ── Labels ────────────────────────────────────────────────────────────────────
const ZONE_LABELS  = { zone_i: 'Zone I', zone_ii: 'Zone II', zone_iii: 'Zone III' }
const STAGE_LABELS = { no_rop: 'No ROP', stage_1: 'Stage 1', stage_2: 'Stage 2', stage_3: 'Stage 3', stage_4: 'Stage 4', stage_5: 'Stage 5', immature: 'Immature' }
const PLUS_LABELS  = { none: 'None', pre_plus: 'Pre-Plus', plus: 'Plus' }

// ── Eye sub-form ──────────────────────────────────────────────────────────────
function EyeForm({ side, values, onChange }) {
  const prefix = side
  const zones    = ['zone_i', 'zone_ii', 'zone_iii']
  const stages   = ['no_rop', 'immature', 'stage_1', 'stage_2', 'stage_3', 'stage_4', 'stage_5']
  const plusOpts = ['none', 'pre_plus', 'plus']

  return (
    <div className={`eye-panel ${side}`}>
      <div className="eye-panel-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        {side === 'right' ? 'Right Eye (OD)' : 'Left Eye (OS)'}
      </div>
      <div className="eye-panel-body">

        {/* Zone */}
        <div>
          <div className="toggle-label">Zone</div>
          <div className="toggle-row">
            {zones.map(z => (
              <button
                key={z}
                type="button"
                className={`toggle-btn${values[prefix + '_zone'] === z ? ' active-zone' : ''}`}
                onClick={() => onChange(prefix + '_zone', z === values[prefix + '_zone'] ? null : z)}
                style={{ flex: 1 }}
              >
                {ZONE_LABELS[z].replace('Zone ', 'Zone ')}
              </button>
            ))}
          </div>
        </div>

        {/* Stage */}
        <div>
          <div className="toggle-label">Stage</div>
          <div className="toggle-row">
            {stages.map(s => (
              <button
                key={s}
                type="button"
                className={`toggle-btn${values[prefix + '_stage'] === s ? ' active-stage' : ''}`}
                onClick={() => onChange(prefix + '_stage', s === values[prefix + '_stage'] ? null : s)}
              >
                {STAGE_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Plus disease */}
        <div>
          <div className="toggle-label">Plus Disease</div>
          <div className="toggle-row">
            {plusOpts.map(p => {
              const cls = p === 'none' ? 'active-none' : p === 'pre_plus' ? 'active-pre' : 'active-plus'
              return (
                <button
                  key={p}
                  type="button"
                  className={`toggle-btn${values[prefix + '_plus'] === p ? ` ${cls}` : ''}`}
                  onClick={() => onChange(prefix + '_plus', p)}
                  style={{ flex: 1 }}
                >
                  {PLUS_LABELS[p]}
                </button>
              )
            })}
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Scheduling banner ─────────────────────────────────────────────────────────
function SchedulingBanner({ fields, examDate }) {
  const { worstZone, worstStage, hasPlus } = deriveWorstFinding(
    fields.right_zone, fields.right_stage, fields.right_plus,
    fields.left_zone,  fields.left_stage,  fields.left_plus,
  )
  const weeks = calcNextExamWeeks(worstZone, worstStage)

  if (!worstZone || !weeks || !examDate) {
    return (
      <div className="schedule-banner empty">
        <span style={{ fontSize: '.875rem', color: 'var(--gray-400)' }}>
          Select findings for at least one eye to see the auto-scheduled next appointment.
        </span>
      </div>
    )
  }

  const due  = addWeeks(new Date(examDate + 'T00:00:00'), weeks)
  const cls  = weeks === 1 ? 'week-1' : weeks === 2 ? 'week-2' : 'week-4'

  return (
    <div className={`schedule-banner ${cls}`}>
      <div>
        <div className="schedule-weeks">
          Next exam in {weeks} week{weeks > 1 ? 's' : ''}
        </div>
        <div className="schedule-finding">
          Worst: {ZONE_LABELS[worstZone]}{worstStage ? ` / ${STAGE_LABELS[worstStage]}` : ''}{hasPlus ? ' + Plus' : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="schedule-date">{format(due, 'dd MMM yyyy')}</div>
        <div className="schedule-date-label">Appointment due date</div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function RecordExamPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const { data: baby, isLoading } = useQuery({
    queryKey: ['baby', id],
    queryFn: () => getBaby(id),
  })

  const today = format(new Date(), 'yyyy-MM-dd')

  const [fields, setFields] = useState({
    right_zone: null, right_stage: null, right_plus: 'none',
    left_zone:  null, left_stage:  null, left_plus:  'none',
  })
  const [examDate, setExamDate]           = useState(today)
  const [postnatalAge, setPostnatalAge]   = useState('')
  const [treatment, setTreatment]         = useState('')
  const [notes, setNotes]                 = useState('')
  const [submitting, setSubmitting]       = useState(false)
  const [error, setError]                 = useState('')

  const handleFieldChange = (key, value) => setFields(prev => ({ ...prev, [key]: value }))

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    if (!fields.right_zone && !fields.left_zone) {
      setError('Please enter findings for at least one eye.')
      return
    }
    setSubmitting(true)
    try {
      await recordExam({
        baby_id: id, exam_date: examDate,
        postnatal_age_days: postnatalAge ? parseInt(postnatalAge) : null,
        right_zone: fields.right_zone || null, right_stage: fields.right_stage || null, right_plus: fields.right_plus || 'none',
        left_zone:  fields.left_zone  || null, left_stage:  fields.left_stage  || null, left_plus:  fields.left_plus  || 'none',
        treatment_recommended: treatment || null, notes: notes || null,
      })
      navigate(`/babies/${id}`)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save exam. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading) return <div className="spinner-center"><div className="spinner" /></div>
  if (!baby) return <div className="alert alert-error">Baby not found.</div>

  const dob = format(new Date(baby.date_of_birth + 'T00:00:00'), 'dd MMM yyyy')

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>

      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate(`/babies/${id}`)}>← Back</button>
          <div>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--gray-900)', letterSpacing: '-.02em' }}>Record ROP Exam</h2>
            <p style={{ color: 'var(--gray-500)', fontSize: '.875rem', marginTop: '.15rem' }}>
              {baby.full_name} · DOB {dob} · GA {baby.gestational_age_weeks}w · {baby.birth_weight_grams}g
            </p>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit}>

        {/* Exam metadata */}
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--teal-600)', textTransform: 'uppercase', letterSpacing: '.09em', marginBottom: '.9rem' }}>
            Exam Details
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Date of Examination *</label>
              <input type="date" value={examDate} max={today} onChange={e => setExamDate(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Postnatal Age (days)</label>
              <input type="number" min="0" value={postnatalAge} onChange={e => setPostnatalAge(e.target.value)} placeholder="e.g. 42" />
            </div>
          </div>
        </div>

        {/* Eye findings */}
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.9rem' }}>
            <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--teal-600)', textTransform: 'uppercase', letterSpacing: '.09em' }}>
              Fundus Findings
            </div>
            <span style={{ fontSize: '.75rem', color: 'var(--gray-400)' }}>Click to select · click again to deselect</span>
          </div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <EyeForm side="right" values={fields} onChange={handleFieldChange} />
            <EyeForm side="left"  values={fields} onChange={handleFieldChange} />
          </div>
        </div>

        {/* Scheduling banner */}
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--teal-600)', textTransform: 'uppercase', letterSpacing: '.09em', marginBottom: '.6rem' }}>
            Auto-Scheduled Next Appointment
          </div>
          <SchedulingBanner fields={fields} examDate={examDate} />
        </div>

        {/* Treatment & Notes */}
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--teal-600)', textTransform: 'uppercase', letterSpacing: '.09em', marginBottom: '.9rem' }}>
            Treatment &amp; Notes
          </div>
          <div className="form-row" style={{ marginBottom: '.85rem' }}>
            <div className="form-group">
              <label>Treatment Recommended</label>
              <select value={treatment} onChange={e => setTreatment(e.target.value)}>
                <option value="">None / Observation only</option>
                <option value="laser">Laser Photocoagulation</option>
                <option value="bevacizumab">Intravitreal Bevacizumab (IVB)</option>
                <option value="laser_and_bevacizumab">Laser + Bevacizumab</option>
                <option value="surgery">Vitreoretinal Surgery</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Clinical Notes</label>
            <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional clinical observations…" style={{ resize: 'vertical' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={() => navigate(`/babies/${id}`)}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save Exam & Schedule Next Appointment'}
          </button>
        </div>

      </form>
    </div>
  )
}
