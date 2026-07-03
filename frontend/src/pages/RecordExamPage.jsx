import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getBaby, listExams, recordExam } from '../services/api'
import { useTheme } from '../contexts/ThemeContext'
import { format, addWeeks } from 'date-fns'
import { getBabyDisplayName } from '../utils/babyName'

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

// VF labels
const VF_FIXATION_OPTS   = [['central', 'Central'], ['eccentric', 'Eccentric'], ['none_unable', 'None / Unable']]
const VF_FOLLOWING_OPTS  = [['follows_smoothly', 'Follows smoothly'], ['follows_partially', 'Follows partially'], ['does_not_follow', 'Does not follow'], ['unable_to_assess', 'Unable to assess']]
const VF_CSM_OPTS        = [['csm', 'CSM'], ['cs', 'CS (not maintained)'], ['c', 'C (not steady)'], ['not_central', 'Not central (N)'], ['unable_to_assess', 'Unable']]
const VF_NYSTAGMUS_OPTS  = [['absent', 'Absent'], ['pendular', 'Present (Pendular)'], ['jerk', 'Present (Jerk)'], ['latent', 'Present (Latent)']]
const VF_STRABISMUS_OPTS = [['absent', 'Absent'], ['esotropia', 'Esotropia'], ['exotropia', 'Exotropia'], ['suspected', 'Suspected (needs orthoptic review)']]
const VF_IMPRESSION_OPTS = [
  ['age_appropriate', 'Age-appropriate visual function'],
  ['mildly_delayed', 'Mildly delayed (monitor)'],
  ['significantly_delayed', 'Significantly delayed (refer for low vision assessment)'],
  ['unable_to_assess', 'Unable to assess this visit'],
]

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
        <div>
          <div className="toggle-label">Zone</div>
          <div className="toggle-row">
            {zones.map(z => (
              <button key={z} type="button"
                className={`toggle-btn${values[prefix + '_zone'] === z ? ' active-zone' : ''}`}
                onClick={() => onChange(prefix + '_zone', z === values[prefix + '_zone'] ? null : z)}
                style={{ flex: 1 }}
              >{ZONE_LABELS[z]}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="toggle-label">Stage</div>
          <div className="toggle-row">
            {stages.map(s => (
              <button key={s} type="button"
                className={`toggle-btn${values[prefix + '_stage'] === s ? ' active-stage' : ''}`}
                onClick={() => onChange(prefix + '_stage', s === values[prefix + '_stage'] ? null : s)}
              >{STAGE_LABELS[s]}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="toggle-label">Plus Disease</div>
          <div className="toggle-row">
            {plusOpts.map(p => {
              const cls = p === 'none' ? 'active-none' : p === 'pre_plus' ? 'active-pre' : 'active-plus'
              return (
                <button key={p} type="button"
                  className={`toggle-btn${values[prefix + '_plus'] === p ? ` ${cls}` : ''}`}
                  onClick={() => onChange(prefix + '_plus', p)}
                  style={{ flex: 1 }}
                >{PLUS_LABELS[p]}</button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── VF toggle row ─────────────────────────────────────────────────────────────
function VFToggleRow({ label, opts, value, onChange, compact }) {
  return (
    <div>
      <div className="toggle-label" style={{ fontSize: '.72rem' }}>{label}</div>
      <div className="toggle-row" style={{ flexWrap: compact ? 'wrap' : 'nowrap', gap: '.3rem' }}>
        {opts.map(([v, l]) => (
          <button key={v} type="button"
            className={`toggle-btn${value === v ? ' active-zone' : ''}`}
            onClick={() => onChange(value === v ? '' : v)}
            style={{ flex: compact ? '0 0 auto' : 1, fontSize: '.75rem', padding: '.3rem .5rem', whiteSpace: 'nowrap' }}
          >{l}</button>
        ))}
      </div>
    </div>
  )
}

// ── VF per-eye panel ──────────────────────────────────────────────────────────
function VFEyePanel({ side, vf, setVf }) {
  const p = side
  const label = side === 'right' ? 'Right Eye (OD)' : 'Left Eye (OS)'
  const { resolved } = useTheme()
  const accentColor = side === 'right' ? '#2563eb' : '#16a34a'
  const bgColor = resolved === 'dark'
    ? (side === 'right' ? '#15233f' : '#0e2417')
    : (side === 'right' ? '#eff6ff' : '#f0fdf4')

  return (
    <div style={{ flex: 1, minWidth: 260, background: bgColor, borderRadius: 'var(--radius)', padding: '1rem', borderTop: `3px solid ${accentColor}` }}>
      <div style={{ fontSize: '.78rem', fontWeight: 700, color: accentColor, marginBottom: '.75rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
        <VFToggleRow label="Fixation" opts={VF_FIXATION_OPTS}
          value={vf[p + '_fixation']}
          onChange={v => setVf(prev => ({ ...prev, [p + '_fixation']: v }))}
        />
        <VFToggleRow label="Following" opts={VF_FOLLOWING_OPTS}
          value={vf[p + '_following']}
          onChange={v => setVf(prev => ({ ...prev, [p + '_following']: v }))}
          compact
        />
        <VFToggleRow label="CSM" opts={VF_CSM_OPTS}
          value={vf[p + '_csm']}
          onChange={v => setVf(prev => ({ ...prev, [p + '_csm']: v }))}
          compact
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ fontSize: '.7rem' }}>
              Teller Acuity (c/d)
              <span title="Preferential looking acuity estimate using Teller cards" style={{ marginLeft: '.3rem', cursor: 'help', color: 'var(--gray-400)' }}>ⓘ</span>
            </label>
            <input type="number" step="0.01" min="0" placeholder="e.g. 1.5"
              value={vf[p + '_teller_acuity']}
              onChange={e => setVf(prev => ({ ...prev, [p + '_teller_acuity']: e.target.value }))}
              style={{ fontSize: '.83rem' }}
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ fontSize: '.7rem' }}>
              VEP (LogMAR)
              <span title="Visual Evoked Potential: objective cortical acuity measure" style={{ marginLeft: '.3rem', cursor: 'help', color: 'var(--gray-400)' }}>ⓘ</span>
            </label>
            <input type="number" step="0.01" placeholder="e.g. 0.3"
              value={vf[p + '_vep']}
              onChange={e => setVf(prev => ({ ...prev, [p + '_vep']: e.target.value }))}
              style={{ fontSize: '.83rem' }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Visual Function Assessment section ────────────────────────────────────────
function VisualFunctionSection({ vf, setVf, previousExams }) {
  const hasPreviousVF = (previousExams || []).some(e =>
    e.vf_right_fixation || e.vf_left_fixation || e.vf_right_following || e.vf_left_following
  )
  const [expanded, setExpanded] = useState(hasPreviousVF)

  if (!expanded) {
    return (
      <div className="card" style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            width: '100%', background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '.6rem', padding: 0,
            color: 'var(--teal-600)', fontSize: '.87rem', fontWeight: 600,
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Add Visual Function Assessment (optional)
        </button>
        <p style={{ fontSize: '.75rem', color: 'var(--gray-400)', margin: '.4rem 0 0 1.6rem' }}>
          Functional vision, appropriate for neonates and infants.
        </p>
      </div>
    )
  }

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div>
          <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--teal-600)', textTransform: 'uppercase', letterSpacing: '.09em' }}>
            Visual Function Assessment
          </div>
          <div style={{ fontSize: '.75rem', color: 'var(--gray-500)', marginTop: '.15rem' }}>
            Functional vision, appropriate for neonates and infants. All fields optional.
          </div>
        </div>
        <button type="button" onClick={() => setExpanded(false)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '.75rem', color: 'var(--gray-400)', padding: '.2rem .4rem' }}>
          Collapse ▲
        </button>
      </div>

      {/* Per-eye panels */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <VFEyePanel side="right" vf={vf} setVf={setVf} />
        <VFEyePanel side="left"  vf={vf} setVf={setVf} />
      </div>

      {/* Binocular fields */}
      <div style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius)', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
        <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
          Binocular Findings
        </div>
        <VFToggleRow label="Nystagmus" opts={VF_NYSTAGMUS_OPTS}
          value={vf.nystagmus}
          onChange={v => setVf(prev => ({ ...prev, nystagmus: v }))}
        />
        <VFToggleRow label="Strabismus" opts={VF_STRABISMUS_OPTS}
          value={vf.strabismus}
          onChange={v => setVf(prev => ({ ...prev, strabismus: v }))}
          compact
        />
      </div>

      {/* Overall impression */}
      <div style={{ marginTop: '1rem' }}>
        <div className="form-group">
          <label className="form-label">Overall Functional Impression</label>
          <select value={vf.functional_impression} onChange={e => setVf(prev => ({ ...prev, functional_impression: e.target.value }))}>
            <option value="">Select...</option>
            {VF_IMPRESSION_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Functional Vision Notes</label>
          <textarea rows={2} style={{ resize: 'vertical' }}
            placeholder="Additional observations about visual function…"
            value={vf.vf_notes}
            onChange={e => setVf(prev => ({ ...prev, vf_notes: e.target.value }))}
          />
        </div>
      </div>
    </div>
  )
}

// ── Anterior Segment section ──────────────────────────────────────────────────
function AntBoolToggle({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: '.3rem', justifyContent: 'center' }}>
      {[true, false].map(opt => (
        <button key={String(opt)} type="button"
          onClick={() => onChange(value === opt ? null : opt)}
          style={{
            padding: '.18rem .6rem', borderRadius: 4, fontSize: '.78rem', fontWeight: 600,
            border: '1.5px solid',
            borderColor: value === opt ? (opt ? 'var(--teal-600)' : '#64748b') : 'var(--gray-300)',
            background: value === opt ? (opt ? 'var(--teal-600)' : '#64748b') : 'white',
            color: value === opt ? 'white' : 'var(--gray-500)',
            cursor: 'pointer',
          }}
        >
          {opt ? 'Yes' : 'No'}
        </button>
      ))}
    </div>
  )
}


const ANT_ROWS = [
  ['active_iris',  'Active Iris Vasculature'],
  ['tvl',          'Tunica Vasculosa Lentis (TVL)'],
  ['rigid_pupil',  'Rigid Pupil'],
  ['others',       'Others'],
]

function AnteriorSegmentSection({ ant, setAnt, previousExams }) {
  const hasPreviousAnt = (previousExams || []).some(e =>
    e.ant_right_active_iris != null || e.ant_left_active_iris != null ||
    e.rv_right != null || e.rv_left != null
  )
  const [expanded, setExpanded] = useState(hasPreviousAnt)
  const set = (key, val) => setAnt(prev => ({ ...prev, [key]: val }))

  if (!expanded) {
    return (
      <div className="card" style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            width: '100%', background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '.6rem', padding: 0,
            color: 'var(--teal-600)', fontSize: '.87rem', fontWeight: 600,
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Add Anterior Segment Examination (optional)
        </button>
        <p style={{ fontSize: '.75rem', color: 'var(--gray-400)', margin: '.4rem 0 0 1.6rem' }}>
          Active iris vasculature, TVL, pupil reactivity, retinal vessel maturity.
        </p>
      </div>
    )
  }

  const cellStyle = { padding: '.5rem .75rem', borderBottom: '1px solid var(--gray-200)', verticalAlign: 'middle' }

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div>
          <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--teal-600)', textTransform: 'uppercase', letterSpacing: '.09em' }}>
            Anterior Segment Examination
          </div>
          <div style={{ fontSize: '.75rem', color: 'var(--gray-500)', marginTop: '.15rem' }}>
            All fields optional. Click Yes or No; click again to clear.
          </div>
        </div>
        <button type="button" onClick={() => setExpanded(false)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '.75rem', color: 'var(--gray-400)', padding: '.2rem .4rem' }}>
          Collapse ▲
        </button>
      </div>

      {/* Boolean findings table */}
      <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
          <thead>
            <tr style={{ background: 'var(--gray-50)' }}>
              <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 700, color: 'var(--gray-600)', fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', width: '44%' }}>
                Finding
              </th>
              <th style={{ ...cellStyle, textAlign: 'center', fontWeight: 700, color: 'var(--gray-600)', fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Right Eye (RE)
              </th>
              <th style={{ ...cellStyle, textAlign: 'center', fontWeight: 700, color: 'var(--gray-600)', fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Left Eye (LE)
              </th>
            </tr>
          </thead>
          <tbody>
            {ANT_ROWS.map(([key, label]) => (
              <tr key={key}>
                <td style={{ ...cellStyle, color: 'var(--gray-700)' }}>{label}</td>
                <td style={{ ...cellStyle }}>
                  <AntBoolToggle value={ant[`right_${key}`]} onChange={v => set(`right_${key}`, v)} />
                </td>
                <td style={{ ...cellStyle }}>
                  <AntBoolToggle value={ant[`left_${key}`]} onChange={v => set(`left_${key}`, v)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Specify fields when Others = Yes */}
      {(ant.right_others === true || ant.left_others === true) && (
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {ant.right_others === true && (
            <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
              <label className="form-label">RE Others - specify</label>
              <input type="text" value={ant.right_others_specify}
                onChange={e => set('right_others_specify', e.target.value)}
                placeholder="Specify right eye finding..." />
            </div>
          )}
          {ant.left_others === true && (
            <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
              <label className="form-label">LE Others - specify</label>
              <input type="text" value={ant.left_others_specify}
                onChange={e => set('left_others_specify', e.target.value)}
                placeholder="Specify left eye finding..." />
            </div>
          )}
        </div>
      )}

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

  const due = addWeeks(new Date(examDate + 'T00:00:00'), weeks)
  const cls = weeks === 1 ? 'week-1' : weeks === 2 ? 'week-2' : 'week-4'

  return (
    <div className={`schedule-banner ${cls}`}>
      <div>
        <div className="schedule-weeks">Next exam in {weeks} week{weeks > 1 ? 's' : ''}</div>
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

  const { data: previousExams = [] } = useQuery({
    queryKey: ['exams', id],
    queryFn: () => listExams(id),
    enabled: !!id,
  })

  const today = format(new Date(), 'yyyy-MM-dd')

  const [fields, setFields] = useState({
    right_zone: null, right_stage: null, right_plus: 'none',
    left_zone:  null, left_stage:  null, left_plus:  'none',
  })
  const [examDate, setExamDate]         = useState(today)
  const [postnatalAge, setPostnatalAge] = useState('')

  const calcPostnatalAge = (dob, examDateStr) => {
    if (!dob) return ''
    const d1 = new Date(dob + 'T00:00:00')
    const d2 = new Date(examDateStr + 'T00:00:00')
    const days = Math.round((d2 - d1) / 86400000)
    return days >= 0 ? String(days) : ''
  }
  const [treatment, setTreatment]       = useState('')
  const [notes, setNotes]               = useState('')
  const [submitting, setSubmitting]     = useState(false)
  const [error, setError]               = useState('')

  const [vf, setVf] = useState({
    right_fixation: '', right_following: '', right_csm: '',
    right_teller_acuity: '', right_vep: '',
    left_fixation: '', left_following: '', left_csm: '',
    left_teller_acuity: '', left_vep: '',
    nystagmus: '', strabismus: '',
    functional_impression: '', vf_notes: '',
  })

  const [anteriorSegment, setAnteriorSegment] = useState({
    right_active_iris: null, left_active_iris: null,
    right_tvl: null, left_tvl: null,
    right_rigid_pupil: null, left_rigid_pupil: null,
    right_others: null, left_others: null,
    right_others_specify: '', left_others_specify: '',
  })

  useEffect(() => {
    if (baby?.date_of_birth) {
      setPostnatalAge(calcPostnatalAge(baby.date_of_birth, examDate))
    }
  }, [baby?.date_of_birth, examDate])

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
      const vfPayload = {
        vf_right_fixation: vf.right_fixation || null,
        vf_right_following: vf.right_following || null,
        vf_right_csm: vf.right_csm || null,
        vf_right_teller_acuity: vf.right_teller_acuity ? parseFloat(vf.right_teller_acuity) : null,
        vf_right_vep: vf.right_vep ? parseFloat(vf.right_vep) : null,
        vf_left_fixation: vf.left_fixation || null,
        vf_left_following: vf.left_following || null,
        vf_left_csm: vf.left_csm || null,
        vf_left_teller_acuity: vf.left_teller_acuity ? parseFloat(vf.left_teller_acuity) : null,
        vf_left_vep: vf.left_vep ? parseFloat(vf.left_vep) : null,
        vf_nystagmus: vf.nystagmus || null,
        vf_strabismus: vf.strabismus || null,
        vf_functional_impression: vf.functional_impression || null,
        vf_notes: vf.vf_notes || null,
      }
      const antPayload = {
        ant_right_active_iris: anteriorSegment.right_active_iris,
        ant_left_active_iris:  anteriorSegment.left_active_iris,
        ant_right_tvl:         anteriorSegment.right_tvl,
        ant_left_tvl:          anteriorSegment.left_tvl,
        ant_right_rigid_pupil: anteriorSegment.right_rigid_pupil,
        ant_left_rigid_pupil:  anteriorSegment.left_rigid_pupil,
        ant_right_others:      anteriorSegment.right_others,
        ant_left_others:       anteriorSegment.left_others,
        ant_right_others_specify: anteriorSegment.right_others_specify || null,
        ant_left_others_specify:  anteriorSegment.left_others_specify || null,
      }
      await recordExam({
        baby_id: id, exam_date: examDate,
        postnatal_age_days: postnatalAge ? parseInt(postnatalAge) : null,
        right_zone: fields.right_zone || null, right_stage: fields.right_stage || null, right_plus: fields.right_plus || 'none',
        left_zone:  fields.left_zone  || null, left_stage:  fields.left_stage  || null, left_plus:  fields.left_plus  || 'none',
        treatment_recommended: treatment || null, notes: notes || null,
        ...vfPayload,
        ...antPayload,
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
              {getBabyDisplayName(baby)} · DOB {dob} · GA {baby.gestational_age_weeks}w · {baby.birth_weight_grams}g
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
              <label>Postnatal Age (days) <span style={{ fontWeight: 400, color: 'var(--gray-500)', fontSize: '.8em' }}>(auto-calculated)</span></label>
              <input type="number" min="0" value={postnatalAge} onChange={e => setPostnatalAge(e.target.value)} placeholder="e.g. 42" />
            </div>
          </div>
        </div>

        {/* Anterior Segment Examination */}
        <AnteriorSegmentSection ant={anteriorSegment} setAnt={setAnteriorSegment} previousExams={previousExams} />

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

        {/* Visual Function Assessment */}
        <VisualFunctionSection vf={vf} setVf={setVf} previousExams={previousExams} />

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
