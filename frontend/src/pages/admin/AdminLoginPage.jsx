import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { adminLoginStep1, adminLoginTotp } from '../../services/adminApi'
import { useAdminAuth } from '../../contexts/AdminAuthContext'

const INPUT_STYLE = {
  width: '100%',
  padding: '.65rem .85rem',
  background: '#0F172A',
  border: '1px solid #334155',
  borderRadius: 6,
  color: '#F1F5F9',
  fontSize: '.9rem',
  boxSizing: 'border-box',
  outline: 'none',
}

const LABEL_STYLE = {
  display: 'block',
  marginBottom: '.4rem',
  fontSize: '.8rem',
  color: '#94A3B8',
  fontWeight: 500,
}

export default function AdminLoginPage() {
  const { login } = useAdminAuth()
  const navigate = useNavigate()

  // Step 1 state
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')

  // Step tracking
  const [step,       setStep]       = useState(1)   // 1 = credentials, 2 = TOTP
  const [totpToken,  setTotpToken]  = useState('')
  const [setupMode,  setSetupMode]  = useState(false)
  const [qrDataUrl,  setQrDataUrl]  = useState('')
  const [rawSecret,  setRawSecret]  = useState('')
  const [qrUri,      setQrUri]      = useState('')
  const [code,       setCode]       = useState('')

  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  const codeRef = useRef(null)

  // Auto-focus TOTP input when we reach step 2
  useEffect(() => {
    if (step === 2) codeRef.current?.focus()
  }, [step])

  // Render QR code to canvas data URL whenever qrUri changes
  useEffect(() => {
    if (!qrUri) return
    QRCode.toDataURL(qrUri, { width: 200, margin: 2, color: { dark: '#000', light: '#fff' } })
      .then(url => setQrDataUrl(url))
      .catch(() => setQrDataUrl(''))
  }, [qrUri])

  async function handleStep1(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await adminLoginStep1(email, password)
      setTotpToken(data.totp_token)
      setSetupMode(data.setup_required || false)
      if (data.qr_uri) {
        setQrUri(data.qr_uri)
        setRawSecret(data.totp_secret_raw || '')
      }
      setStep(2)
    } catch (err) {
      const detail = err.response?.data?.detail || 'Invalid credentials'
      setError(detail)
    } finally {
      setLoading(false)
    }
  }

  async function handleStep2(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await adminLoginTotp(totpToken, code)
      login()
      navigate('/sys-mgmt/dashboard')
    } catch (err) {
      const detail = err.response?.data?.detail || 'Invalid credentials'
      setError(detail)
      setCode('')
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
      padding: '1rem',
    }}>
      <div style={{
        background: '#1E293B',
        borderRadius: 12,
        padding: '2.5rem',
        width: '100%',
        maxWidth: step === 2 && setupMode ? 440 : 380,
        boxShadow: '0 25px 50px rgba(0,0,0,.5)',
      }}>
        {/* Header */}
        <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '.7rem', fontWeight: 700, letterSpacing: '.15em', color: '#64748B', textTransform: 'uppercase', marginBottom: '.5rem' }}>
            ROP Tracker Uganda
          </div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#F1F5F9' }}>
            System Administration
          </h1>
          {step === 2 && (
            <p style={{ margin: '.5rem 0 0', fontSize: '.8rem', color: '#64748B' }}>
              {setupMode ? 'Set up two-factor authentication' : 'Enter your authenticator code'}
            </p>
          )}
        </div>

        {/* Error */}
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

        {/* Step 1: email + password */}
        {step === 1 && (
          <form onSubmit={handleStep1}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={LABEL_STYLE}>Admin email</label>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={LABEL_STYLE}>Password</label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                style={INPUT_STYLE}
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
              {loading ? 'Verifying...' : 'Continue'}
            </button>
          </form>
        )}

        {/* Step 2: TOTP */}
        {step === 2 && (
          <form onSubmit={handleStep2}>
            {/* Setup mode: show QR code + instructions */}
            {setupMode && (
              <div style={{
                background: '#0F172A',
                border: '1px solid #334155',
                borderRadius: 8,
                padding: '1.25rem',
                marginBottom: '1.5rem',
              }}>
                <p style={{ margin: '0 0 .75rem', fontSize: '.82rem', color: '#CBD5E1', lineHeight: 1.6 }}>
                  Scan this QR code with <strong style={{ color: '#F1F5F9' }}>Google Authenticator</strong> or{' '}
                  <strong style={{ color: '#F1F5F9' }}>Authy</strong> to set up two-factor authentication.
                  You will need this every time you log in.
                </p>
                {qrDataUrl && (
                  <div style={{ textAlign: 'center', margin: '.75rem 0' }}>
                    <img
                      src={qrDataUrl}
                      alt="TOTP QR code"
                      style={{ borderRadius: 6, background: '#fff', padding: 4 }}
                    />
                  </div>
                )}
                {rawSecret && (
                  <div style={{ marginTop: '.75rem' }}>
                    <p style={{ margin: '0 0 .35rem', fontSize: '.75rem', color: '#64748B' }}>
                      Or enter this key manually:
                    </p>
                    <code style={{
                      display: 'block',
                      background: '#1E293B',
                      border: '1px solid #334155',
                      borderRadius: 4,
                      padding: '.4rem .65rem',
                      fontSize: '.78rem',
                      color: '#93C5FD',
                      wordBreak: 'break-all',
                      letterSpacing: '.05em',
                    }}>
                      {rawSecret}
                    </code>
                  </div>
                )}
                <div style={{
                  marginTop: '1rem',
                  background: '#1E293B',
                  border: '1px solid #F59E0B',
                  borderRadius: 6,
                  padding: '.65rem .85rem',
                  fontSize: '.75rem',
                  color: '#FCD34D',
                  lineHeight: 1.5,
                }}>
                  <strong>After scanning:</strong> copy the key above and save it as{' '}
                  <code style={{ color: '#FCA5A5' }}>ADMIN_TOTP_SECRET</code> in your environment variables,
                  then restart the server. You will only see this once.
                </div>
              </div>
            )}

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={LABEL_STYLE}>
                {setupMode ? 'Enter the 6-digit code from your authenticator app to confirm setup' : '6-digit authenticator code'}
              </label>
              <input
                ref={codeRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                style={{
                  ...INPUT_STYLE,
                  letterSpacing: '.35em',
                  fontSize: '1.4rem',
                  textAlign: 'center',
                  fontWeight: 700,
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading || code.length < 6}
              style={{
                width: '100%',
                padding: '.75rem',
                background: loading || code.length < 6 ? '#334155' : '#3B82F6',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: '.9rem',
                fontWeight: 600,
                cursor: loading || code.length < 6 ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Verifying...' : 'Sign in'}
            </button>

            <button
              type="button"
              onClick={() => { setStep(1); setError(''); setCode('') }}
              style={{
                width: '100%',
                marginTop: '.5rem',
                padding: '.5rem',
                background: 'transparent',
                border: 'none',
                color: '#64748B',
                fontSize: '.8rem',
                cursor: 'pointer',
              }}
            >
              Back
            </button>
          </form>
        )}

        <p style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '.75rem', color: '#475569' }}>
          This panel is for system administrators only.{' '}
          <a href="/login" style={{ color: '#64748B' }}>Go to clinical app</a>
        </p>
      </div>
    </div>
  )
}
