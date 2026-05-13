import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function IconEye() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 28, height: 28 }}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/dashboard')
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed. Check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  const fillDemo = (em) => { setEmail(em); setPassword('rop2024') }

  return (
    <div className="login-page">
      {/* Left panel */}
      <div className="login-left">
        <div style={{ maxWidth: 400, textAlign: 'center' }}>
          <div style={{
            width: 64, height: 64,
            background: 'rgba(255,255,255,.15)',
            borderRadius: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 1.5rem',
            backdropFilter: 'blur(4px)',
            border: '1px solid rgba(255,255,255,.2)',
          }}>
            <IconEye />
          </div>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-.03em', marginBottom: '.5rem' }}>
            ROP Tracker
          </h1>
          <p style={{ fontSize: '1.05rem', opacity: .75, lineHeight: 1.6, marginBottom: '2.5rem' }}>
            Retinopathy of Prematurity<br />Follow-up Network · Uganda
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', textAlign: 'left' }}>
            {[
              ['Track every premature baby', 'Never miss a follow-up exam'],
              ['Auto-scheduled appointments', 'Based on Zone, Stage & Plus disease'],
              ['SMS & WhatsApp reminders', 'In 5 Ugandan languages'],
            ].map(([title, sub]) => (
              <div key={title} style={{ display: 'flex', alignItems: 'flex-start', gap: '.75rem' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'rgba(255,255,255,.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, marginTop: 2,
                  border: '1px solid rgba(255,255,255,.25)',
                }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 14, height: 14 }}>
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '.9rem' }}>{title}</div>
                  <div style={{ opacity: .6, fontSize: '.8rem', marginTop: '.1rem' }}>{sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="login-right">
        <div className="login-card">
          {/* Mobile logo — hidden on desktop since left panel shows it */}
          <div className="login-mobile-brand">
            <div style={{
              width: 48, height: 48,
              background: 'linear-gradient(135deg, var(--teal-600), var(--teal-700))',
              borderRadius: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: '.75rem',
              boxShadow: 'var(--shadow-teal)',
              color: 'white',
            }}>
              <IconEye />
            </div>
            <div style={{ fontWeight: 800, fontSize: '1.15rem', color: 'var(--gray-900)', letterSpacing: '-.02em' }}>ROP Tracker</div>
            <div style={{ fontSize: '.75rem', color: 'var(--gray-500)', marginTop: '.2rem' }}>Uganda Network</div>
          </div>

          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--gray-900)', letterSpacing: '-.02em' }}>
              Welcome back
            </h2>
            <p className="subtitle">Sign in to your account to continue</p>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@hospital.ug"
                required
                autoFocus
                autoComplete="email"
              />
            </div>
            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-lg"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={loading}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div style={{ marginTop: '1.75rem' }}>
            <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.75rem' }}>
              Demo accounts - click to fill
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
              {[
                ['central@rop.ug', 'Central Coordinator'],
                ['coordinator.mulago@rop.ug', 'Hospital Coordinator'],
                ['ophth.mulago@rop.ug', 'Ophthalmologist'],
                ['nurse.mulago@rop.ug', 'NICU Nurse'],
              ].map(([em, role]) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => fillDemo(em)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '.5rem .75rem',
                    background: 'var(--gray-50)',
                    border: '1px solid var(--gray-200)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    transition: 'all .15s',
                    textAlign: 'left',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--teal-50)'; e.currentTarget.style.borderColor = 'var(--teal-400)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--gray-50)'; e.currentTarget.style.borderColor = 'var(--gray-200)' }}
                >
                  <span style={{ fontSize: '.78rem', color: 'var(--gray-700)', fontFamily: 'var(--font-mono)' }}>{em}</span>
                  <span style={{ fontSize: '.72rem', color: 'var(--gray-400)', flexShrink: 0, marginLeft: '.5rem' }}>{role}</span>
                </button>
              ))}
            </div>
            <p style={{ fontSize: '.72rem', color: 'var(--gray-400)', marginTop: '.5rem', textAlign: 'center' }}>
              All demo passwords: <code style={{ background: 'var(--gray-100)', padding: '.1rem .3rem', borderRadius: 4 }}>rop2024</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
