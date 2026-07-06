import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listHospitals, createHospital, updateHospital,
  deactivateHospital, activateHospital, checkHospitalCode,
  generateHospitalCodes,
} from '../../services/adminApi'

// ── Code suggestion from hospital name ───────────────────────────────────────
const SKIP = new Set(['of', 'the', 'and', 'a', 'an', 'in', 'at', 'for', 'to', 'by'])

function suggestCode(name) {
  const words = name
    .replace(/[^a-zA-Z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !SKIP.has(w.toLowerCase()))
  if (!words.length) return ''
  const letters = words.map(w => w[0].toUpperCase())
  if (letters.length >= 3) return letters.slice(0, 3).join('')
  // Pad to 3 using subsequent letters of the first word
  let code = letters.join('')
  const first = words[0].toUpperCase()
  let i = 1
  while (code.length < 3 && i < first.length) { code += first[i]; i++ }
  return code.slice(0, 3)
}

const HOSPITAL_TYPES = [
  { value: 'national_referral',  label: 'National Referral Hospital' },
  { value: 'regional_referral',  label: 'Regional Referral Hospital' },
  { value: 'general',            label: 'General Hospital' },
  { value: 'private',            label: 'Private Hospital' },
  { value: 'health_centre_iv',   label: 'Health Centre IV' },
]

const TYPE_LABELS = Object.fromEntries(HOSPITAL_TYPES.map(t => [t.value, t.label]))

const EMPTY_FORM = {
  name: '', district: '', region: '', hospital_type: '',
  physical_address: '', contact_phone: '', hospital_code: '',
}

// ── Shared subcomponents ──────────────────────────────────────────────────────

function Badge({ active }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 12,
      fontSize: '.72rem',
      fontWeight: 600,
      background: active ? '#DCFCE7' : '#F1F5F9',
      color: active ? '#166534' : '#64748B',
    }}>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

function ConfirmDialog({ message, confirmWord, confirmLabel, onConfirm, onCancel, danger }) {
  const [typed, setTyped] = useState('')
  const needsTyped = !!confirmWord
  const ready = !needsTyped || typed === confirmWord

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: '#fff', borderRadius: 10, padding: '1.75rem',
        width: '100%', maxWidth: 440, boxShadow: '0 20px 40px rgba(0,0,0,.2)',
      }}>
        <p style={{ margin: '0 0 1rem', fontSize: '.95rem', color: '#1E293B', lineHeight: 1.5 }}>
          {message}
        </p>
        {needsTyped && (
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '.8rem', color: '#64748B', marginBottom: '.4rem' }}>
              Type <strong>{confirmWord}</strong> to confirm
            </label>
            <input
              autoFocus
              value={typed}
              onChange={e => setTyped(e.target.value)}
              style={{ width: '100%', padding: '.5rem .75rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '.9rem', boxSizing: 'border-box' }}
            />
          </div>
        )}
        <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '.5rem 1rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: '.85rem' }}>
            Cancel
          </button>
          <button
            disabled={!ready}
            onClick={onConfirm}
            style={{
              padding: '.5rem 1rem', borderRadius: 6, border: 'none',
              cursor: ready ? 'pointer' : 'not-allowed',
              background: danger ? (ready ? '#EF4444' : '#FCA5A5') : '#3B82F6',
              color: '#fff', fontSize: '.85rem', fontWeight: 600,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function HospitalForm({ initial, isEdit, onSave, onCancel, saving, error }) {
  const [form, setForm] = useState(initial || EMPTY_FORM)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Track whether the admin has manually typed in the code field
  const codeManuallyEdited = useRef(!!initial?.hospital_code)

  // Auto-suggest code as name is typed (create mode only, before manual edit)
  useEffect(() => {
    if (isEdit || codeManuallyEdited.current) return
    const suggestion = suggestCode(form.name)
    if (suggestion) set('hospital_code', suggestion)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.name])

  // Real-time availability check (debounced 400 ms)
  const [codeStatus, setCodeStatus] = useState(null) // null | {available, code, taken_by?, reason?}
  const [codeChecking, setCodeChecking] = useState(false)
  const codeTimer = useRef(null)

  useEffect(() => {
    const code = form.hospital_code
    if (!code || !/^[A-Z]{3}$/.test(code)) { setCodeStatus(null); return }
    // In edit mode skip the check when the code hasn't changed
    if (isEdit && initial?.hospital_code?.toUpperCase() === code) {
      setCodeStatus({ available: true, code }); return
    }
    clearTimeout(codeTimer.current)
    setCodeChecking(true)
    codeTimer.current = setTimeout(async () => {
      try { setCodeStatus(await checkHospitalCode(code)) }
      catch { setCodeStatus(null) }
      finally { setCodeChecking(false) }
    }, 400)
    return () => clearTimeout(codeTimer.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.hospital_code])

  const codeFormatOk = !form.hospital_code || /^[A-Z]{3}$/.test(form.hospital_code)
  const codeTaken    = !codeChecking && codeStatus && !codeStatus.available && codeStatus.taken_by
  const codeOk       = !codeChecking && codeStatus?.available === true

  const canSubmit =
    ['name', 'district', 'region'].every(k => form[k].trim()) &&
    codeFormatOk && !codeTaken && !codeChecking && !saving

  const year = new Date().getFullYear().toString().slice(-2)
  const codeUpper = form.hospital_code.toUpperCase()
  const showPreview = codeOk || (isEdit && initial?.hospital_code === codeUpper)
  const codePreview = showPreview ? `${codeUpper}-${year}-00001` : null

  function handleSubmit(e) {
    e.preventDefault()
    const payload = { ...form, hospital_code: form.hospital_code || null }
    if (!payload.physical_address) delete payload.physical_address
    if (!payload.contact_phone) delete payload.contact_phone
    onSave(payload)
  }

  const fieldStyle = {
    width: '100%', padding: '.5rem .75rem', border: '1px solid #CBD5E1',
    borderRadius: 6, fontSize: '.9rem', boxSizing: 'border-box',
  }
  const labelStyle = { display: 'block', fontSize: '.8rem', fontWeight: 500, color: '#374151', marginBottom: '.3rem' }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Hospital name *</label>
          <input style={fieldStyle} value={form.name} onChange={e => set('name', e.target.value)} required />
        </div>
        <div>
          <label style={labelStyle}>District *</label>
          <input style={fieldStyle} value={form.district} onChange={e => set('district', e.target.value)} required />
        </div>
        <div>
          <label style={labelStyle}>Region *</label>
          <input style={fieldStyle} value={form.region} onChange={e => set('region', e.target.value)} required />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Type <span style={{ color: '#94A3B8', fontWeight: 400 }}>(optional)</span></label>
          <select style={fieldStyle} value={form.hospital_type} onChange={e => set('hospital_type', e.target.value)}>
            <option value="">Select type…</option>
            {HOSPITAL_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Code field with live validation */}
        <div>
          <label style={labelStyle}>
            Hospital code <span style={{ color: '#94A3B8', fontWeight: 400 }}>(3 letters, needed for baby ROP IDs)</span>
          </label>
          <input
            style={{
              ...fieldStyle,
              textTransform: 'uppercase', fontFamily: 'monospace', fontWeight: 700, letterSpacing: '.1em',
              borderColor: codeTaken ? '#EF4444' : codeOk ? '#22C55E' : '#CBD5E1',
            }}
            value={form.hospital_code}
            onChange={e => {
              codeManuallyEdited.current = true
              set('hospital_code', e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3))
            }}
            placeholder="e.g. MNR"
            maxLength={3}
          />
          {form.hospital_code && !codeFormatOk && (
            <div style={{ color: '#EF4444', fontSize: '.75rem', marginTop: '.3rem' }}>Must be exactly 3 letters</div>
          )}
          {codeChecking && (
            <div style={{ color: '#94A3B8', fontSize: '.75rem', marginTop: '.3rem' }}>Checking…</div>
          )}
          {codeTaken && (
            <div style={{ color: '#EF4444', fontSize: '.75rem', marginTop: '.3rem' }}>
              Code {codeUpper} is already used by {codeStatus.taken_by}
            </div>
          )}
          {codeOk && (
            <div style={{ color: '#16A34A', fontSize: '.75rem', marginTop: '.3rem' }}>
              ✓ Code available
            </div>
          )}
        </div>

        {/* ROP ID preview or no-code warning */}
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          {codePreview ? (
            <div style={{
              padding: '.45rem .75rem', background: '#F0FDF4', border: '1px solid #86EFAC',
              borderRadius: 6, fontSize: '.82rem', color: '#166534',
            }}>
              Baby IDs will appear as: <strong style={{ fontFamily: 'monospace' }}>{codePreview}</strong>
            </div>
          ) : (
            <div style={{ fontSize: '.8rem', color: '#F59E0B', fontStyle: 'italic' }}>
              No code set - babies at this hospital will not receive ROP IDs
            </div>
          )}
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Physical address</label>
          <input style={fieldStyle} value={form.physical_address} onChange={e => set('physical_address', e.target.value)} placeholder="Optional" />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Contact phone</label>
          <input style={fieldStyle} value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} placeholder="Optional" />
        </div>
      </div>

      {error && (
        <div style={{ color: '#EF4444', fontSize: '.82rem', marginBottom: '.75rem' }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel}
          style={{ padding: '.5rem 1rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: '.85rem' }}>
          Cancel
        </button>
        <button type="submit" disabled={!canSubmit}
          style={{
            padding: '.5rem 1.25rem', border: 'none', borderRadius: 6,
            background: canSubmit ? '#3B82F6' : '#93C5FD',
            color: '#fff', fontWeight: 600, fontSize: '.85rem',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}>
          {saving ? 'Saving…' : 'Save hospital'}
        </button>
      </div>
    </form>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminHospitalsPage() {
  const qc = useQueryClient()
  const { data: hospitals = [], isLoading } = useQuery({
    queryKey: ['admin-hospitals'],
    queryFn: listHospitals,
  })

  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)   // 'create' | { hospital } for edit | false
  const [formError, setFormError] = useState('')
  const [confirm, setConfirm] = useState(null)      // { hospital }
  const [inactiveOpen, setInactiveOpen] = useState(false)
  const [genResult, setGenResult] = useState(null)  // result from generate-codes

  // ── Mutations ──────────────────────────────────────────────────────────────

  const generateMut = useMutation({
    mutationFn: generateHospitalCodes,
    onSuccess: (data) => { qc.invalidateQueries({ queryKey: ['admin-hospitals'] }); setGenResult(data) },
  })

  const createMut = useMutation({
    mutationFn: createHospital,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-hospitals'] }); setShowForm(false); setFormError('') },
    onError: (e) => setFormError(e.response?.data?.detail || 'Failed to create hospital'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => updateHospital(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-hospitals'] }); setShowForm(false); setFormError('') },
    onError: (e) => setFormError(e.response?.data?.detail || 'Failed to update hospital'),
  })

  const deactivateMut = useMutation({
    mutationFn: deactivateHospital,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-hospitals'] }); setConfirm(null) },
  })

  const activateMut = useMutation({
    mutationFn: activateHospital,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-hospitals'] }),
  })

  // ── Filtering ─────────────────────────────────────────────────────────────

  const q = search.toLowerCase()
  const active = useMemo(() =>
    hospitals.filter(h => h.is_active && (
      !q || h.name.toLowerCase().includes(q) || h.district.toLowerCase().includes(q) || h.region.toLowerCase().includes(q)
    )), [hospitals, q])

  const inactive = useMemo(() =>
    hospitals.filter(h => !h.is_active && (
      !q || h.name.toLowerCase().includes(q) || h.district.toLowerCase().includes(q) || h.region.toLowerCase().includes(q)
    )), [hospitals, q])

  // ── Helpers ───────────────────────────────────────────────────────────────

  function openEdit(hospital) {
    setFormError('')
    setShowForm({ hospital })
  }

  function handleSave(payload) {
    setFormError('')
    if (showForm === 'create') {
      createMut.mutate(payload)
    } else {
      updateMut.mutate({ id: showForm.hospital.id, data: payload })
    }
  }

  const saving = createMut.isPending || updateMut.isPending

  // ── Shared table row ──────────────────────────────────────────────────────

  function HospitalRow({ h, showActions }) {
    return (
      <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
        <td style={{ padding: '.75rem 1rem', fontSize: '.875rem', color: '#0F172A', fontWeight: 500 }}>
          {h.name}
        </td>
        <td style={{ padding: '.75rem 1rem' }}>
          {h.hospital_code ? (
            <span style={{
              fontFamily: 'monospace', fontWeight: 700, fontSize: '.8rem',
              background: '#F0FDF4', color: '#166534', border: '1px solid #86EFAC',
              borderRadius: 4, padding: '2px 7px',
            }}>{h.hospital_code}</span>
          ) : <span style={{ color: '#CBD5E1', fontSize: '.75rem' }}>-</span>}
        </td>
        <td style={{ padding: '.75rem 1rem', fontSize: '.8rem', color: '#64748B' }}>{h.district}</td>
        <td style={{ padding: '.75rem 1rem', fontSize: '.8rem', color: '#64748B' }}>{h.region}</td>
        <td style={{ padding: '.75rem 1rem', fontSize: '.8rem', color: '#64748B' }}>
          {TYPE_LABELS[h.hospital_type] || h.hospital_type || '-'}
        </td>
        <td style={{ padding: '.75rem 1rem' }}><Badge active={h.is_active} /></td>
        <td style={{ padding: '.75rem 1rem', fontSize: '.8rem', color: '#64748B', textAlign: 'center' }}>{h.baby_count}</td>
        <td style={{ padding: '.75rem 1rem', fontSize: '.8rem', color: '#64748B', textAlign: 'center' }}>{h.staff_count}</td>
        <td style={{ padding: '.75rem 1rem' }}>
          {showActions ? (
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <button onClick={() => openEdit(h)}
                style={{ padding: '3px 10px', fontSize: '.75rem', border: '1px solid #CBD5E1', borderRadius: 5, background: '#fff', cursor: 'pointer', color: '#374151' }}>
                Edit
              </button>
              <button onClick={() => setConfirm({ hospital: h })}
                style={{ padding: '3px 10px', fontSize: '.75rem', border: '1px solid #FCA5A5', borderRadius: 5, background: '#FFF5F5', cursor: 'pointer', color: '#DC2626' }}>
                Deactivate
              </button>
            </div>
          ) : (
            <button
              onClick={() => activateMut.mutate(h.id)}
              disabled={activateMut.isPending}
              style={{ padding: '3px 10px', fontSize: '.75rem', border: '1px solid #86EFAC', borderRadius: 5, background: '#F0FDF4', cursor: 'pointer', color: '#166534' }}>
              Reactivate
            </button>
          )}
        </td>
      </tr>
    )
  }

  const thStyle = {
    padding: '.6rem 1rem', fontSize: '.72rem', fontWeight: 600, color: '#94A3B8',
    textTransform: 'uppercase', letterSpacing: '.05em', textAlign: 'left',
    borderBottom: '1px solid #E2E8F0', background: '#F8FAFC',
  }

  function Table({ rows, showActions }) {
    return (
      <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #E2E8F0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Code</th>
              <th style={thStyle}>District</th>
              <th style={thStyle}>Region</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Status</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Babies</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Staff</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(h => <HospitalRow key={h.id} h={h} showActions={showActions} />)}
          </tbody>
        </table>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) return <div style={{ color: '#64748B' }}>Loading…</div>

  const formInitial = showForm && showForm !== 'create' ? {
    name: showForm.hospital.name,
    hospital_code: showForm.hospital.hospital_code || '',
    district: showForm.hospital.district,
    region: showForm.hospital.region,
    hospital_type: showForm.hospital.hospital_type || '',
    physical_address: showForm.hospital.physical_address || '',
    contact_phone: showForm.hospital.contact_phone || '',
  } : EMPTY_FORM

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#0F172A' }}>Hospitals</h1>
          <p style={{ margin: '.25rem 0 0', fontSize: '.85rem', color: '#64748B' }}>
            {active.length} active, {inactive.length} inactive
          </p>
        </div>
        <button
          onClick={() => { setShowForm('create'); setFormError('') }}
          style={{
            padding: '.55rem 1.1rem', background: '#3B82F6', color: '#fff',
            border: 'none', borderRadius: 7, fontWeight: 600, fontSize: '.85rem', cursor: 'pointer',
          }}>
          + Add Hospital
        </button>
      </div>

      {/* Missing-codes banner */}
      {(() => {
        const missing = hospitals.filter(h => h.is_active && !h.hospital_code).length
        if (!missing) return null
        return (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.75rem',
            background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8,
            padding: '.75rem 1rem', marginBottom: '1.25rem',
          }}>
            <span style={{ fontSize: '.85rem', color: '#92400E' }}>
              <strong>{missing}</strong> active hospital{missing > 1 ? 's have' : ' has'} no ROP code. Babies enrolled there will not receive ROP IDs.
            </span>
            <button
              onClick={() => generateMut.mutate()}
              disabled={generateMut.isPending}
              style={{
                padding: '.4rem .9rem', background: '#F59E0B', color: '#fff',
                border: 'none', borderRadius: 6, fontWeight: 600, fontSize: '.82rem',
                cursor: generateMut.isPending ? 'not-allowed' : 'pointer', flexShrink: 0,
              }}
            >
              {generateMut.isPending ? 'Generating…' : 'Auto-assign missing codes'}
            </button>
          </div>
        )
      })()}

      {/* Generate-codes result */}
      {genResult && (
        <div style={{
          background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 8,
          padding: '.75rem 1rem', marginBottom: '1.25rem',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: genResult.assigned.length ? '.6rem' : 0 }}>
            <span style={{ fontSize: '.85rem', color: '#166534', fontWeight: 600 }}>{genResult.message}</span>
            <button onClick={() => setGenResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', fontSize: '.8rem' }}>Dismiss</button>
          </div>
          {genResult.assigned.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem' }}>
              {genResult.assigned.map(a => (
                <span key={a.hospital_id} style={{
                  background: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: 4,
                  padding: '2px 8px', fontSize: '.78rem', color: '#166534',
                }}>
                  <strong style={{ fontFamily: 'monospace' }}>{a.code}</strong>: {a.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by name, district, or region…"
        style={{
          width: '100%', maxWidth: 360, padding: '.5rem .75rem',
          border: '1px solid #CBD5E1', borderRadius: 7, fontSize: '.875rem',
          marginBottom: '1.25rem', boxSizing: 'border-box',
        }}
      />

      {/* Active hospitals */}
      {active.length === 0 ? (
        <div style={{ color: '#94A3B8', fontSize: '.875rem', marginBottom: '1.5rem' }}>
          {search ? 'No active hospitals match your search.' : 'No active hospitals.'}
        </div>
      ) : (
        <div style={{ marginBottom: '2rem' }}>
          <Table rows={active} showActions={true} />
        </div>
      )}

      {/* Inactive collapsed section */}
      {inactive.length > 0 && (
        <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '1.25rem' }}>
          <button
            onClick={() => setInactiveOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: '.5rem',
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '.85rem', fontWeight: 600, color: '#64748B', padding: 0, marginBottom: '1rem',
            }}>
            <span style={{ fontSize: '.8rem' }}>{inactiveOpen ? '▾' : '▸'}</span>
            Inactive Hospitals ({inactive.length})
          </button>
          {inactiveOpen && <Table rows={inactive} showActions={false} />}
        </div>
      )}

      {/* Add / Edit modal */}
      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900,
        }}>
          <div style={{
            background: '#fff', borderRadius: 10, padding: '1.75rem',
            width: '100%', maxWidth: 560, boxShadow: '0 20px 40px rgba(0,0,0,.2)',
            maxHeight: '90vh', overflowY: 'auto',
          }}>
            <h2 style={{ margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 700, color: '#0F172A' }}>
              {showForm === 'create' ? 'Add Hospital' : 'Edit Hospital'}
            </h2>
            <HospitalForm
              initial={formInitial}
              isEdit={showForm !== 'create'}
              onSave={handleSave}
              onCancel={() => { setShowForm(false); setFormError('') }}
              saving={saving}
              error={formError}
            />
          </div>
        </div>
      )}

      {/* Deactivate confirmation */}
      {confirm && (
        <ConfirmDialog
          message={`Deactivating this hospital will hide it from the clinical app's hospital dropdown. All existing data (babies, exams, staff) will be preserved. You can reactivate it at any time.`}
          confirmWord={confirm.hospital.name}
          confirmLabel="Deactivate"
          danger
          onConfirm={() => deactivateMut.mutate(confirm.hospital.id)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
