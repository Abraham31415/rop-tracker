import axios from 'axios'

const adminApi = axios.create({ baseURL: '' })

adminApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

adminApi.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('admin_token')
      window.location.href = '/admin/login'
    }
    return Promise.reject(err)
  }
)

export const adminLogin = (email, password) =>
  adminApi.post('/api/admin/login', { email, password }).then(r => r.data)

export const getAdminDashboard = () =>
  adminApi.get('/api/admin/dashboard').then(r => r.data)

export const listCoordinators = () =>
  adminApi.get('/api/admin/coordinators').then(r => r.data)

export const createCoordinator = (data) =>
  adminApi.post('/api/admin/coordinators', data).then(r => r.data)

export const deactivateCoordinator = (id) =>
  adminApi.patch(`/api/admin/coordinators/${id}/deactivate`).then(r => r.data)

export const activateCoordinator = (id) =>
  adminApi.patch(`/api/admin/coordinators/${id}/activate`).then(r => r.data)

export const getAuditLogs = (params) =>
  adminApi.get('/api/admin/audit', { params }).then(r => r.data)
