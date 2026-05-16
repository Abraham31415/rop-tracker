import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listUsers, createUser, deactivateUser, activateUser,
  listHospitals, getTemplates, updateTemplate, resetTemplate,
  getGatewayStatus, sendTestSms,
} from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'

// Used in the "Add Staff" form dropdown — CC accounts are created in /admin
const ROLE_LABELS = {
  nicu_nurse: 'NICU Nurse',
  ophthalmologist: 'Ophthalmologist',
  hospital_coordinator: 'Hospital Coordinator',
}
// Used for display only (table rows may include CC accounts)
const ROLE_DISPLAY_LABELS = {
  ...ROLE_LABELS,
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
  // Central coordinators may add nurses, ophthalmologists and hospital coordinators.
  // Hospital coordinators may add NICU nurses only.
  const creatableRoles = isCentral
    ? ['nicu_nurse', 'ophthalmologist', 'hospital_coordinator']
    : ['nicu_nurse']

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
                {creatableRoles.map(v => <option key={v} value={v}>{ROLE_LABELS[v]}</option>)}
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
                  <td><span style={{ fontSize: '.78rem' }}>{ROLE_DISPLAY_LABELS[u.role] || u.role}</span></td>
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

// ── SMS Gateway tab ──────────────────────────────────────────────────────────
function GatewayTab() {
  const dark = useTheme().resolved === 'dark'
  const qc = useQueryClient()
  const [testPhone, setTestPhone] = useState('')
  const [testResult, setTestResult] = useState(null)

  const { data: status, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['gateway-status'],
    queryFn: getGatewayStatus,
    staleTime: 30_000,
  })

  const testMut = useMutation({
    mutationFn: () => sendTestSms(testPhone.trim()),
    onSuccess: (data) => {
      setTestResult(data)
      qc.invalidateQueries({ queryKey: ['gateway-status'] })
    },
    onError: (e) => {
      setTestResult({ success: false, error: e.response?.data?.detail || e.message })
    },
  })

  const isLive = status?.mode === 'live'

  function StatRow({ label, value, accent }) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.45rem 0', borderBottom: '1px solid var(--gray-100)' }}>
        <span style={{ fontSize: '.8rem', color: 'var(--gray-500)', fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: '.85rem', fontWeight: 700, color: accent || 'var(--gray-800)' }}>{value}</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Status panel */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div>
            <div style={{ fontSize: '.68rem', fontWeight: 700, color: 'var(--teal-600)', textTransform: 'uppercase', letterSpacing: '.09em', marginBottom: '.35rem' }}>
              Gateway Status
            </div>
            {isLoading && <div style={{ fontSize: '.85rem', color: 'var(--gray-400)' }}>Loading...</div>}
            {!isLoading && status && (
              <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{
                  padding: '.3rem .85rem', borderRadius: 999, fontSize: '.82rem', fontWeight: 800,
                  background: isLive ? 'var(--green-100)' : 'var(--gray-100)',
                  color: isLive ? 'var(--green-700)' : 'var(--gray-500)',
                }}>
                  {isLive ? 'Live' : 'Simulation Mode'}
                </span>
                <span style={{
                  padding: '.3rem .85rem', borderRadius: 999, fontSize: '.82rem', fontWeight: 700,
                  background: status.configured
                    ? (dark ? '#15233f' : '#eff6ff') : (dark ? '#78350f' : '#fef3c7'),
                  color: status.configured
                    ? (dark ? '#93c5fd' : '#1d4ed8') : (dark ? '#fcd34d' : '#92400e'),
                }}>
                  {status.configured ? 'Credentials set' : 'No API key'}
                </span>
              </div>
            )}
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => refetch()}
            disabled={isFetching}
            style={{ flexShrink: 0 }}
          >
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div className="alert alert-error" style={{ fontSize: '.82rem', padding: '.4rem .65rem' }}>
            Failed to load gateway status.
          </div>
        )}

        {status && (
          <>
            <StatRow label="AT Username"   value={status.username || '-'} />
            <StatRow label="Sender ID"     value={status.sender_id || '(default)'} />
            <StatRow
              label="Sent (last 24h)"
              value={status.stats_24h.sent}
              accent={status.stats_24h.sent > 0 ? 'var(--green-700)' : undefined}
            />
            <StatRow
              label="Failed (last 24h)"
              value={status.stats_24h.failed}
              accent={status.stats_24h.failed > 0 ? 'var(--red-700)' : undefined}
            />
            <StatRow
              label="Last sent"
              value={status.last_sent_at
                ? new Date(status.last_sent_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
                : 'Never'}
            />
            <StatRow
              label="Last failure"
              value={status.last_failed_at
                ? new Date(status.last_failed_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
                : 'None'}
            />
          </>
        )}

        {!isLoading && status?.mode === 'simulate' && (
          <div style={{
            marginTop: '1rem', padding: '.65rem .9rem',
            background: dark ? '#78350f' : '#fef3c7', borderRadius: 'var(--radius-sm)',
            border: `1px solid ${dark ? '#92400e' : '#fcd34d'}`,
            fontSize: '.82rem', color: dark ? '#fcd34d' : '#92400e', lineHeight: 1.5,
          }}>
            <strong>Simulation mode is on.</strong> The scheduler creates Reminder records and
            logs messages, but no SMS is sent. Set <code>AT_SIMULATE=False</code> in your
            environment variables to enable live sending.
          </div>
        )}
      </div>

      {/* Test SMS panel */}
      <div className="card">
        <div style={{ fontSize: '.68rem', fontWeight: 700, color: 'var(--teal-600)', textTransform: 'uppercase', letterSpacing: '.09em', marginBottom: '.75rem' }}>
          Send Test SMS
        </div>
        <p style={{ fontSize: '.83rem', color: 'var(--gray-500)', marginBottom: '1rem', lineHeight: 1.5 }}>
          Sends a live test message via Africa's Talking, bypassing simulation mode.
          Use this to verify your credentials and confirm the gateway is reachable.
        </p>
        <div style={{ display: 'flex', gap: '.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 200 }}>
            <label className="form-label">Phone number (E.164 format)</label>
            <input
              type="tel"
              className="form-control"
              placeholder="+256772000001"
              value={testPhone}
              onChange={e => { setTestPhone(e.target.value); setTestResult(null) }}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={() => testMut.mutate()}
            disabled={!testPhone.trim() || testMut.isPending}
            style={{ flexShrink: 0 }}
          >
            {testMut.isPending ? 'Sending...' : 'Send Test'}
          </button>
        </div>

        {testResult && (
          <div style={{
            marginTop: '.9rem', padding: '.65rem .9rem', borderRadius: 'var(--radius-sm)', border: '1px solid',
            borderColor: testResult.success
              ? (dark ? '#14532d' : '#86efac') : (dark ? '#7f1d1d' : '#fca5a5'),
            background: testResult.success
              ? (dark ? '#0f2d1f' : '#f0fdf4') : (dark ? '#3b1212' : '#fef2f2'),
            fontSize: '.83rem', lineHeight: 1.5,
          }}>
            {testResult.success ? (
              <div style={{ color: dark ? '#4ade80' : 'var(--green-700)' }}>
                <strong>Sent successfully.</strong>
                {testResult.message_id && <> Message ID: <code>{testResult.message_id}</code>.</>}
                {testResult.cost && <> Cost: {testResult.cost}.</>}
              </div>
            ) : (
              <div style={{ color: dark ? '#fca5a5' : 'var(--red-700)' }}>
                <strong>Failed.</strong> {testResult.error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Theme preview (miniature dashboard) ──────────────────────────────────────
function ThemePreview({ variant }) {
  const p = variant === 'dark'
    ? { bg: '#0F172A', side: '#0D1B2A', card: '#1E293B', border: '#334155', bar: '#1E293B' }
    : { bg: '#F8FAFC', side: '#0F6E56', card: '#FFFFFF', border: '#E2E8F0', bar: '#FFFFFF' }
  return (
    <div style={{
      display: 'flex', height: 100, borderRadius: 6, overflow: 'hidden',
      border: `1px solid ${p.border}`,
    }}>
      <div style={{
        width: 28, background: p.side, padding: '8px 5px',
        display: 'flex', flexDirection: 'column', gap: 5,
      }}>
        <div style={{ height: 6, background: 'rgba(255,255,255,.85)', borderRadius: 2 }} />
        <div style={{ height: 5, background: 'rgba(255,255,255,.4)', borderRadius: 2 }} />
        <div style={{ height: 5, background: 'rgba(255,255,255,.4)', borderRadius: 2 }} />
        <div style={{ height: 5, background: 'rgba(255,255,255,.4)', borderRadius: 2 }} />
      </div>
      <div style={{
        flex: 1, background: p.bg, padding: 8,
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div style={{ height: 11, background: p.bar, border: `1px solid ${p.border}`, borderRadius: 3 }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ flex: 1, height: 26, background: p.card, border: `1px solid ${p.border}`, borderRadius: 3 }} />
          <div style={{ flex: 1, height: 26, background: p.card, border: `1px solid ${p.border}`, borderRadius: 3 }} />
        </div>
        <div style={{ flex: 1, background: p.card, border: `1px solid ${p.border}`, borderRadius: 3 }} />
      </div>
    </div>
  )
}

// ── Preferences tab (Appearance) ─────────────────────────────────────────────
function PreferencesTab() {
  const { theme, resolved, setTheme } = useTheme()
  const [toast, setToast] = useState('')

  const cards = [
    { id: 'light',  label: 'Light',  desc: 'Bright theme, best in daylight' },
    { id: 'dark',   label: 'Dark',   desc: 'Easier on the eyes in low light' },
    { id: 'system', label: 'System', desc: 'Follows your device setting' },
  ]

  function pick(id) {
    if (id === theme) return
    setTheme(id)
    const label = id.charAt(0).toUpperCase() + id.slice(1)
    setToast(`Theme updated to ${label} mode`)
    setTimeout(() => setToast(''), 2800)
  }

  return (
    <div>
      <div style={{
        fontSize: '.7rem', fontWeight: 700, color: 'var(--teal-600)',
        textTransform: 'uppercase', letterSpacing: '.09em', marginBottom: '.4rem',
      }}>
        Appearance
      </div>
      <p style={{ fontSize: '.85rem', color: 'var(--gray-500)', marginBottom: '1.25rem' }}>
        Choose how ROP Tracker looks. Your choice is saved to your account and applied on every device.
      </p>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        {cards.map(c => {
          const active = theme === c.id
          const previewVariant = c.id === 'system' ? resolved : c.id
          return (
            <button
              key={c.id}
              type="button"
              className={`theme-card${active ? ' active' : ''}`}
              onClick={() => pick(c.id)}
            >
              <ThemePreview variant={previewVariant} />
              <div className="theme-card-label">
                <span>{c.label}</span>
                {active && (
                  <span className="theme-card-check" aria-label="Selected">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                      stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                )}
              </div>
              <div className="theme-card-desc">{c.desc}</div>
            </button>
          )
        })}
      </div>

      {toast && <div className="theme-toast">{toast}</div>}
    </div>
  )
}

// ── Main Settings page ───────────────────────────────────────────────────────
export default function SettingsPage() {
  const { user } = useAuth()
  const isCentral = user?.role === 'central_coordinator'
  const isCoordinator = user?.role === 'hospital_coordinator' || user?.role === 'central_coordinator'
  const [tab, setTab] = useState('preferences')

  const tabs = [
    { key: 'preferences', label: 'Preferences' },
    ...(isCoordinator ? [{ key: 'users', label: 'Staff Accounts' }] : []),
    ...(isCentral ? [{ key: 'hospitals', label: 'Hospitals' }] : []),
    ...(isCoordinator ? [
      { key: 'templates', label: 'SMS Templates' },
      { key: 'gateway',   label: 'SMS Gateway' },
    ] : []),
  ]

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h2>Settings</h2>
          <p>{isCoordinator
            ? 'Manage your preferences, staff, hospitals, and SMS configuration'
            : 'Manage your personal preferences'}</p>
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
        {tab === 'preferences' && <PreferencesTab />}
        {tab === 'users'       && isCoordinator && <UsersTab />}
        {tab === 'hospitals'   && isCentral && <HospitalsTab />}
        {tab === 'templates'   && isCoordinator && <TemplatesTab />}
        {tab === 'gateway'     && isCoordinator && <GatewayTab />}
      </div>
    </div>
  )
}
