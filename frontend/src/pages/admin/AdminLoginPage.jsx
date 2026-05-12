import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminLogin } from '../../services/adminApi'
import { useAdminAuth } from '../../contexts/AdminAuthContext'

export default function AdminLoginPage() {
  const { login } = useAdminAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await adminLogin(form.email, form.password)
      login(data.access_token)
      navigate('/admin/dashboard')
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0F172A',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        background: '#1E293B',
        borderRadius: 12,
        padding: '2.5rem',
        width: '100%',
        maxWidth: 380,
        boxShadow: '0 25px 50px rgba(0,0,0,.5)',
      }}>
        <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '.7rem', fontWeight: 700, letterSpacing: '.15em', color: '#64748B', textTransform: 'uppercase', marginBottom: '.5rem' }}>
            ROP Tracker Uganda
          </div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#F1F5F9' }}>
            System Administration
          </h1>
        </div>

        {error && (
          <div style={{
            background: '#450A0A',
            border: '1px solid #991B1B',
            color: '#FCA5A5',
            borderRadius: 6,
            padding: '.75rem 1rem',
            marginBottom: '1rem',
            fontSize: '.85rem',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '.4rem', fontSize: '.8rem', color: '#94A3B8', fontWeight: 500 }}>
              Admin email
            </label>
            <input
              type="email"
              autoComplete="username"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              required
              style={{
                width: '100%',
                padding: '.65rem .85rem',
                background: '#0F172A',
                border: '1px solid #334155',
                borderRadius: 6,
                color: '#F1F5F9',
                fontSize: '.9rem',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '.4rem', fontSize: '.8rem', color: '#94A3B8', fontWeight: 500 }}>
              Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              required
              style={{
                width: '100%',
                padding: '.65rem .85rem',
                background: '#0F172A',
                border: '1px solid #334155',
                borderRadius: 6,
                color: '#F1F5F9',
                fontSize: '.9rem',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '.75rem',
              background: loading ? '#334155' : '#3B82F6',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: '.9rem',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Signing in…' : 'Sign in to Admin'}
          </button>
        </form>

        <p style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '.75rem', color: '#475569' }}>
          This panel is for system administrators only.{' '}
          <a href="/login" style={{ color: '#64748B' }}>Go to clinical app</a>
        </p>
      </div>
    </div>
  )
}
