import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { enrollBaby, listHospitals, getMyHospitals } from '../services/api'
import { useAuth } from '../contexts/AuthContext'

const LANGUAGES = [
  { value: 'english',    label: 'English' },
  { value: 'luganda',    label: 'Luganda' },
  { value: 'runyankole', label: 'Runyankole' },
  { value: 'acholi',     label: 'Acholi' },
  { value: 'ateso',      label: 'Ateso' },
]

const RISK_FACTORS = [
  { name: 'oxygen_therapy',       label: 'Oxygen Therapy' },
  { name: 'mechanical_ventilation', label: 'Mechanical Ventilation / CPAP' },
  { name: 'blood_transfusion',    label: 'Blood Transfusion' },
  { name: 'sepsis',               label: 'Sepsis' },
  { name: 'inotropes',            label: 'Inotropes' },
  { name: 'anaemia',              label: 'Anaemia' },
  { name: 'surfactant_therapy',   label: 'Surfactant Therapy' },
  { name: 'apnoea',               label: 'Apnoea' },
  { name: 'nec',                  label: 'NEC' },
  { name: 'twins_or_multiple',    label: 'Twins / Multiple Birth' },
  { name: 'phototherapy',         label: 'Phototherapy' },
]

function IconHospital() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <line x1="12" y1="22" x2="12" y2="12"/><path d="M9 12h6M12 9v6"/>
    </svg>
  )
}
function IconUser() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  )
}
function IconActivity() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  )
}
function IconAlert() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  )
}
function IconPhone() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.89a16 16 0 0 0 6 6l.88-.88a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21.24 16a2 2 0 0 1 .68.92z"/>
    </svg>
  )
}
function IconNote() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
  )
}

function FormSection({ icon, iconColor = 'teal', title, sub, children }) {
  return (
    <div className="form-section">
      <div className="form-section-header">
        <div className={`form-section-icon ${iconColor}`}>{icon}</div>
        <div>
          <div className="form-section-title">{title}</div>
          {sub && <div className="form-section-sub">{sub}</div>}
        </div>
      </div>
      <div className="form-section-body">{children}</div>
    </div>
  )
}

export default function EnrollBabyPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [submitError, setSubmitError] = useState('')
  const [success, setSuccess] = useState(false)

  const isOphthalm = user?.role === 'ophthalmologist'

  const { data: hospitals = [], isLoading: hospitalsLoading } = useQuery({
    queryKey: ['hospitals'],
    queryFn: listHospitals,
    enabled: !isOphthalm,
  })
  const { data: myHospitals, isLoading: myHospitalsLoading } = useQuery({
    queryKey: ['my-hospitals'],
    queryFn: getMyHospitals,
    enabled: isOphthalm,
  })
  const hospitalsForDropdown = isOphthalm ? null : hospitals  // ophthalmologists use sectioned dropdown

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm({
    defaultValues: {
      hospital_id: '',
      sex: 'male', language_preference: 'english',
      oxygen_therapy: false, blood_transfusion: false, sepsis: false, inotropes: false, anaemia: false,
      mechanical_ventilation: false, surfactant_therapy: false, apnoea: false,
      nec: false, twins_or_multiple: false, phototherapy: false,
    },
  })

  useEffect(() => {
    if (hospitals.length > 0 && user?.hospital_id &&
        (user.role === 'nicu_nurse' || user.role === 'hospital_coordinator')) {
      setValue('hospital_id', user.hospital_id)
    }
  }, [hospitals, user, setValue])

  const onSubmit = async data => {
    setSubmitError('')
    try {
      const payload = {
        ...data,
        birth_weight_grams:    parseFloat(data.birth_weight_grams),
        gestational_age_weeks: parseFloat(data.gestational_age_weeks),
        postnatal_age_days:    data.postnatal_age_days ? parseInt(data.postnatal_age_days) : null,
      }
      const baby = await enrollBaby(payload)
      setSuccess(true)
      reset()
      setTimeout(() => navigate(`/babies/${baby.id}`), 1500)
    } catch (err) {
      setSubmitError(err.response?.data?.detail || 'Failed to enroll baby. Please try again.')
    }
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div className="page-header">
        <div className="page-header-text">
          <h2>Enroll New Baby</h2>
          <p>Complete all fields to register a baby for ROP screening follow-up.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/dashboard')}>
          ← Back
        </button>
      </div>

      {success && <div className="alert alert-success">Baby enrolled successfully! Redirecting to profile…</div>}
      {submitError && <div className="alert alert-error">{submitError}</div>}

      <form onSubmit={handleSubmit(onSubmit)}>

        <FormSection icon={<IconHospital />} iconColor="teal" title="Hospital / Facility" sub="Select the facility where this baby is being enrolled">
          <div className="form-group">
            <label>Hospital / Facility *</label>
            {isOphthalm ? (
              <select
                {...register('hospital_id', { required: 'Hospital is required' })}
                disabled={myHospitalsLoading}
              >
                <option value="">
                  {myHospitalsLoading ? 'Loading hospitals…' : '-- Select a hospital --'}
                </option>
                {myHospitals?.recent?.length > 0 && (
                  <optgroup label="Recent">
                    {myHospitals.recent.map(h => (
                      <option key={h.id} value={h.id}>{h.name}{h.district ? ` (${h.district})` : ''}</option>
                    ))}
                  </optgroup>
                )}
                {myHospitals?.all?.length > 0 && (
                  <optgroup label="All Hospitals">
                    {myHospitals.all.map(h => (
                      <option key={h.id} value={h.id}>{h.name}{h.district ? ` (${h.district})` : ''}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            ) : (
              <select
                {...register('hospital_id', { required: 'Hospital is required' })}
                disabled={hospitalsLoading}
              >
                <option value="">
                  {hospitalsLoading ? 'Loading hospitals…' : '-- Select a hospital --'}
                </option>
                {hospitals.map(h => (
                  <option key={h.id} value={h.id}>{h.name}{h.district ? ` (${h.district})` : ''}</option>
                ))}
              </select>
            )}
            {errors.hospital_id && <span className="error-msg">{errors.hospital_id.message}</span>}
          </div>
        </FormSection>

        <FormSection icon={<IconUser />} iconColor="teal" title="Baby Information" sub="Identity and basic demographics">
          <div className="form-row">
            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label>Full Name *</label>
              <input {...register('full_name', { required: 'Name is required' })} placeholder="e.g. Baby Nakamya" />
              {errors.full_name && <span className="error-msg">{errors.full_name.message}</span>}
            </div>
            <div className="form-group">
              <label>Date of Birth *</label>
              <input type="date" {...register('date_of_birth', { required: 'Date of birth is required' })} />
              {errors.date_of_birth && <span className="error-msg">{errors.date_of_birth.message}</span>}
            </div>
            <div className="form-group">
              <label>Sex *</label>
              <select {...register('sex', { required: true })}>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
          </div>
        </FormSection>

        <FormSection icon={<IconActivity />} iconColor="blue" title="Birth Metrics" sub="Clinical measurements at birth">
          <div className="form-row">
            <div className="form-group">
              <label>Birth Weight (grams) *</label>
              <input
                type="number" step="1" min="300" max="4000"
                {...register('birth_weight_grams', {
                  required: 'Birth weight is required',
                  min: { value: 300, message: 'Must be ≥ 300g' },
                  max: { value: 4000, message: 'Must be ≤ 4000g' },
                })}
                placeholder="e.g. 1200"
              />
              {errors.birth_weight_grams && <span className="error-msg">{errors.birth_weight_grams.message}</span>}
            </div>
            <div className="form-group">
              <label>Gestational Age at Birth (weeks) *</label>
              <input
                type="number" step="0.5" min="22" max="36"
                {...register('gestational_age_weeks', {
                  required: 'Gestational age is required',
                  min: { value: 22, message: 'Must be ≥ 22 weeks' },
                  max: { value: 36, message: 'Must be ≤ 36 weeks' },
                })}
                placeholder="e.g. 28.5"
              />
              {errors.gestational_age_weeks && <span className="error-msg">{errors.gestational_age_weeks.message}</span>}
            </div>
            <div className="form-group">
              <label>Postnatal Age at First Exam (days)</label>
              <input type="number" min="0" {...register('postnatal_age_days')} placeholder="e.g. 14" />
            </div>
          </div>
        </FormSection>

        <FormSection icon={<IconAlert />} iconColor="amber" title="Risk Factors" sub="Check all that apply during NICU stay">
          <div className="checkbox-group">
            {RISK_FACTORS.map(rf => {
              const checked = !!watch(rf.name)
              return (
                <label key={rf.name} className={`risk-chip${checked ? ' active' : ''}`}>
                  <input type="checkbox" {...register(rf.name)} style={{ display: 'none' }} />
                  {checked && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ width: 12, height: 12, flexShrink: 0 }}>
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                  {rf.label}
                </label>
              )
            })}
          </div>
        </FormSection>

        <FormSection icon={<IconPhone />} iconColor="green" title="Parent / Caregiver" sub="Contact details for SMS & WhatsApp reminders">
          <div className="form-row">
            <div className="form-group">
              <label>Caregiver Full Name *</label>
              <input {...register('caregiver_name', { required: 'Caregiver name is required' })} placeholder="e.g. Prossy Nakamya" />
              {errors.caregiver_name && <span className="error-msg">{errors.caregiver_name.message}</span>}
            </div>
            <div className="form-group">
              <label>MTN Phone Number</label>
              <input {...register('mtn_phone')} placeholder="+256 77X XXX XXX" type="tel" />
            </div>
            <div className="form-group">
              <label>Airtel Phone Number</label>
              <input {...register('airtel_phone')} placeholder="+256 75X XXX XXX" type="tel" />
            </div>
            <div className="form-group">
              <label>Language Preference</label>
              <select {...register('language_preference')}>
                {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
          </div>
        </FormSection>

        <FormSection icon={<IconNote />} iconColor="purple" title="Additional Notes" sub="Optional clinical observations">
          <div className="form-group">
            <textarea {...register('notes')} rows={3} placeholder="Any additional clinical notes…" style={{ resize: 'vertical' }} />
          </div>
        </FormSection>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '.5rem', marginBottom: '1rem' }}>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/dashboard')}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Enrolling…' : 'Enroll Baby'}
          </button>
        </div>
      </form>
    </div>
  )
}
