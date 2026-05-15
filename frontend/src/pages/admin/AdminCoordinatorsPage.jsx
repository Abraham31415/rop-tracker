import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listCoordinators, createCoordinator,
  deactivateCoordinator, activateCoordinator, listHospitals,
} from '../../services/adminApi'

const ROLE_LABELS = {
  central_coordinator: 'Central Coordinator',
  hospital_coordinator: 'Hospital Coordinator',
  ophthalmologist: 'Ophthalmologist',
  nicu_nurse: 'NICU Nurse',
}

// Every role except central coordinator belongs to a specific hospital
const ROLES_NEEDING_HOSPITAL = ['hospital_coordinator', 'ophthalmologist', 'nicu_nurse']

function ConfirmDialog({ message, confirmLabel, confirmWord, onConfirm, onCancel, danger }) {
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
        width: '100%', maxWidth: 420, boxShadow: '0 20px 40px rgba(0,0,0,.2)',
      }}>
        <p style={{ margin: '0 0 1rem', fontSize: '.95rem', color: '#1E293B' }}>{message}</p>
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
              padding: '.5rem 1rem', borderRadius: 6, border: 'none', cursor: ready ? 'pointer' : 'not-allowed',
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

export default function AdminCoordinatorsPage() {
  const qc = useQueryClient()
  const { data: coordinators = [], isLoading } = useQuery({
    queryKey: ['admin-coordinators'],
    queryFn: listCoordinators,
  })
  const { data: hospitals = [] } = useQuery({
    queryKey: ['admin-hospitals'],
    queryFn: listHospitals,
  })

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ email: '', full_name: '', password: '', role: 'central_coordinator', hospital_id: '' })
  const [formErr, setFormErr] = useState('')

  const [confirm, setConfirm] = useState(null) // { action, user }

  const createMut = useMutation({
    mutationFn: createCoordinator,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-coordinators'] })
      setShowForm(false)
      setForm({ email: '', full_name: '', password: '', role: 'central_coordinator', hospital_id: '' })
      setFormErr('')
    },
    onError: (e) => setFormErr(e.response?.data?.detail || 'Failed to create coordinator'),
  })

  const deactivateMut = useMutation({
    mutationFn: (id) => deactivateCoordinator(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-coordinators'] }); setConfirm(null) },
  })

  const activateMut = useMutation({
    mutationFn: (id) => activateCoordinator(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-coordinators'] }); setConfirm(null) },
  })

  if (isLoading) return <div style={{ color: '#64748B' }}>Loading…</div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: '0 0 .25rem', fontSize: '1.25rem', fontWeight: 700, color: '#0F172A' }}>
            Coordinators
          </h1>
          <p style={{ margin: 0, fontSize: '.85rem', color: '#64748B' }}>
            {coordinators.length} coordinator accounts
          </p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          style={{
            padding: '.5rem 1rem', background: '#3B82F6', color: '#fff',
            border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '.85rem', fontWeight: 600,
          }}
        >
          {showForm ? 'Cancel' : '+ Add Account'}
        </button>
      </div>

      {showForm && (
        <div style={{
          background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
          padding: '1.5rem', marginBottom: '1.5rem',
        }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600, color: '#0F172A' }}>
            New Account
          </h3>
          {formErr && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C', borderRadius: 6, padding: '.65rem .9rem', marginBottom: '.75rem', fontSize: '.85rem' }}>
              {formErr}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', marginBottom: '.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '.8rem', color: '#64748B', marginBottom: '.3rem' }}>Full Name</label>
              <input className="form-input" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Dr. Jane Nakamya" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '.8rem', color: '#64748B', marginBottom: '.3rem' }}>Email</label>
              <input className="form-input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@hospital.ug" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '.8rem', color: '#64748B', marginBottom: '.3rem' }}>Password</label>
              <input className="form-input" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Temporary password" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '.8rem', color: '#64748B', marginBottom: '.3rem' }}>Role</label>
              <select className="form-input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {ROLES_NEEDING_HOSPITAL.includes(form.role) && (
              <div>
                <label style={{ display: 'block', fontSize: '.8rem', color: '#64748B', marginBottom: '.3rem' }}>Hospital</label>
                <select className="form-input" value={form.hospital_id} onChange={e => setForm(f => ({ ...f, hospital_id: e.target.value }))}>
                  <option value="">Select hospital…</option>
                  {hospitals.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <button
            onClick={() => createMut.mutate({
              ...form,
              hospital_id: form.hospital_id || undefined,
            })}
            disabled={createMut.isPending}
            style={{ padding: '.55rem 1.25rem', background: '#3B82F6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '.85rem', fontWeight: 600 }}
          >
            {createMut.isPending ? 'Creating…' : 'Create Account'}
          </button>
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.875rem' }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              {['Name', 'Email', 'Role', 'Hospital', 'Status', 'Actions'].map(h => (
                <th key={h} style={{ padding: '.75rem 1rem', textAlign: 'left', fontSize: '.75rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid #E2E8F0' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coordinators.map((u, i) => (
              <tr key={u.id} style={{ borderBottom: i < coordinators.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                <td style={{ padding: '.75rem 1rem', fontWeight: 500, color: '#0F172A' }}>{u.full_name}</td>
                <td style={{ padding: '.75rem 1rem', color: '#475569' }}>{u.email}</td>
                <td style={{ padding: '.75rem 1rem' }}>
                  <span style={{
                    background: u.role === 'central_coordinator' ? '#EFF6FF' : '#F0FDF4',
                    color: u.role === 'central_coordinator' ? '#1D4ED8' : '#15803D',
                    padding: '.2rem .6rem', borderRadius: 99, fontSize: '.75rem', fontWeight: 500,
                  }}>
                    {ROLE_LABELS[u.role] || u.role}
                  </span>
                </td>
                <td style={{ padding: '.75rem 1rem', color: '#64748B' }}>{u.hospital_name || '—'}</td>
                <td style={{ padding: '.75rem 1rem' }}>
                  <span style={{
                    background: u.is_active ? '#F0FDF4' : '#FFF7ED',
                    color: u.is_active ? '#15803D' : '#C2410C',
                    padding: '.2rem .6rem', borderRadius: 99, fontSize: '.75rem', fontWeight: 500,
                  }}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ padding: '.75rem 1rem' }}>
                  {u.is_active ? (
                    <button
                      onClick={() => setConfirm({ action: 'deactivate', user: u })}
                      style={{ padding: '.3rem .75rem', background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: 6, cursor: 'pointer', fontSize: '.8rem', fontWeight: 500 }}
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirm({ action: 'activate', user: u })}
                      style={{ padding: '.3rem .75rem', background: '#F0FDF4', color: '#15803D', border: '1px solid #86EFAC', borderRadius: 6, cursor: 'pointer', fontSize: '.8rem', fontWeight: 500 }}
                    >
                      Reactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {coordinators.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#94A3B8' }}>
                  No coordinators found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {confirm && confirm.action === 'deactivate' && (
        <ConfirmDialog
          message={`Deactivate ${confirm.user.full_name}? They will lose access to the clinical app immediately.`}
          confirmLabel="Deactivate"
          confirmWord="DEACTIVATE"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => deactivateMut.mutate(confirm.user.id)}
        />
      )}

      {confirm && confirm.action === 'activate' && (
        <ConfirmDialog
          message={`Reactivate ${confirm.user.full_name}? They will regain access to the clinical app.`}
          confirmLabel="Reactivate"
          onCancel={() => setConfirm(null)}
          onConfirm={() => activateMut.mutate(confirm.user.id)}
        />
      )}
    </div>
  )
}
