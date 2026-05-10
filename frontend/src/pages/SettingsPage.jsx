import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listUsers, createUser, deactivateUser, activateUser,
  listHospitals, getTemplates, updateTemplate, resetTemplate,
} from '../services/api'
import { useAuth } from '../contexts/AuthContext'

const ROLE_LABELS = {
  nicu_nurse: 'NICU Nurse',
  ophthalmologist: 'Ophthalmologist',
  hospital_coordinator: 'Hospital Coordinator',
  central_coordinator: 'Central Coordinator',
}
const TRIGGER_LABELS = {
  t_minus_3: '3 days before',
  t_minus_1: '1 day before',
  day_of: 'Day of appointment',
  ltfu_48h: 'LTFU (48h missed)',
}
const LANG_FLAGS = { english: '🇬🇧', luganda: '🇺🇬', runyankole: '🇺🇬', acholi: '🇺🇬', ateso: '🇺🇬' }

// ── Users tab ────────────────────────────────────────────────────────────────
function UsersTab() {
  const qc = useQueryClient()
  const { user: me } = useAuth()
  const isCentral = me?.role === 'central_coordinator'

  const { data: users = [], isLoading } = useQuery({ queryKey: ['users'], queryFn: listUsers })
  const { data: hospitals = [] } = useQuery({ queryKey: ['hospitals'], queryFn: listHospitals, enabled: isCentral })

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ email: '', full_name: '', password: '', role: 'nicu_nurse', hospital_id: '' })
  const [formErr, setFormErr] = useState('')

  const createMut = useMutation({
    mutationFn: createUser,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setShowForm(false); setForm({ email: '', full_name: '', password: '', role: 'nicu_nurse', hospital_id: '' }); setFormErr('') },
    onError: (e) => setFormErr(e.response?.data?.detail || 'Failed to create user'),
  })
  const deactivateMut = useMutation({
    mutationFn: deactivateUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
  const activateMut = useMutation({
    mutationFn: activateUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <p style={{ fontSize: '.85rem', color: 'var(--gray-500)' }}>{users.length} staff accounts</p>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(s => !s)}>
          {showForm ? 'Cancel' : '+ Add Staff'}
        </button>
      </div>

      {showForm && (
        <div className="settings-form-card">
          <div className="settings-form-title">Add New Staff Account</div>
          {formErr && <div className="form-error" style={{ marginBottom: '.75rem' }}>{formErr}</div>}
          <div className="settings-form-grid">
            <div className="form-group">
              <label>Full Name</label>
              <input className="form-input" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Dr. Jane Nakamya" />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input className="form-input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@hospital.ug" />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input className="form-input" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Temporary password" />
            </div>
            <div className="form-group">
              <label>Role</label>
              <select className="form-input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {isCentral && (
              <div className="form-group">
                <label>Hospital</label>
                <select className="form-input" value={form.hospital_id} onChange={e => setForm(f => ({ ...f, hospital_id: e.target.value }))}>
                  <option value="">Select hospital…</option>
                  {hospitals.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <button className="btn btn-primary" style={{ marginTop: '.75rem' }}
            onClick={() => createMut.mutate(isCentral ? form : { ...form, hospital_id: undefined })}
            disabled={createMut.isPending}>
            {createMut.isPending ? 'Creating…' : 'Create Account'}
          </button>
        </div>
      )}

      {isLoading ? <div className="spinner-center"><div className="spinner" /></div> : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="card-table-wrap">
          <table className="babies-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Hospital</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.5 }}>
                  <td style={{ fontWeight: 500 }}>{u.full_name}</td>
                  <td style={{ fontSize: '.83rem', color: 'var(--gray-500)' }}>{u.email}</td>
                  <td><span style={{ fontSize: '.78rem' }}>{ROLE_LABELS[u.role] || u.role}</span></td>
                  <td style={{ fontSize: '.83rem' }}>{u.hospital_name || '-'}</td>
                  <td>
                    <span className={`badge ${u.is_active ? 'badge-on_track' : 'badge-ltfu'}`} style={{ fontSize: '.72rem' }}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    {u.id !== me?.id && (
                      u.is_active
                        ? <button className="btn btn-ghost btn-sm" onClick={() => deactivateMut.mutate(u.id)} disabled={deactivateMut.isPending}>Deactivate</button>
                        : <button className="btn btn-secondary btn-sm" onClick={() => activateMut.mutate(u.id)} disabled={activateMut.isPending}>Reactivate</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Hospitals tab ────────────────────────────────────────────────────────────
function HospitalsTab() {
  const qc = useQueryClient()
  const { data: hospitals = [], isLoading } = useQuery({ queryKey: ['hospitals'], queryFn: listHospitals })
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', district: '', region: '' })
  const [formErr, setFormErr] = useState('')

  const createMut = useMutation({
    mutationFn: (data) => import('../services/api').then(m => m.default.post('/api/hospitals/', data).then(r => r.data)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hospitals'] }); setShowForm(false); setForm({ name: '', district: '', region: '' }) },
    onError: (e) => setFormErr(e.response?.data?.detail || 'Failed to add hospital'),
  })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <p style={{ fontSize: '.85rem', color: 'var(--gray-500)' }}>{hospitals.length} hospitals in the network</p>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(s => !s)}>
          {showForm ? 'Cancel' : '+ Add Hospital'}
        </button>
      </div>

      {showForm && (
        <div className="settings-form-card">
          <div className="settings-form-title">Add Hospital to Network</div>
          {formErr && <div className="form-error" style={{ marginBottom: '.75rem' }}>{formErr}</div>}
          <div className="settings-form-grid">
            <div className="form-group">
              <label>Hospital Name</label>
              <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Mulago National Referral Hospital" />
            </div>
            <div className="form-group">
              <label>District</label>
              <input className="form-input" value={form.district} onChange={e => setForm(f => ({ ...f, district: e.target.value }))} placeholder="Kampala" />
            </div>
            <div className="form-group">
              <label>Region</label>
              <input className="form-input" value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))} placeholder="Central" />
            </div>
          </div>
          <button className="btn btn-primary" style={{ marginTop: '.75rem' }} onClick={() => createMut.mutate(form)} disabled={createMut.isPending}>
            {createMut.isPending ? 'Adding…' : 'Add Hospital'}
          </button>
        </div>
      )}

      {isLoading ? <div className="spinner-center"><div className="spinner" /></div> : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="card-table-wrap">
          <table className="babies-table">
            <thead><tr><th>Hospital</th><th>District</th><th>Region</th><th>Status</th></tr></thead>
            <tbody>
              {hospitals.map(h => (
                <tr key={h.id}>
                  <td style={{ fontWeight: 500 }}>{h.name}</td>
                  <td style={{ fontSize: '.83rem' }}>{h.district}</td>
                  <td style={{ fontSize: '.83rem' }}>{h.region}</td>
                  <td><span className="badge badge-on_track" style={{ fontSize: '.72rem' }}>Active</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── SMS Templates tab ────────────────────────────────────────────────────────
function TemplatesTab() {
  const qc = useQueryClient()
  const { data: templates = [], isLoading } = useQuery({ queryKey: ['templates'], queryFn: getTemplates })
  const [editing, setEditing] = useState(null) // { language, trigger }
  const [editBody, setEditBody] = useState('')

  const updateMut = useMutation({
    mutationFn: ({ language, trigger, body }) => updateTemplate(language, trigger, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); setEditing(null) },
  })
  const resetMut = useMutation({
    mutationFn: ({ language, trigger }) => resetTemplate(language, trigger),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })

  const languages = [...new Set(templates.map(t => t.language))]

  if (isLoading) return <div className="spinner-center"><div className="spinner" /></div>

  return (
    <div>
      <p style={{ fontSize: '.85rem', color: 'var(--gray-500)', marginBottom: '1rem' }}>
        Templates use placeholders: <code style={{ background: 'var(--gray-100)', padding: '0 .3rem', borderRadius: 3 }}>{'{caregiver}'}</code> <code style={{ background: 'var(--gray-100)', padding: '0 .3rem', borderRadius: 3 }}>{'{baby_name}'}</code> <code style={{ background: 'var(--gray-100)', padding: '0 .3rem', borderRadius: 3 }}>{'{date}'}</code> <code style={{ background: 'var(--gray-100)', padding: '0 .3rem', borderRadius: 3 }}>{'{hospital}'}</code> <code style={{ background: 'var(--gray-100)', padding: '0 .3rem', borderRadius: 3 }}>{'{phone}'}</code>
      </p>
      {languages.map(lang => (
        <div key={lang} className="card" style={{ marginBottom: '1rem' }}>
          <div className="card-section-header" style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <span>{LANG_FLAGS[lang] || '🌐'}</span>
            <span style={{ textTransform: 'capitalize' }}>{lang}</span>
          </div>
          {templates.filter(t => t.language === lang).map(t => {
            const isEditing = editing?.language === lang && editing?.trigger === t.trigger
            return (
              <div key={t.trigger} className="template-row">
                <div className="template-trigger-label">{TRIGGER_LABELS[t.trigger] || t.trigger}</div>
                {isEditing ? (
                  <div style={{ flex: 1 }}>
                    <textarea
                      className="form-input template-textarea"
                      value={editBody}
                      onChange={e => setEditBody(e.target.value)}
                      rows={4}
                    />
                    <div style={{ display: 'flex', gap: '.5rem', marginTop: '.5rem' }}>
                      <button className="btn btn-primary btn-sm" onClick={() => updateMut.mutate({ language: lang, trigger: t.trigger, body: editBody })} disabled={updateMut.isPending}>Save</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                      <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', color: 'var(--gray-400)' }} onClick={() => resetMut.mutate({ language: lang, trigger: t.trigger })}>Reset to default</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', gap: '.75rem' }}>
                    <p className="template-body">{t.body}</p>
                    <button className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }} onClick={() => { setEditing({ language: lang, trigger: t.trigger }); setEditBody(t.body) }}>Edit</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Main Settings page ───────────────────────────────────────────────────────
export default function SettingsPage() {
  const { user } = useAuth()
  const isCentral = user?.role === 'central_coordinator'
  const [tab, setTab] = useState('users')

  const tabs = [
    { key: 'users', label: 'Staff Accounts' },
    ...(isCentral ? [{ key: 'hospitals', label: 'Hospitals' }] : []),
    { key: 'templates', label: 'SMS Templates' },
  ]

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h2>Settings</h2>
          <p>Manage staff, hospitals, and SMS message templates</p>
        </div>
      </div>

      <div className="settings-tabs">
        {tabs.map(t => (
          <button
            key={t.key}
            className={`settings-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: '1.5rem' }}>
        {tab === 'users'     && <UsersTab />}
        {tab === 'hospitals' && <HospitalsTab />}
        {tab === 'templates' && <TemplatesTab />}
      </div>
    </div>
  )
}
