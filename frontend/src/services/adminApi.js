import axios from 'axios'

// All admin API requests use cookies for auth (HttpOnly, set by server).
// baseURL must point at the backend (same VITE_API_URL the clinical app uses);
// an empty baseURL would hit the Vercel static host instead of the API.
const adminApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  withCredentials: true,   // send the HttpOnly admin_session cookie automatically
})

// Redirect to login on a 401 from a protected endpoint (session expired).
// Two exclusions prevent redirect loops / blinking:
//  - the session check (/me): a 401 here is normal and handled by AdminAuthContext;
//    redirecting would fight the router and cause flicker.
//  - the login page itself: never redirect a page to itself.
adminApi.interceptors.response.use(
  (r) => r,
  (err) => {
    const url = err.config?.url || ''
    const isSessionCheck = url.includes('/sys-mgmt/me')
    if (
      err.response?.status === 401 &&
      !isSessionCheck &&
      !window.location.pathname.startsWith('/sys-mgmt/login')
    ) {
      window.location.href = '/sys-mgmt/login'
    }
    return Promise.reject(err)
  }
)

// ── Authentication ────────────────────────────────────────────────────────────
export const adminLoginStep1 = (email, password) =>
  adminApi.post('/api/sys-mgmt/login', { email, password }).then(r => r.data)

export const adminLoginTotp = (totp_token, code) =>
  adminApi.post('/api/sys-mgmt/login/totp', { totp_token, code }).then(r => r.data)

export const getAdminMe = () =>
  adminApi.get('/api/sys-mgmt/me').then(r => r.data)

export const adminLogout = () =>
  adminApi.post('/api/sys-mgmt/logout').then(r => r.data)

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const getAdminDashboard = () =>
  adminApi.get('/api/sys-mgmt/dashboard').then(r => r.data)

// ── Coordinators ──────────────────────────────────────────────────────────────
export const listCoordinators = () =>
  adminApi.get('/api/sys-mgmt/coordinators').then(r => r.data)

export const createCoordinator = (data) =>
  adminApi.post('/api/sys-mgmt/coordinators', data).then(r => r.data)

export const deactivateCoordinator = (id) =>
  adminApi.patch(`/api/sys-mgmt/coordinators/${id}/deactivate`).then(r => r.data)

export const activateCoordinator = (id) =>
  adminApi.patch(`/api/sys-mgmt/coordinators/${id}/activate`).then(r => r.data)

// ── Audit log ─────────────────────────────────────────────────────────────────
export const getAuditLogs = (params) =>
  adminApi.get('/api/sys-mgmt/audit', { params }).then(r => r.data)

// ── Hospitals ─────────────────────────────────────────────────────────────────
export const listHospitals = () =>
  adminApi.get('/api/sys-mgmt/hospitals').then(r => r.data)

export const createHospital = (data) =>
  adminApi.post('/api/sys-mgmt/hospitals', data).then(r => r.data)

export const updateHospital = (id, data) =>
  adminApi.patch(`/api/sys-mgmt/hospitals/${id}`, data).then(r => r.data)

export const deactivateHospital = (id) =>
  adminApi.patch(`/api/sys-mgmt/hospitals/${id}/deactivate`).then(r => r.data)

export const activateHospital = (id) =>
  adminApi.patch(`/api/sys-mgmt/hospitals/${id}/activate`).then(r => r.data)

// ── Health monitoring ─────────────────────────────────────────────────────────
export const pingAdmin = () =>
  adminApi.get('/api/sys-mgmt/ping').then(r => r.data)

export const getAdminHealth = () =>
  adminApi.get('/api/sys-mgmt/health').then(r => r.data)

// Legacy named export kept for import compatibility
export const adminLogin = adminLoginStep1
