import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getBaby, listExams, listReminders, logPhoneCall, listHospitals, getOutcome, upsertOutcome, listReferrals, createReferral, updateReferralStatus, updateBaby, getContactLogs, addContactNote, updateDilation, dischargeBaby, reactivateBaby, retrySMS, listAppointments, rescheduleAppointment } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { format, formatDistanceToNow } from 'date-fns'
import { generateBabyFullPDF, generateSingleVisitPDF } from '../services/pdfExport'
import { getBabyDisplayName } from '../utils/babyName'
import { REVIEW_DATE_REASONS, resolveReason, validateReviewDate } from '../utils/reviewDate'

// ── SMS error → human-readable message ───────────────────────────────────────
function mapSmsError(raw) {
  if (!raw) return 'SMS delivery failed: please contact parent directly'
  const e = raw.toLowerCase()
  if (/ssl|connection error|econnrefused|network|connect timed out/.test(e))
    return 'Could not reach SMS provider: network issue'
  if (/invalid.*phone|phone.*invalid|invalid destination|not a valid|unreachable/.test(e))
    return 'Phone number is invalid or unreachable'
  if (/balance|credit|insufficient|low funds/.test(e))
    return 'SMS not sent: account balance too low'
  if (/timeout|timed out/.test(e))
    return 'SMS provider did not respond, will retry'
  return 'SMS delivery failed: please contact parent directly'
}

// ── Labels ────────────────────────────────────────────────────────────────────
const ZONE_LABELS  = { zone_i: 'Zone I', zone_ii: 'Zone II', zone_iii: 'Zone III' }
const STAGE_LABELS = { no_rop: 'No ROP', stage_1: 'Stage 1', stage_2: 'Stage 2', stage_3: 'Stage 3', stage_4: 'Stage 4', stage_5: 'Stage 5', immature: 'Immature' }
const PLUS_LABELS  = { none: 'No Plus', pre_plus: 'Pre-Plus', plus: 'Plus Disease' }
const LANG_MAP     = { english: 'English', luganda: 'Luganda', runyankole: 'Runyankole', acholi: 'Acholi', ateso: 'Ateso' }
const TREATMENT_LABELS = {
  laser: 'Laser Photocoagulation',
  bevacizumab: 'Intravitreal Bevacizumab (IVB)',
  laser_and_bevacizumab: 'Laser + Bevacizumab',
  surgery: 'Vitreoretinal Surgery',
}
const TRIGGER_META = {
  t_minus_3:   { label: '3 Days Before', short: 'T-3',   icon: '✉', cls: 'sms'  },
  t_minus_1:   { label: '1 Day Before',  short: 'T-1',   icon: '✉', cls: 'sms'  },
  day_of:      { label: 'Day-Of',        short: 'Day',   icon: '✉', cls: 'sms'  },
  ltfu_48h:    { label: 'LTFU Alert',    short: 'LTFU',  icon: '!', cls: 'ltfu' },
  manual_call: { label: 'Phone Call',    short: 'Call',  icon: '☎', cls: 'call' },
}
const STATUS_STYLE = {
  sent:         { bg: 'var(--green-100)', color: 'var(--green-700)', label: 'Sent' },
  failed:       { bg: 'var(--red-100)',   color: 'var(--red-700)',   label: 'Failed' },
  acknowledged: { bg: '#dbeafe',          color: '#1d4ed8',          label: 'Logged' },
  pending:      { bg: 'var(--gray-100)', color: 'var(--gray-500)',  label: 'Pending' },
}

// VF labels
const VF_FIXATION_LABELS = { central: 'Central', eccentric: 'Eccentric', none_unable: 'None/Unable' }
const VF_FOLLOWING_LABELS = { follows_smoothly: 'Follows smoothly', follows_partially: 'Follows partially', does_not_follow: 'Does not follow', unable_to_assess: 'Unable' }
const VF_CSM_LABELS = { csm: 'CSM', cs: 'CS', c: 'C', not_central: 'Not central', unable_to_assess: 'Unable' }
const VF_NYSTAGMUS_LABELS = { absent: 'Absent', pendular: 'Pendular', jerk: 'Jerk', latent: 'Latent' }
const VF_STRABISMUS_LABELS = { absent: 'Absent', esotropia: 'Esotropia', exotropia: 'Exotropia', suspected: 'Suspected' }
const VF_IMPRESSION_LABELS = {
  age_appropriate: 'Age-appropriate',
  mildly_delayed: 'Mildly delayed - monitor',
  significantly_delayed: 'Significantly delayed - refer',
  unable_to_assess: 'Unable to assess',
}

function hasVFData(exam) {
  return !!(exam.vf_right_fixation || exam.vf_left_fixation || exam.vf_right_following ||
    exam.vf_left_following || exam.vf_right_csm || exam.vf_left_csm ||
    exam.vf_nystagmus || exam.vf_strabismus || exam.vf_functional_impression)
}

function vfSummaryLine(exam) {
  const parts = []
  if (exam.vf_right_fixation || exam.vf_right_following) {
    const od = [VF_FIXATION_LABELS[exam.vf_right_fixation], VF_FOLLOWING_LABELS[exam.vf_right_following]].filter(Boolean).join(', ')
    if (od) parts.push(`OD: ${od}`)
  }
  if (exam.vf_left_fixation || exam.vf_left_following) {
    const os = [VF_FIXATION_LABELS[exam.vf_left_fixation], VF_FOLLOWING_LABELS[exam.vf_left_following]].filter(Boolean).join(', ')
    if (os) parts.push(`OS: ${os}`)
  }
  return parts.join(' | ')
}

// ── Severity of an exam finding ───────────────────────────────────────────────
function examSeverity(exam) {
  const zone = exam.worst_zone || exam.right_zone || exam.left_zone
  const stage = exam.worst_stage
  if (!zone) return 'low'
  if (zone === 'zone_i') return 'critical'
  if (zone === 'zone_ii' && ['stage_2','stage_3','stage_4','stage_5'].includes(stage)) return 'high'
  if (zone === 'zone_ii') return 'moderate'
  return 'low'
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '.45rem 0', borderBottom: '1px solid var(--gray-100)' }}>
      <span style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0, marginRight: '1rem' }}>{label}</span>
      <span style={{ fontSize: '.88rem', fontWeight: 600, color: 'var(--gray-800)', textAlign: 'right' }}>{value || '-'}</span>
    </div>
  )
}

function RiskChip({ active, label }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '.3rem',
      padding: '.25rem .6rem', borderRadius: 999,
      fontSize: '.75rem', fontWeight: 700,
      background: active ? 'var(--red-100)' : 'var(--gray-100)',
      color: active ? 'var(--red-700)' : 'var(--gray-400)',
    }}>
      {active && '● '}{label}
    </span>
  )
}

function SectionHeading({ children }) {
  return (
    <div style={{ fontSize: '.68rem', fontWeight: 700, color: 'var(--teal-600)', textTransform: 'uppercase', letterSpacing: '.09em', marginBottom: '.75rem' }}>
      {children}
    </div>
  )
}

// ── Exam timeline ─────────────────────────────────────────────────────────────
function ExamTimeline({ exams, baby, hospitalName }) {
  const [expanded, setExpanded] = useState({})
  const [printing, setPrinting] = useState({})
  const dark = useTheme().resolved === 'dark'
  const toggle = id => setExpanded(p => ({ ...p, [id]: !p[id] }))

  const handlePrintExam = async (exam) => {
    setPrinting(p => ({ ...p, [exam.id]: true }))
    try {
      await generateSingleVisitPDF(baby, exam, hospitalName)
    } finally {
      setPrinting(p => ({ ...p, [exam.id]: false }))
    }
  }

  if (!exams.length) {
    return (
      <div className="empty-state" style={{ padding: '2.5rem 1rem' }}>
        <div className="empty-state-icon">👁</div>
        <p>No exams recorded yet.</p>
      </div>
    )
  }

  return (
    <div className="timeline">
      {exams.map((exam, idx) => {
        const sev = examSeverity(exam)
        const sevColors = {
          critical: { dot: 'var(--red-600)',   bg: dark ? '#3b1212' : '#fef2f2', border: dark ? '#7f1d1d' : '#fca5a5', text: dark ? '#fca5a5' : 'var(--red-700)' },
          high:     { dot: '#ea580c',           bg: dark ? '#3b2800' : '#fff7ed', border: dark ? '#78350f' : '#fed7aa', text: dark ? '#fdba74' : '#c2410c' },
          moderate: { dot: 'var(--amber-500)',  bg: 'var(--amber-50)', border: dark ? '#78350f' : '#fcd34d', text: 'var(--amber-600)' },
          low:      { dot: 'var(--green-600)',  bg: 'var(--green-50)', border: dark ? '#14532d' : '#86efac', text: dark ? '#4ade80' : 'var(--green-700)' },
        }[sev]

        const isOpen = expanded[exam.id]

        function eyeStr(zone, stage, plus) {
          if (!zone) return '-'
          const parts = [ZONE_LABELS[zone] || zone]
          if (stage) parts.push(STAGE_LABELS[stage] || stage)
          if (plus && plus !== 'none') parts.push(PLUS_LABELS[plus] || plus)
          return parts.join(' · ')
        }

        return (
          <div key={exam.id} className="timeline-item">
            <div className="timeline-dot-col">
              <div className={`timeline-dot sev-${sev}`} style={{ color: sevColors.dot }} />
              {idx < exams.length - 1 && <div className="timeline-line" />}
            </div>
            <div className="timeline-card" style={{ marginBottom: idx < exams.length - 1 ? 0 : 0 }}>
              <div className="timeline-card-header" style={{ background: sevColors.bg, borderBottomColor: sevColors.border }}>
                <div>
                  <div className="timeline-card-date">
                    {format(new Date(exam.exam_date + 'T00:00:00'), 'dd MMMM yyyy')}
                  </div>
                  <div style={{ fontSize: '.72rem', color: sevColors.text, marginTop: '.1rem', fontWeight: 600 }}>
                    Worst: {exam.worst_zone ? `${ZONE_LABELS[exam.worst_zone]} / ${STAGE_LABELS[exam.worst_stage] || '-'}` : 'No finding recorded'}
                    {exam.has_plus_disease === 'yes' && ' + Plus Disease'}
                  </div>
                  {hasVFData(exam) && (
                    <div style={{ fontSize: '.7rem', color: 'var(--teal-700)', marginTop: '.2rem', fontStyle: 'italic' }}>
                      👁 {vfSummaryLine(exam) || 'Visual function recorded'}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                  <button
                    onClick={() => handlePrintExam(exam)}
                    disabled={printing[exam.id]}
                    title="Export this visit as PDF"
                    style={{ background: 'none', border: `1px solid ${sevColors.border || sevColors.dot}`, cursor: 'pointer', fontSize: '.75rem', color: sevColors.text, fontWeight: 600, padding: '.2rem .55rem', borderRadius: 'var(--radius-sm)', transition: 'background .1s', opacity: printing[exam.id] ? 0.6 : 1 }}
                  >
                    {printing[exam.id] ? '…' : 'Print'}
                  </button>
                  <button
                    onClick={() => toggle(exam.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '.8rem', color: sevColors.text, fontWeight: 600, padding: '.25rem .5rem', borderRadius: 'var(--radius-sm)', transition: 'background .1s' }}
                  >
                    {isOpen ? 'Less ▲' : 'Details ▼'}
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="timeline-card-body">
                  {/* Eye findings */}
                  <div className="timeline-eye-row">
                    <div className="timeline-eye-box" style={{ borderTop: '3px solid #2563eb' }}>
                      <div className="timeline-eye-label">Right Eye (OD)</div>
                      <div className="timeline-eye-finding">{eyeStr(exam.right_zone, exam.right_stage, exam.right_plus)}</div>
                    </div>
                    <div className="timeline-eye-box" style={{ borderTop: '3px solid var(--green-600)' }}>
                      <div className="timeline-eye-label">Left Eye (OS)</div>
                      <div className="timeline-eye-finding">{eyeStr(exam.left_zone, exam.left_stage, exam.left_plus)}</div>
                    </div>
                  </div>

                  {/* Next appointment */}
                  {exam.next_exam_weeks && (
                    <div className="timeline-next">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, flexShrink: 0 }}>
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                      Next exam in {exam.next_exam_weeks} week{exam.next_exam_weeks > 1 ? 's' : ''}
                    </div>
                  )}

                  {/* Treatment */}
                  {exam.treatment_recommended && (
                    <div>
                      <span className="timeline-treatment">
                        ⚕ {TREATMENT_LABELS[exam.treatment_recommended] || exam.treatment_recommended}
                      </span>
                    </div>
                  )}

                  {/* Examiner notes */}
                  {exam.notes && (
                    <div style={{ fontSize: '.82rem', color: 'var(--gray-600)', lineHeight: 1.6, padding: '.5rem .75rem', background: 'var(--gray-50)', borderRadius: 'var(--radius-sm)' }}>
                      {exam.notes}
                    </div>
                  )}

                  {exam.postnatal_age_days && (
                    <div style={{ fontSize: '.75rem', color: 'var(--gray-400)' }}>
                      Postnatal age at exam: {exam.postnatal_age_days} days
                    </div>
                  )}

                  {/* Visual function detail */}
                  {hasVFData(exam) && (
                    <div style={{ marginTop: '.5rem', padding: '.6rem .75rem', background: 'var(--teal-50)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--teal-200)' }}>
                      <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--teal-700)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.4rem' }}>Visual Function</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.3rem .8rem', fontSize: '.75rem', color: 'var(--gray-700)' }}>
                        {exam.vf_right_fixation && <div><span style={{ color: 'var(--gray-400)', fontWeight: 600 }}>OD Fix:</span> {VF_FIXATION_LABELS[exam.vf_right_fixation]}</div>}
                        {exam.vf_left_fixation  && <div><span style={{ color: 'var(--gray-400)', fontWeight: 600 }}>OS Fix:</span> {VF_FIXATION_LABELS[exam.vf_left_fixation]}</div>}
                        {exam.vf_right_following && <div><span style={{ color: 'var(--gray-400)', fontWeight: 600 }}>OD Follow:</span> {VF_FOLLOWING_LABELS[exam.vf_right_following]}</div>}
                        {exam.vf_left_following  && <div><span style={{ color: 'var(--gray-400)', fontWeight: 600 }}>OS Follow:</span> {VF_FOLLOWING_LABELS[exam.vf_left_following]}</div>}
                        {exam.vf_right_csm && <div><span style={{ color: 'var(--gray-400)', fontWeight: 600 }}>OD CSM:</span> {VF_CSM_LABELS[exam.vf_right_csm]}</div>}
                        {exam.vf_left_csm  && <div><span style={{ color: 'var(--gray-400)', fontWeight: 600 }}>OS CSM:</span> {VF_CSM_LABELS[exam.vf_left_csm]}</div>}
                        {exam.vf_nystagmus && <div><span style={{ color: 'var(--gray-400)', fontWeight: 600 }}>Nystagmus:</span> {VF_NYSTAGMUS_LABELS[exam.vf_nystagmus]}</div>}
                        {exam.vf_strabismus && <div><span style={{ color: 'var(--gray-400)', fontWeight: 600 }}>Strabismus:</span> {VF_STRABISMUS_LABELS[exam.vf_strabismus]}</div>}
                      </div>
                      {exam.vf_functional_impression && (
                        <div style={{ marginTop: '.35rem', fontSize: '.75rem', fontWeight: 600, color: 'var(--teal-700)' }}>
                          Impression: {VF_IMPRESSION_LABELS[exam.vf_functional_impression]}
                        </div>
                      )}
                      {exam.vf_notes && (
                        <div style={{ marginTop: '.3rem', fontSize: '.73rem', color: 'var(--gray-600)', fontStyle: 'italic' }}>{exam.vf_notes}</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Phone call log form ───────────────────────────────────────────────────────
function CallLogPanel({ babyId, onClose, onSaved }) {
  const [outcome, setOutcome] = useState('not_reached')
  const [notes, setNotes] = useState('')
  const qc = useQueryClient()
  const dark = useTheme().resolved === 'dark'
  const blueText = dark ? '#93c5fd' : '#1d4ed8'

  const mutation = useMutation({
    mutationFn: () => logPhoneCall(babyId, outcome, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders', babyId] })
      setNotes('')
      onSaved()
    },
  })

  return (
    <div className="call-log-panel">
      <div style={{ fontSize: '.78rem', fontWeight: 700, color: blueText, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '.75rem' }}>
        Log Phone Call
      </div>
      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem', flexWrap: 'wrap' }}>
        {[
          { value: 'reached',     label: '✓ Reached caregiver' },
          { value: 'not_reached', label: '✗ No answer' },
          { value: 'voicemail',   label: '◌ Left voicemail' },
        ].map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setOutcome(opt.value)}
            style={{
              padding: '.4rem .9rem', borderRadius: 999, fontSize: '.8rem', fontWeight: 600,
              cursor: 'pointer', transition: 'all .15s',
              background: outcome === opt.value ? '#1d4ed8' : 'var(--surface)',
              color: outcome === opt.value ? '#ffffff' : blueText,
              border: `1.5px solid ${outcome === opt.value ? '#1d4ed8' : (dark ? '#1e3a5f' : '#bfdbfe')}`,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="form-group" style={{ marginBottom: '.75rem' }}>
        <textarea
          rows={2}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Optional notes about the call…"
          style={{ resize: 'vertical', fontSize: '.85rem' }}
        />
      </div>
      {mutation.error && (
        <div className="alert alert-error" style={{ marginBottom: '.5rem', padding: '.5rem .75rem', fontSize: '.8rem' }}>
          {mutation.error.response?.data?.detail || 'Failed to log call.'}
        </div>
      )}
      <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Saving…' : 'Log Call'}
        </button>
      </div>
    </div>
  )
}

// ── Outcome labels ────────────────────────────────────────────────────────────
const TREATMENT_TYPE_LABELS = {
  none: 'None / Observation only',
  laser: 'Laser Photocoagulation',
  anti_vegf: 'Anti-VEGF Injection',
  surgery: 'Vitreoretinal Surgery',
  combination: 'Combination Therapy',
}
const TREATMENT_EYE_LABELS = { right: 'Right Eye', left: 'Left Eye', both: 'Both Eyes' }
const VISUAL_OUTCOME_LABELS = {
  good_vision: 'Good Vision',
  mild_impairment: 'Mild Impairment',
  severe_impairment: 'Severe Impairment',
  blind: 'Blind',
  too_young: 'Too Young to Assess',
  ltfu_before_outcome: 'LTFU Before Assessment',
}
const DISCHARGE_STATUS_LABELS = {
  completed_no_rop: 'Completed - No ROP',
  completed_treated: 'Completed - Treated Successfully',
  referred_national: 'Referred Nationally',
  referred_abroad: 'Referred Abroad',
  died: 'Died',
  lost: 'Lost to Follow-Up',
  ongoing: 'Ongoing / Active',
}
const REFERRAL_REASON_LABELS = {
  laser_not_available: 'Laser not available here',
  surgery_needed: 'Surgery needed',
  second_opinion: 'Second opinion',
  other: 'Other',
}
const REFERRAL_STATUS_LABELS = {
  pending: 'Pending',
  arrived_treated: 'Arrived & Treated',
  did_not_arrive: 'Did Not Arrive',
  unknown: 'Unknown',
}
const REFERRAL_STATUS_COLORS = {
  pending:         { bg: '#fef3c7', color: '#92400e' },
  arrived_treated: { bg: 'var(--green-100)', color: 'var(--green-700)' },
  did_not_arrive:  { bg: 'var(--red-100)', color: 'var(--red-700)' },
  unknown:         { bg: 'var(--gray-100)', color: 'var(--gray-500)' },
}

// ── Visual Function Tab ───────────────────────────────────────────────────────
function VisualFunctionTab({ exams }) {
  const vfExams = [...exams].filter(hasVFData).sort((a, b) => new Date(a.exam_date) - new Date(b.exam_date))

  if (vfExams.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <div style={{ fontSize: '2rem', marginBottom: '.75rem' }}>👁</div>
        <p style={{ color: 'var(--gray-500)', fontSize: '.9rem', fontWeight: 600 }}>No visual function data recorded yet.</p>
        <p style={{ color: 'var(--gray-400)', fontSize: '.82rem', marginTop: '.3rem' }}>
          When recording an exam, expand the "Visual Function Assessment" section to add data.
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Trajectory table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.375rem', borderBottom: '1px solid var(--gray-100)' }}>
          <div style={{ fontSize: '.68rem', fontWeight: 700, color: 'var(--teal-600)', textTransform: 'uppercase', letterSpacing: '.09em', marginBottom: '.2rem' }}>
            Visual Function Trajectory
          </div>
          <p style={{ fontSize: '.83rem', color: 'var(--gray-500)' }}>
            {vfExams.length} exam{vfExams.length > 1 ? 's' : ''} with visual function data · chronological order
          </p>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' }}>
            <thead>
              <tr style={{ background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)' }}>
                <th style={{ padding: '.6rem .9rem', textAlign: 'left', fontWeight: 700, color: 'var(--gray-500)', fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>Date</th>
                <th style={{ padding: '.6rem .9rem', textAlign: 'left', fontWeight: 700, color: '#2563eb', fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>OD Fix</th>
                <th style={{ padding: '.6rem .9rem', textAlign: 'left', fontWeight: 700, color: '#2563eb', fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>OD Follow</th>
                <th style={{ padding: '.6rem .9rem', textAlign: 'left', fontWeight: 700, color: '#2563eb', fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>OD CSM</th>
                <th style={{ padding: '.6rem .9rem', textAlign: 'left', fontWeight: 700, color: '#16a34a', fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>OS Fix</th>
                <th style={{ padding: '.6rem .9rem', textAlign: 'left', fontWeight: 700, color: '#16a34a', fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>OS Follow</th>
                <th style={{ padding: '.6rem .9rem', textAlign: 'left', fontWeight: 700, color: '#16a34a', fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>OS CSM</th>
                <th style={{ padding: '.6rem .9rem', textAlign: 'left', fontWeight: 700, color: 'var(--gray-500)', fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>Impression</th>
              </tr>
            </thead>
            <tbody>
              {vfExams.map((exam, idx) => (
                <tr key={exam.id} style={{ borderBottom: '1px solid var(--gray-100)', background: idx % 2 === 0 ? 'var(--surface)' : 'var(--gray-50)' }}>
                  <td style={{ padding: '.55rem .9rem', fontWeight: 700, color: 'var(--gray-800)', whiteSpace: 'nowrap' }}>
                    {format(new Date(exam.exam_date + 'T00:00:00'), 'dd MMM yyyy')}
                  </td>
                  <td style={{ padding: '.55rem .9rem', color: 'var(--gray-700)' }}>{VF_FIXATION_LABELS[exam.vf_right_fixation] || '-'}</td>
                  <td style={{ padding: '.55rem .9rem', color: 'var(--gray-700)' }}>{VF_FOLLOWING_LABELS[exam.vf_right_following] || '-'}</td>
                  <td style={{ padding: '.55rem .9rem', color: 'var(--gray-700)' }}>{VF_CSM_LABELS[exam.vf_right_csm] || '-'}</td>
                  <td style={{ padding: '.55rem .9rem', color: 'var(--gray-700)' }}>{VF_FIXATION_LABELS[exam.vf_left_fixation] || '-'}</td>
                  <td style={{ padding: '.55rem .9rem', color: 'var(--gray-700)' }}>{VF_FOLLOWING_LABELS[exam.vf_left_following] || '-'}</td>
                  <td style={{ padding: '.55rem .9rem', color: 'var(--gray-700)' }}>{VF_CSM_LABELS[exam.vf_left_csm] || '-'}</td>
                  <td style={{ padding: '.55rem .9rem', color: 'var(--teal-700)', fontWeight: 600, fontSize: '.75rem' }}>
                    {VF_IMPRESSION_LABELS[exam.vf_functional_impression] || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Nystagmus / strabismus summary */}
      {vfExams.some(e => e.vf_nystagmus || e.vf_strabismus) && (
        <div className="card">
          <div style={{ fontSize: '.68rem', fontWeight: 700, color: 'var(--teal-600)', textTransform: 'uppercase', letterSpacing: '.09em', marginBottom: '.75rem' }}>
            Binocular Findings History
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
            {vfExams.filter(e => e.vf_nystagmus || e.vf_strabismus).map(exam => (
              <div key={exam.id} style={{ display: 'flex', gap: '1rem', fontSize: '.82rem', padding: '.4rem 0', borderBottom: '1px solid var(--gray-100)', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: 'var(--gray-700)', minWidth: 100 }}>
                  {format(new Date(exam.exam_date + 'T00:00:00'), 'dd MMM yyyy')}
                </span>
                {exam.vf_nystagmus && (
                  <span style={{ color: 'var(--gray-600)' }}>Nystagmus: <strong>{VF_NYSTAGMUS_LABELS[exam.vf_nystagmus]}</strong></span>
                )}
                {exam.vf_strabismus && (
                  <span style={{ color: 'var(--gray-600)' }}>Strabismus: <strong>{VF_STRABISMUS_LABELS[exam.vf_strabismus]}</strong></span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Clinical Outcome section ──────────────────────────────────────────────────
function OutcomeSection({ babyId, canEdit }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)

  const { data: outcome } = useQuery({
    queryKey: ['outcome', babyId],
    queryFn: () => getOutcome(babyId),
  })

  const { data: hospitals = [] } = useQuery({ queryKey: ['hospitals'], queryFn: listHospitals })

  const mutation = useMutation({
    mutationFn: (data) => upsertOutcome(babyId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outcome', babyId] })
      qc.invalidateQueries({ queryKey: ['baby', babyId] })
      setEditing(false)
    },
  })

  const startEdit = () => {
    setForm({
      treatment_type: outcome?.treatment_type || '',
      treatment_eye: outcome?.treatment_eye || '',
      treatment_date: outcome?.treatment_date || '',
      treatment_hospital_id: outcome?.treatment_hospital_id || '',
      treating_ophthalmologist: outcome?.treating_ophthalmologist || '',
      visual_outcome: outcome?.visual_outcome || '',
      discharge_status: outcome?.discharge_status || '',
      discharge_date: outcome?.discharge_date || '',
      notes: outcome?.notes || '',
    })
    setEditing(true)
  }

  const field = (k) => ({ value: form[k], onChange: e => setForm(p => ({ ...p, [k]: e.target.value })) })

  const handleSave = () => {
    const payload = { ...form }
    Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null })
    mutation.mutate(payload)
  }

  if (editing && form) {
    return (
      <div className="card">
        <SectionHeading>Clinical Outcome</SectionHeading>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          <div className="form-group">
            <label className="form-label">Treatment Type</label>
            <select className="form-control" {...field('treatment_type')}>
              <option value="">(select)</option>
              {Object.entries(TREATMENT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
            <div className="form-group">
              <label className="form-label">Eye Treated</label>
              <select className="form-control" {...field('treatment_eye')}>
                <option value="">(select)</option>
                {Object.entries(TREATMENT_EYE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Treatment Date</label>
              <input type="date" className="form-control" {...field('treatment_date')} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Treatment Hospital</label>
            <select className="form-control" {...field('treatment_hospital_id')}>
              <option value="">(same hospital)</option>
              {hospitals.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Treating Ophthalmologist</label>
            <input type="text" className="form-control" placeholder="Dr. Name" {...field('treating_ophthalmologist')} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
            <div className="form-group">
              <label className="form-label">Visual Outcome</label>
              <select className="form-control" {...field('visual_outcome')}>
                <option value="">(select)</option>
                {Object.entries(VISUAL_OUTCOME_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Discharge Status</label>
              <select className="form-control" {...field('discharge_status')}>
                <option value="">(select)</option>
                {Object.entries(DISCHARGE_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Discharge Date</label>
            <input type="date" className="form-control" {...field('discharge_date')} />
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-control" rows={2} style={{ resize: 'vertical' }} {...field('notes')} />
          </div>
          {mutation.error && (
            <div className="alert alert-error" style={{ fontSize: '.8rem', padding: '.5rem .75rem' }}>
              {mutation.error.response?.data?.detail || 'Failed to save.'}
            </div>
          )}
          <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save Outcome'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.75rem' }}>
        <SectionHeading>Clinical Outcome</SectionHeading>
        {canEdit && (
          <button className="btn btn-secondary btn-sm" style={{ marginTop: '-.15rem' }} onClick={startEdit}>
            {outcome ? 'Edit' : '+ Add'}
          </button>
        )}
      </div>
      {outcome ? (
        <>
          <InfoRow label="Treatment" value={TREATMENT_TYPE_LABELS[outcome.treatment_type] || '-'} />
          {outcome.treatment_type && outcome.treatment_type !== 'none' && (
            <>
              <InfoRow label="Eye" value={TREATMENT_EYE_LABELS[outcome.treatment_eye] || '-'} />
              <InfoRow label="Treat. Date" value={outcome.treatment_date ? format(new Date(outcome.treatment_date + 'T00:00:00'), 'dd MMM yyyy') : '-'} />
              {outcome.treatment_hospital_name && <InfoRow label="Treat. Hospital" value={outcome.treatment_hospital_name} />}
              {outcome.treating_ophthalmologist && <InfoRow label="Ophthalmologist" value={outcome.treating_ophthalmologist} />}
            </>
          )}
          <InfoRow label="Visual Outcome" value={VISUAL_OUTCOME_LABELS[outcome.visual_outcome] || '-'} />
          <InfoRow label="Discharge" value={DISCHARGE_STATUS_LABELS[outcome.discharge_status] || '-'} />
          {outcome.discharge_date && <InfoRow label="Discharge Date" value={format(new Date(outcome.discharge_date + 'T00:00:00'), 'dd MMM yyyy')} />}
          {outcome.notes && (
            <p style={{ fontSize: '.82rem', color: 'var(--gray-600)', marginTop: '.5rem', lineHeight: 1.6 }}>{outcome.notes}</p>
          )}
        </>
      ) : (
        <p style={{ fontSize: '.83rem', color: 'var(--gray-400)', textAlign: 'center', padding: '.75rem 0' }}>
          No outcome recorded yet.{canEdit && ' Click "+ Add" to record.'}
        </p>
      )}
    </div>
  )
}

// ── Referral section ──────────────────────────────────────────────────────────
function ReferralSection({ babyId, babyHospitalId, canEdit }) {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ to_hospital_id: '', to_external: false, reason: 'laser_not_available', referral_date: new Date().toISOString().slice(0, 10), notes: '' })
  const [updatingId, setUpdatingId] = useState(null)

  const { data: referrals = [] } = useQuery({
    queryKey: ['referrals', babyId],
    queryFn: () => listReferrals(babyId),
  })
  const { data: hospitals = [] } = useQuery({ queryKey: ['hospitals'], queryFn: listHospitals })

  const createMut = useMutation({
    mutationFn: (data) => createReferral(babyId, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['referrals', babyId] }); setShowForm(false) },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => updateReferralStatus(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['referrals', babyId] }),
  })

  const handleCreate = () => {
    const payload = { ...form, to_external: !!form.to_external }
    if (!payload.to_external && !payload.to_hospital_id) { payload.to_hospital_id = null }
    if (!payload.to_hospital_id) delete payload.to_hospital_id
    createMut.mutate(payload)
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.75rem' }}>
        <SectionHeading>Referrals {referrals.length > 0 && `(${referrals.length})`}</SectionHeading>
        {canEdit && (
          <button className="btn btn-secondary btn-sm" style={{ marginTop: '-.15rem' }} onClick={() => setShowForm(p => !p)}>
            {showForm ? 'Cancel' : '+ Refer'}
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--gray-50)', borderRadius: 'var(--radius)', border: '1px solid var(--gray-200)', display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Reason</label>
            <select className="form-control" value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}>
              {Object.entries(REFERRAL_REASON_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
            <input type="checkbox" id="toExternal" checked={form.to_external} onChange={e => setForm(p => ({ ...p, to_external: e.target.checked, to_hospital_id: '' }))} />
            <label htmlFor="toExternal" style={{ fontSize: '.83rem', fontWeight: 600, color: 'var(--gray-700)', cursor: 'pointer' }}>External / Abroad</label>
          </div>
          {!form.to_external && (
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Referring To</label>
              <select className="form-control" value={form.to_hospital_id} onChange={e => setForm(p => ({ ...p, to_hospital_id: e.target.value }))}>
                <option value="">(select hospital)</option>
                {hospitals.filter(h => h.id !== babyHospitalId).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
          )}
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Referral Date</label>
            <input type="date" className="form-control" value={form.referral_date} onChange={e => setForm(p => ({ ...p, referral_date: e.target.value }))} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Notes</label>
            <textarea className="form-control" rows={2} style={{ resize: 'vertical' }} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
          {createMut.error && (
            <div className="alert alert-error" style={{ fontSize: '.8rem', padding: '.4rem .65rem' }}>
              {createMut.error.response?.data?.detail || 'Failed to create referral.'}
            </div>
          )}
          <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={handleCreate} disabled={createMut.isPending}>
              {createMut.isPending ? 'Saving…' : 'Create Referral'}
            </button>
          </div>
        </div>
      )}

      {referrals.length === 0 && !showForm && (
        <p style={{ fontSize: '.83rem', color: 'var(--gray-400)', textAlign: 'center', padding: '.5rem 0' }}>No referrals recorded.</p>
      )}

      {referrals.map(ref => {
        const sc = REFERRAL_STATUS_COLORS[ref.status] || REFERRAL_STATUS_COLORS.unknown
        const isUpdating = updatingId === ref.id
        return (
          <div key={ref.id} style={{ borderRadius: 'var(--radius-sm)', border: '1px solid var(--gray-200)', padding: '.7rem .9rem', marginBottom: '.6rem', background: 'var(--surface)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.5rem', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '.84rem', color: 'var(--gray-900)' }}>
                  {REFERRAL_REASON_LABELS[ref.reason] || ref.reason}
                </div>
                <div style={{ fontSize: '.75rem', color: 'var(--gray-500)', marginTop: '.15rem' }}>
                  {format(new Date(ref.referral_date + 'T00:00:00'), 'dd MMM yyyy')}
                  {ref.to_hospital_name && ` → ${ref.to_hospital_name}`}
                </div>
                {ref.notes && <div style={{ fontSize: '.75rem', color: 'var(--gray-600)', marginTop: '.25rem' }}>{ref.notes}</div>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '.35rem' }}>
                <span style={{ padding: '.15rem .55rem', borderRadius: 999, fontSize: '.7rem', fontWeight: 700, background: sc.bg, color: sc.color }}>
                  {REFERRAL_STATUS_LABELS[ref.status] || ref.status}
                </span>
                {canEdit && !isUpdating && (
                  <select
                    style={{ fontSize: '.72rem', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', padding: '.15rem .3rem', cursor: 'pointer', color: 'var(--gray-600)' }}
                    value={ref.status}
                    onChange={e => {
                      setUpdatingId(ref.id)
                      updateMut.mutate({ id: ref.id, data: { status: e.target.value } }, { onSettled: () => setUpdatingId(null) })
                    }}
                  >
                    {Object.entries(REFERRAL_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                )}
                {isUpdating && <span style={{ fontSize: '.72rem', color: 'var(--gray-400)' }}>Updating…</span>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Next review date card (editable) ──────────────────────────────────────────
function NextReviewCard({ babyId, canEdit }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [reasonSelect, setReasonSelect] = useState('')
  const [reasonOther, setReasonOther] = useState('')
  const [confirmedLong, setConfirmedLong] = useState(false)

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ['appointments', babyId],
    queryFn: () => listAppointments(babyId),
    enabled: !!babyId,
  })
  const scheduled = appointments.find(a => a.status === 'scheduled')

  const reason = resolveReason(reasonSelect, reasonOther)
  const { error: dateError, warning: dateWarning } = validateReviewDate(newDate)

  const startEdit = () => {
    setNewDate(scheduled?.due_date || '')
    setReasonSelect('')
    setReasonOther('')
    setConfirmedLong(false)
    setEditing(true)
  }

  const mutation = useMutation({
    mutationFn: () => rescheduleAppointment(scheduled.id, newDate, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments', babyId] })
      qc.invalidateQueries({ queryKey: ['contact-logs', babyId] })
      qc.invalidateQueries({ queryKey: ['baby', babyId] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setEditing(false)
    },
  })

  const canSave = newDate && reason && !dateError && (!dateWarning || confirmedLong) && !mutation.isPending

  if (editing && scheduled) {
    return (
      <div className="card">
        <SectionHeading>Next Review Date</SectionHeading>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.7rem' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">New Review Date</label>
            <input
              type="date"
              className="form-control"
              value={newDate}
              onChange={e => { setNewDate(e.target.value); setConfirmedLong(false) }}
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Reason *</label>
            <select className="form-control" value={reasonSelect} onChange={e => setReasonSelect(e.target.value)}>
              <option value="">Select a reason...</option>
              {REVIEW_DATE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {reasonSelect === 'Other' && (
              <input
                type="text"
                className="form-control"
                style={{ marginTop: '.4rem' }}
                placeholder="Please specify the reason"
                value={reasonOther}
                onChange={e => setReasonOther(e.target.value)}
              />
            )}
          </div>
          {dateError && (
            <div className="alert alert-error" style={{ fontSize: '.8rem', padding: '.4rem .65rem' }}>
              {dateError}
            </div>
          )}
          {!dateError && dateWarning && (
            <div style={{ fontSize: '.8rem', padding: '.5rem .65rem', borderRadius: 'var(--radius-sm)', background: 'var(--amber-50)', border: '1px solid var(--amber-500)', color: 'var(--amber-700, #b45309)' }}>
              <div style={{ marginBottom: '.4rem' }}>{dateWarning}</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontWeight: 600, cursor: 'pointer' }}>
                <input type="checkbox" checked={confirmedLong} onChange={e => setConfirmedLong(e.target.checked)} />
                Yes, use this date
              </label>
            </div>
          )}
          {mutation.error && (
            <div className="alert alert-error" style={{ fontSize: '.8rem', padding: '.4rem .65rem' }}>
              {mutation.error.response?.data?.detail || 'Failed to save review date.'}
            </div>
          )}
          <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)} disabled={mutation.isPending}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={() => mutation.mutate()} disabled={!canSave}>
              {mutation.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.75rem' }}>
        <SectionHeading>Next Review Date</SectionHeading>
        {canEdit && scheduled && (
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginTop: '-.15rem' }}
            onClick={startEdit}
            title="Edit review date"
          >
            ✎ Edit
          </button>
        )}
      </div>
      {isLoading ? (
        <p style={{ fontSize: '.83rem', color: 'var(--gray-400)' }}>Loading...</p>
      ) : scheduled ? (
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--gray-900)' }}>
            {format(new Date(scheduled.due_date + 'T00:00:00'), 'dd MMMM yyyy')}
          </div>
          <div style={{ fontSize: '.75rem', color: 'var(--gray-400)', marginTop: '.2rem' }}>
            {scheduled.date_source === 'manual' ? 'Manually set' : 'Auto-scheduled'}
            {scheduled.date_source === 'manual' && scheduled.date_change_reason ? `: ${scheduled.date_change_reason}` : ''}
          </div>
        </div>
      ) : (
        <p style={{ fontSize: '.83rem', color: 'var(--gray-400)', textAlign: 'center', padding: '.5rem 0' }}>
          No upcoming review scheduled.
        </p>
      )}
    </div>
  )
}

// ── Caregiver & Contact edit card ─────────────────────────────────────────────
function CaregiverCard({ baby, canEdit }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)

  const startEdit = () => {
    setForm({
      caregiver_name: baby.full_name || baby.caregiver_name || '',
      mtn_phone:      baby.mtn_phone      || '',
      airtel_phone:   baby.airtel_phone   || '',
      language_preference: baby.language_preference || 'english',
      notes: baby.notes || '',
    })
    setEditing(true)
  }

  const mutation = useMutation({
    mutationFn: (data) => updateBaby(baby.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['baby', String(baby.id)] })
      qc.invalidateQueries({ queryKey: ['contact-logs', String(baby.id)] })
      setEditing(false)
    },
  })

  const handleSave = () => {
    const payload = { ...form, full_name: form.caregiver_name }
    if (!payload.mtn_phone)    payload.mtn_phone    = null
    if (!payload.airtel_phone) payload.airtel_phone = null
    if (!payload.notes)        payload.notes        = null
    mutation.mutate(payload)
  }

  const f = (k) => ({ value: form[k], onChange: e => setForm(p => ({ ...p, [k]: e.target.value })) })
  const phone = baby.mtn_phone || baby.airtel_phone

  if (editing && form) {
    return (
      <div className="card">
        <SectionHeading>Caregiver &amp; Contact</SectionHeading>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.7rem' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Mother / Caregiver Name</label>
            <input type="text" className="form-control" placeholder="e.g. Nakamya Sarah" {...f('caregiver_name')} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">MTN Phone</label>
              <input type="tel" className="form-control" placeholder="+256 77..." {...f('mtn_phone')} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Airtel Phone</label>
              <input type="tel" className="form-control" placeholder="+256 75..." {...f('airtel_phone')} />
            </div>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Language Preference</label>
            <select className="form-control" {...f('language_preference')}>
              <option value="english">English</option>
              <option value="luganda">Luganda</option>
              <option value="runyankole">Runyankole</option>
              <option value="acholi">Acholi</option>
              <option value="ateso">Ateso</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Notes <span style={{ fontWeight: 400, color: 'var(--gray-400)' }}>(optional)</span></label>
            <textarea className="form-control" rows={2} style={{ resize: 'vertical' }} placeholder="Any relevant context about this baby or caregiver..." {...f('notes')} />
          </div>
          {mutation.error && (
            <div className="alert alert-error" style={{ fontSize: '.8rem', padding: '.4rem .65rem' }}>
              {mutation.error.response?.data?.detail || 'Failed to save changes.'}
            </div>
          )}
          <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)} disabled={mutation.isPending}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={mutation.isPending || !form.caregiver_name.trim()}>
              {mutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.75rem' }}>
        <SectionHeading>Caregiver &amp; Contact</SectionHeading>
        {canEdit && (
          <button className="btn btn-secondary btn-sm" style={{ marginTop: '-.15rem' }} onClick={startEdit}>
            Edit
          </button>
        )}
      </div>
      <InfoRow label="Mother / Caregiver Name" value={baby.full_name || baby.caregiver_name} />
      <InfoRow label="MTN"      value={baby.mtn_phone} />
      <InfoRow label="Airtel"   value={baby.airtel_phone} />
      <InfoRow label="Language" value={LANG_MAP[baby.language_preference] || baby.language_preference} />
      {baby.notes && (
        <p style={{ fontSize: '.85rem', color: 'var(--gray-600)', lineHeight: 1.6, marginTop: '.6rem', paddingTop: '.6rem', borderTop: '1px solid var(--gray-100)' }}>
          {baby.notes}
        </p>
      )}
      {phone && (
        <div style={{ marginTop: '.75rem', display: 'flex', gap: '.5rem' }}>
          <a href={`tel:${phone}`} className="btn btn-secondary btn-sm" style={{ flex: 1, justifyContent: 'center' }}>
            Call
          </a>
          <a
            href={`https://wa.me/${phone.replace(/\D/g, '')}`}
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary btn-sm"
            style={{ flex: 1, justifyContent: 'center' }}
          >
            WhatsApp
          </a>
        </div>
      )}
    </div>
  )
}

// ── Discharge modal ───────────────────────────────────────────────────────────
const DISCHARGE_REASONS = [
  { value: 'completed_no_rop',  label: 'Completed - no ROP detected' },
  { value: 'completed_treated', label: 'Completed - treated successfully' },
  { value: 'referred_national', label: 'Referred to national centre' },
  { value: 'referred_abroad',   label: 'Referred abroad' },
  { value: 'died',              label: 'Died' },
  { value: 'lost',              label: 'Lost to follow-up' },
]

function DischargeModal({ babyId, babyName, onClose, onDischarged }) {
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')

  const mutation = useMutation({
    mutationFn: () => dischargeBaby(babyId, reason, notes || undefined),
    onSuccess: (updated) => { onDischarged(updated) },
  })

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
      zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
    }}>
      <div style={{
        background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-xl)',
        width: '100%', maxWidth: 460, padding: '1.5rem',
      }}>
        <h3 style={{ margin: '0 0 .25rem', fontSize: '1.1rem', fontWeight: 700, color: 'var(--gray-900)' }}>
          Discharge {babyName}
        </h3>
        <p style={{ margin: '0 0 1.25rem', fontSize: '.85rem', color: 'var(--gray-500)' }}>
          This will stop all future SMS reminders and mark the baby as discharged.
          You can reactivate later if needed.
        </p>

        <div className="form-group" style={{ marginBottom: '.85rem' }}>
          <label className="form-label">Reason for discharge *</label>
          <select
            className="form-control"
            value={reason}
            onChange={e => setReason(e.target.value)}
          >
            <option value="">-- Select a reason --</option>
            {DISCHARGE_REASONS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        <div className="form-group" style={{ marginBottom: '1.25rem' }}>
          <label className="form-label">Notes (optional)</label>
          <textarea
            className="form-control"
            rows={2}
            style={{ resize: 'vertical', fontSize: '.85rem' }}
            placeholder="Any additional context..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        {mutation.isError && (
          <div className="alert alert-error" style={{ marginBottom: '.75rem', padding: '.5rem .75rem', fontSize: '.82rem' }}>
            {mutation.error?.response?.data?.detail || 'Failed to discharge baby.'}
          </div>
        )}

        <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            style={{ background: 'var(--red-600,#dc2626)', borderColor: 'var(--red-600,#dc2626)' }}
            disabled={!reason || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Discharging…' : 'Confirm Discharge'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Dilation panel (nurses + coordinators) ────────────────────────────────────
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

function DilationPanel({ babyId, baby, canEdit }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)

  const dilate = useMutation({
    mutationFn: (val) => updateDilation(babyId, val),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['baby', babyId] })
      qc.invalidateQueries({ queryKey: ['contact-logs', babyId] })
      setEditing(false)
    },
  })

  const ds = baby.dilation_status
  const style = DILATION_STYLE[ds] || {}

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.5rem' }}>
        <SectionHeading>Dilation Status</SectionHeading>
        {canEdit && (
          <button className="btn btn-ghost btn-sm" style={{ marginTop: '-.15rem' }} onClick={() => setEditing(p => !p)}>
            {editing ? 'Cancel' : 'Update'}
          </button>
        )}
      </div>

      {ds ? (
        <div style={{
          display: 'inline-block', padding: '.25rem .75rem', borderRadius: 999,
          background: style.bg, color: style.color, fontWeight: 700, fontSize: '.82rem',
        }}>
          {style.label}
        </div>
      ) : (
        <p style={{ fontSize: '.82rem', color: 'var(--gray-400)', fontStyle: 'italic' }}>Not yet recorded</p>
      )}

      {baby.dilation_updated_at && (
        <div style={{ fontSize: '.72rem', color: 'var(--gray-400)', marginTop: '.35rem' }}>
          Updated {formatDistanceToNow(new Date(baby.dilation_updated_at), { addSuffix: true })}
        </div>
      )}

      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', marginTop: '.75rem' }}>
          {DILATION_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className={`btn btn-sm ${ds === opt.value ? 'btn-primary' : 'btn-secondary'}`}
              style={{ justifyContent: 'flex-start' }}
              disabled={dilate.isPending}
              onClick={() => dilate.mutate(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Unified contact log (reminders + contact_logs merged) ─────────────────────
function UnifiedContactLog({ babyId, reminders, canAddNote, canRetry, onCallClick }) {
  const qc = useQueryClient()
  const dark = useTheme().resolved === 'dark'
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [showMsg, setShowMsg] = useState({})
  const [showError, setShowError] = useState({})
  const [retryingId, setRetryingId] = useState(null)

  async function handleRetry(reminderId) {
    setRetryingId(reminderId)
    try {
      await retrySMS(reminderId)
      qc.invalidateQueries({ queryKey: ['reminders', babyId] })
    } catch (_) {}
    setRetryingId(null)
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const recentFailCount = reminders.filter(
    r => r.status === 'failed' && new Date(r.created_at) >= sevenDaysAgo
  ).length

  const { data: contactLogs = [] } = useQuery({
    queryKey: ['contact-logs', babyId],
    queryFn: () => getContactLogs(babyId),
    enabled: !!babyId,
  })

  const addNote = useMutation({
    mutationFn: () => addContactNote(babyId, noteText),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact-logs', babyId] })
      setNoteText('')
      setShowNoteForm(false)
    },
  })

  // Build unified timeline: reminders + contact_log entries, sorted desc by date
  const reminderItems = reminders.map(r => ({
    key: `r-${r.id}`,
    date: new Date(r.sent_at || r.created_at),
    type: 'reminder',
    data: r,
  }))
  const logItems = contactLogs.map(l => ({
    key: `l-${l.id}`,
    date: new Date(l.created_at),
    type: 'log',
    data: l,
  }))
  const all = [...reminderItems, ...logItems].sort((a, b) => b.date - a.date)

  const LOG_TYPE_STYLE = {
    sms:               { icon: '✉', bg: 'var(--teal-50)', color: 'var(--teal-600)', label: 'Auto-SMS' },
    phone_call:        { icon: '☎', bg: dark ? '#15233f' : '#eff6ff', color: dark ? '#93c5fd' : '#1d4ed8', label: 'Phone Call' },
    caregiver_edit:    { icon: '✎', bg: dark ? '#3b2800' : '#fef3c7', color: dark ? '#fcd34d' : '#92400e', label: 'Edit' },
    screening_request: { icon: '🔬', bg: dark ? '#241f3f' : '#f5f3ff', color: dark ? '#c4b5fd' : '#7c3aed', label: 'Screening' },
    note:              { icon: '✎', bg: 'var(--gray-100)', color: 'var(--gray-600)', label: 'Note' },
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.375rem', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <SectionHeading>Contact Activity</SectionHeading>
          <div style={{ fontSize: '.9rem', fontWeight: 700, color: 'var(--gray-900)', marginTop: '-.3rem' }}>
            All reminders, calls &amp; edits
          </div>
          {recentFailCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', marginTop: '.3rem', fontSize: '.78rem', color: dark ? '#fcd34d' : '#92400E' }}>
              <span>⚠</span>
              <span>
                {recentFailCount} SMS failed recently:{' '}
                {onCallClick
                  ? <button onClick={onCallClick} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dark ? '#93c5fd' : '#2563EB', fontWeight: 600, padding: 0, fontSize: 'inherit', textDecoration: 'underline' }}>call the parent directly</button>
                  : 'consider calling the parent directly'
                }
              </span>
            </div>
          )}
        </div>
        {canAddNote && (
          <button className="btn btn-secondary btn-sm" onClick={() => setShowNoteForm(p => !p)}>
            {showNoteForm ? 'Cancel' : '+ Note'}
          </button>
        )}
      </div>

      {showNoteForm && (
        <div style={{ padding: '1rem 1.375rem', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)' }}>
          <textarea
            className="form-input"
            rows={2}
            placeholder="Add a note..."
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            style={{ fontSize: '.85rem', marginBottom: '.5rem' }}
          />
          <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowNoteForm(false)}>Cancel</button>
            <button
              className="btn btn-primary btn-sm"
              disabled={!noteText.trim() || addNote.isPending}
              onClick={() => addNote.mutate()}
            >
              Save Note
            </button>
          </div>
        </div>
      )}

      <div style={{ padding: '0 1.375rem' }}>
        {all.length === 0 ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--gray-400)', fontSize: '.875rem' }}>
            No contact activity yet.
          </div>
        ) : all.map(item => {
          if (item.type === 'reminder') {
            const r = item.data
            const meta = TRIGGER_META[r.trigger] || { label: r.trigger, icon: '?', cls: 'sms' }
            const st = STATUS_STYLE[r.status] || STATUS_STYLE.pending
            return (
              <div key={item.key} className="reminder-row">
                <div className={`reminder-icon ${meta.cls}`} style={{ fontSize: '1rem' }}>{meta.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.2rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '.85rem', color: 'var(--gray-800)' }}>{meta.label}</span>
                    <span style={{ padding: '.1rem .5rem', borderRadius: 999, fontSize: '.7rem', fontWeight: 700, background: st.bg, color: st.color }}>{st.label}</span>
                    {r.recipient_phone && <span style={{ fontSize: '.72rem', color: 'var(--gray-400)', fontFamily: 'var(--font-mono)' }}>{r.recipient_phone}</span>}
                  </div>
                  <div style={{ fontSize: '.75rem', color: 'var(--gray-400)' }}>
                    {format(item.date, 'dd MMM yyyy, HH:mm')} · {formatDistanceToNow(item.date, { addSuffix: true })}
                  </div>
                  {r.message_body && (
                    <>
                      {showMsg[item.key] && (
                        <div style={{ marginTop: '.4rem', fontSize: '.78rem', color: 'var(--gray-600)', lineHeight: 1.6, padding: '.5rem .6rem', background: 'var(--gray-50)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--gray-200)' }}>
                          {r.message_body}
                        </div>
                      )}
                      <button
                        onClick={() => setShowMsg(p => ({ ...p, [item.key]: !p[item.key] }))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '.72rem', color: 'var(--teal-600)', fontWeight: 600, padding: '.2rem 0', marginTop: '.15rem' }}
                      >
                        {showMsg[item.key] ? 'Hide ▲' : 'Show message ▼'}
                      </button>
                    </>
                  )}
                  {r.status === 'failed' && (
                    <div style={{ marginTop: '.35rem' }}>
                      <div style={{ fontSize: '.78rem', color: 'var(--red-700)', marginBottom: '.3rem' }}>
                        {mapSmsError(r.error_message)}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
                        {canRetry && (
                          <button
                            onClick={() => handleRetry(r.id)}
                            disabled={retryingId === r.id}
                            style={{
                              background: 'var(--amber-50)', border: '1px solid var(--amber-300)',
                              color: 'var(--amber-800)', borderRadius: 'var(--radius-sm)',
                              fontSize: '.72rem', fontWeight: 700, cursor: retryingId === r.id ? 'not-allowed' : 'pointer',
                              padding: '.2rem .65rem', opacity: retryingId === r.id ? 0.6 : 1,
                            }}
                          >
                            {retryingId === r.id ? 'Retrying...' : 'Retry'}
                          </button>
                        )}
                        {r.error_message && (
                          <button
                            onClick={() => setShowError(p => ({ ...p, [item.key]: !p[item.key] }))}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '.72rem', color: 'var(--gray-400)', padding: 0 }}
                          >
                            {showError[item.key] ? 'Hide technical details ▲' : 'Show technical details ▼'}
                          </button>
                        )}
                      </div>
                      {showError[item.key] && r.error_message && (
                        <div style={{ marginTop: '.3rem', fontSize: '.7rem', color: 'var(--gray-500)', fontFamily: 'var(--font-mono)', background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', padding: '.4rem .6rem', wordBreak: 'break-all' }}>
                          {r.error_message}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          }

          // contact_log entry
          const l = item.data
          const ls = LOG_TYPE_STYLE[l.log_type] || LOG_TYPE_STYLE.note
          return (
            <div key={item.key} className="reminder-row">
              <div className="reminder-icon" style={{ background: ls.bg, color: ls.color, fontSize: '1rem', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {ls.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.2rem' }}>
                  <span style={{ padding: '.1rem .5rem', borderRadius: 999, fontSize: '.7rem', fontWeight: 700, background: ls.bg, color: ls.color }}>{ls.label}</span>
                  {l.created_by_name && <span style={{ fontSize: '.72rem', color: 'var(--gray-500)' }}>{l.created_by_name}</span>}
                </div>
                <div style={{ fontSize: '.82rem', color: 'var(--gray-700)', lineHeight: 1.5 }}>{l.message}</div>
                <div style={{ fontSize: '.72rem', color: 'var(--gray-400)', marginTop: '.2rem' }}>
                  {format(item.date, 'dd MMM yyyy, HH:mm')} · {formatDistanceToNow(item.date, { addSuffix: true })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BabyDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showCallPanel, setShowCallPanel] = useState(false)
  const [showDischargeModal, setShowDischargeModal] = useState(false)
  const [exportingFull, setExportingFull] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')

  const reactivate = useMutation({
    mutationFn: () => reactivateBaby(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['baby', id] }),
  })

  const handleExportFull = async () => {
    setExportingFull(true)
    try {
      await generateBabyFullPDF(baby, exams, hospitalName)
    } finally {
      setExportingFull(false)
    }
  }

  const canRecordExam  = ['ophthalmologist', 'hospital_coordinator', 'central_coordinator'].includes(user?.role)
  const isCoordinator  = user?.role === 'hospital_coordinator' || user?.role === 'central_coordinator'
  const isNurse        = user?.role === 'nicu_nurse'
  const canDilation    = isNurse || isCoordinator
  const canAddNote     = true  // all roles can add notes
  const canDischarge   = ['ophthalmologist', 'hospital_coordinator', 'central_coordinator'].includes(user?.role)
  const canReactivate  = isCoordinator
  const canEditCaregiver = isCoordinator || isNurse
  const canEditReviewDate = ['ophthalmologist', 'hospital_coordinator', 'central_coordinator'].includes(user?.role)

  const { data: baby, isLoading: babyLoading } = useQuery({
    queryKey: ['baby', id],
    queryFn: () => getBaby(id),
  })
  const { data: exams = [] } = useQuery({
    queryKey: ['exams', id],
    queryFn: () => listExams(id),
    enabled: !!id,
  })
  const { data: reminders = [] } = useQuery({
    queryKey: ['reminders', id],
    queryFn: () => listReminders({ baby_id: id, limit: 200 }),
    enabled: !!id,
  })
  const { data: hospitals = [] } = useQuery({
    queryKey: ['hospitals'],
    queryFn: listHospitals,
  })
  const hospitalName = baby ? (hospitals.find(h => h.id === baby.hospital_id)?.name || '') : ''

  if (babyLoading) return <div className="spinner-center"><div className="spinner" /></div>
  if (!baby) return <div className="alert alert-error">Baby not found.</div>

  const statusColors = {
    active:     { bg: 'var(--teal-50)',   color: 'var(--teal-700)',   label: 'Active' },
    ltfu:       { bg: 'var(--red-100)',   color: 'var(--red-700)',    label: 'LTFU' },
    discharged: { bg: 'var(--gray-100)', color: 'var(--gray-600)',   label: 'Discharged' },
    treated:    { bg: 'var(--green-100)', color: 'var(--green-700)', label: 'Treated' },
  }
  const st = statusColors[baby.status] || statusColors.active

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>← Back</button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--gray-900)', letterSpacing: '-.02em' }}>
                {getBabyDisplayName(baby)}
              </h2>
              <span style={{ padding: '.2rem .65rem', borderRadius: 999, fontSize: '.75rem', fontWeight: 700, background: st.bg, color: st.color }}>
                {st.label}
              </span>
            </div>
            {baby.rop_id && (
              <div style={{ marginTop: '.25rem', marginBottom: '.1rem' }}>
                <span style={{
                  fontFamily: 'monospace', fontSize: '.85rem', fontWeight: 700, letterSpacing: '.06em',
                  background: 'var(--teal-50)', color: 'var(--teal-700)',
                  border: '1px solid var(--teal-200)', borderRadius: 6,
                  padding: '.2rem .6rem',
                }}>
                  {baby.rop_id}
                </span>
              </div>
            )}
            <p style={{ color: 'var(--gray-500)', fontSize: '.875rem', marginTop: '.2rem' }}>
              {baby.sex === 'male' ? 'Male' : 'Female'}
              &nbsp;·&nbsp; Born {format(new Date(baby.date_of_birth + 'T00:00:00'), 'dd MMMM yyyy')}
              &nbsp;·&nbsp; GA {baby.gestational_age_weeks}w
              &nbsp;·&nbsp; {baby.birth_weight_grams}g
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '.6rem', flexShrink: 0, flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleExportFull}
            disabled={exportingFull}
            title="Export full clinical record as PDF"
          >
            {exportingFull ? 'Exporting…' : 'Export Records'}
          </button>
          {(isCoordinator || isNurse) && (
            <button
              className="btn btn-secondary"
              onClick={() => setShowCallPanel(p => !p)}
            >
              ☎ Log Call
            </button>
          )}
          {/* Discharge / Reactivate */}
          {baby.status !== 'discharged' && canDischarge && (
            <button
              className="btn btn-secondary"
              style={{ color: 'var(--red-600,#dc2626)', borderColor: 'var(--red-300,#fca5a5)' }}
              onClick={() => setShowDischargeModal(true)}
            >
              Discharge
            </button>
          )}
          {baby.status === 'discharged' && canReactivate && (
            <button
              className="btn btn-secondary"
              disabled={reactivate.isPending}
              onClick={() => reactivate.mutate()}
            >
              {reactivate.isPending ? 'Reactivating…' : 'Reactivate'}
            </button>
          )}
          {canRecordExam && baby.status !== 'discharged' && (
            <Link to={`/babies/${baby.id}/exam`} className="btn btn-primary">
              + Record Exam
            </Link>
          )}
        </div>
      </div>

      {/* ── Discharge modal ────────────────────────────────────────────── */}
      {showDischargeModal && (
        <DischargeModal
          babyId={id}
          babyName={getBabyDisplayName(baby)}
          onClose={() => setShowDischargeModal(false)}
          onDischarged={() => {
            setShowDischargeModal(false)
            qc.invalidateQueries({ queryKey: ['baby', id] })
            qc.invalidateQueries({ queryKey: ['contact-logs', id] })
            qc.invalidateQueries({ queryKey: ['nurse-dashboard'] })
            qc.invalidateQueries({ queryKey: ['dashboard'] })
          }}
        />
      )}

      {/* ── Discharged notice banner ────────────────────────────────────── */}
      {baby.status === 'discharged' && (
        <div style={{
          background: 'var(--gray-100)', border: '1px solid var(--gray-300)',
          borderRadius: 'var(--radius)', padding: '.75rem 1.1rem',
          marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '.75rem',
        }}>
          <span style={{ fontSize: '1.1rem' }}>✓</span>
          <div>
            <span style={{ fontWeight: 700, color: 'var(--gray-700)', fontSize: '.9rem' }}>
              Baby discharged
            </span>
            <span style={{ color: 'var(--gray-500)', fontSize: '.82rem', marginLeft: '.5rem' }}>
              No further SMS reminders will be sent.
              {canReactivate && ' Use "Reactivate" above to resume follow-up.'}
            </span>
          </div>
        </div>
      )}

      {/* ── Call log panel (inline) ─────────────────────────────────────── */}
      {showCallPanel && (
        <div style={{ marginBottom: '1.25rem' }}>
          <CallLogPanel
            babyId={id}
            onClose={() => setShowCallPanel(false)}
            onSaved={() => setShowCallPanel(false)}
          />
        </div>
      )}

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '.25rem', borderBottom: '2px solid var(--gray-200)', marginBottom: '1.25rem' }}>
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'vf', label: '👁 Visual Function' },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '.55rem 1.1rem',
            fontSize: '.87rem', fontWeight: 700,
            color: activeTab === tab.id ? 'var(--teal-700)' : 'var(--gray-500)',
            borderBottom: activeTab === tab.id ? '2px solid var(--teal-600)' : '2px solid transparent',
            marginBottom: '-2px', transition: 'all .15s',
          }}>{tab.label}</button>
        ))}
      </div>

      {/* ── Visual Function Tab ─────────────────────────────────────────── */}
      {activeTab === 'vf' && (
        <VisualFunctionTab exams={exams} />
      )}

      {/* ── Two-column layout ───────────────────────────────────────────── */}
      {activeTab === 'overview' && <div className="profile-grid">

        {/* LEFT: timeline + contact activity log */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Exam timeline */}
          <div className="card">
            <SectionHeading>Exam History ({exams.length} exam{exams.length !== 1 ? 's' : ''})</SectionHeading>
            <ExamTimeline exams={exams} baby={baby} hospitalName={hospitalName} />
            {canRecordExam && (
              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--gray-100)' }}>
                <Link to={`/babies/${baby.id}/exam`} className="btn btn-primary btn-sm">
                  + Record New Exam
                </Link>
              </div>
            )}
          </div>

          {/* Unified contact activity log */}
          <UnifiedContactLog
            babyId={id}
            reminders={reminders}
            canAddNote={canAddNote}
            canRetry={isCoordinator}
            onCallClick={() => setShowCallPanel(true)}
          />

        </div>

        {/* RIGHT: clinical info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Dilation status - nurses + coordinators */}
          {canDilation && (
            <DilationPanel babyId={id} baby={baby} canEdit={canDilation} />
          )}
          {!canDilation && baby.dilation_status && (
            <div className="card">
              <SectionHeading>Dilation Status</SectionHeading>
              <div style={{
                display: 'inline-block', padding: '.25rem .75rem', borderRadius: 999,
                background: DILATION_STYLE[baby.dilation_status]?.bg,
                color: DILATION_STYLE[baby.dilation_status]?.color,
                fontWeight: 700, fontSize: '.82rem',
              }}>
                {DILATION_STYLE[baby.dilation_status]?.label}
              </div>
            </div>
          )}

          {/* Next review date (editable) */}
          <NextReviewCard babyId={id} canEdit={canEditReviewDate} />

          {/* Caregiver / contact (editable) */}
          <CaregiverCard baby={baby} canEdit={canEditCaregiver} />

          {/* Birth / clinical info */}
          <div className="card">
            <SectionHeading>Clinical Details</SectionHeading>
            <InfoRow label="Date of Birth"    value={format(new Date(baby.date_of_birth + 'T00:00:00'), 'dd MMMM yyyy')} />
            <InfoRow label="Sex"              value={baby.sex === 'male' ? 'Male' : 'Female'} />
            <InfoRow label="Birth Weight"     value={`${baby.birth_weight_grams}g`} />
            <InfoRow label="Gestational Age"  value={`${baby.gestational_age_weeks} weeks`} />
            <InfoRow label="Age at 1st Exam"  value={baby.postnatal_age_days != null ? `${baby.postnatal_age_days} days` : null} />
            <InfoRow label="Total Exams"      value={exams.length} />
          </div>

          {/* Risk factors */}
          <div className="card">
            <SectionHeading>Risk Factors</SectionHeading>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
              <RiskChip active={baby.oxygen_therapy}         label="Oxygen Therapy" />
              <RiskChip active={baby.mechanical_ventilation} label="Mechanical Ventilation / CPAP" />
              <RiskChip active={baby.blood_transfusion}      label="Blood Transfusion" />
              <RiskChip active={baby.sepsis}                 label="Sepsis" />
              <RiskChip active={baby.inotropes}              label="Inotropes" />
              <RiskChip active={baby.anaemia}                label="Anaemia" />
              <RiskChip active={baby.surfactant_therapy}     label="Surfactant Therapy" />
              <RiskChip active={baby.apnoea}                 label="Apnoea" />
              <RiskChip active={baby.nec}                    label="NEC" />
              <RiskChip active={baby.twins_or_multiple}      label="Twins / Multiple Birth" />
              <RiskChip active={baby.phototherapy}           label="Phototherapy" />
            </div>
            {![baby.oxygen_therapy, baby.mechanical_ventilation, baby.blood_transfusion, baby.sepsis,
               baby.inotropes, baby.anaemia, baby.surfactant_therapy, baby.apnoea,
               baby.nec, baby.twins_or_multiple, baby.phototherapy].some(Boolean) && (
              <p style={{ fontSize: '.8rem', color: 'var(--gray-400)', marginTop: '.5rem' }}>No risk factors recorded.</p>
            )}
          </div>

          {/* Clinical Outcome */}
          <OutcomeSection babyId={id} canEdit={canRecordExam || isCoordinator} />

          {/* Referrals */}
          <ReferralSection babyId={id} babyHospitalId={baby.hospital_id} canEdit={canRecordExam || isCoordinator} />

          {/* Reminder summary */}
          {reminders.length > 0 && (
            <div className="card">
              <SectionHeading>Reminder Summary</SectionHeading>
              {[
                { key: 'sms',   label: 'SMS messages',  filter: r => r.reminder_type === 'sms' },
                { key: 'call',  label: 'Phone calls',   filter: r => r.reminder_type === 'phone_call' },
                { key: 'sent',  label: 'Delivered',     filter: r => r.status === 'sent' },
                { key: 'fail',  label: 'Failed',        filter: r => r.status === 'failed' },
              ].map(({ key, label, filter }) => {
                const n = reminders.filter(filter).length
                return n > 0 ? (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '.3rem 0', borderBottom: '1px solid var(--gray-100)', fontSize: '.82rem' }}>
                    <span style={{ color: 'var(--gray-600)' }}>{label}</span>
                    <span style={{ fontWeight: 700, color: 'var(--gray-800)' }}>{n}</span>
                  </div>
                ) : null
              })}
            </div>
          )}

        </div>
      </div>}
    </div>
  )
}
