import axios from 'axios'

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/' })

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api

// ── Baby endpoints ────────────────────────────────────────────────────────────
export const enrollBaby = (data) => api.post('/api/babies/', data).then(r => r.data)
export const listBabies = (params) => api.get('/api/babies/', { params }).then(r => r.data)
export const getBaby = (id) => api.get(`/api/babies/${id}`).then(r => r.data)
export const updateBaby = (id, data) => api.patch(`/api/babies/${id}`, data).then(r => r.data)
export const getDashboard = (params) => api.get('/api/babies/dashboard/urgency', { params }).then(r => r.data)

// ── Exam endpoints ────────────────────────────────────────────────────────────
export const recordExam = (data) => api.post('/api/exams/', data).then(r => r.data)
export const listExams = (babyId) => api.get(`/api/exams/baby/${babyId}`).then(r => r.data)

// ── Hospital endpoints ────────────────────────────────────────────────────────
export const listHospitals = () => api.get('/api/hospitals/').then(r => r.data)

// ── Network overview (central coordinator) ───────────────────────────────────
export const getNetworkOverview = () => api.get('/api/network/overview').then(r => r.data)

// ── Reminders ────────────────────────────────────────────────────────────────
export const listReminders = (params) => api.get('/api/reminders/', { params }).then(r => r.data)
export const previewReminder = (babyId, trigger) => api.get(`/api/reminders/preview/${babyId}`, { params: { trigger } }).then(r => r.data)
export const sendReminderNow = (babyId, trigger) => api.post(`/api/reminders/send/${babyId}`, null, { params: { trigger } }).then(r => r.data)
export const logPhoneCall = (babyId, outcome, notes) => api.post(`/api/reminders/log-call/${babyId}`, { outcome, notes }).then(r => r.data)
export const retrySMS = (reminderId) => api.post(`/api/reminders/${reminderId}/retry`).then(r => r.data)

// ── Alerts ────────────────────────────────────────────────────────────────────
export const getAlerts = () => api.get('/api/alerts/').then(r => r.data)
export const getAlertCount = () => api.get('/api/alerts/count').then(r => r.data)
export const dismissAlert = (id) => api.patch(`/api/alerts/${id}/dismiss`).then(r => r.data)

// ── Search ────────────────────────────────────────────────────────────────────
export const searchBabies = (q) => api.get('/api/babies/search', { params: { q } }).then(r => r.data)

// ── Notifications ─────────────────────────────────────────────────────────────
export const getNotifications = () => api.get('/api/notifications/').then(r => r.data)

// ── Reports ───────────────────────────────────────────────────────────────────
export const getReports = () => api.get('/api/reports/summary').then(r => r.data)
export const getPopulationReport = (params) => api.get('/api/reports/population', { params }).then(r => r.data)
export const getOutcomesReport = (params) => api.get('/api/reports/outcomes', { params }).then(r => r.data)
export const downloadResearchCSV = (params) => api.get('/api/reports/research-export', { params, responseType: 'blob' }).then(r => r.data)

// ── Outcomes ──────────────────────────────────────────────────────────────────
export const getOutcome = (babyId) => api.get(`/api/outcomes/${babyId}`).then(r => r.data)
export const upsertOutcome = (babyId, data) => api.put(`/api/outcomes/${babyId}`, data).then(r => r.data)

// ── Appointments ──────────────────────────────────────────────────────────────
export const listAppointments = (babyId) => api.get(`/api/appointments/baby/${babyId}`).then(r => r.data)
export const listAllAppointments = (params) => api.get('/api/appointments/', { params }).then(r => r.data)
export const markAppointmentAttended = (appointmentId, notes) =>
  api.patch(`/api/appointments/${appointmentId}/attend`, { notes: notes || null }).then(r => r.data)
export const rescheduleAppointment = (appointmentId, newDate, notes) =>
  api.patch(`/api/appointments/${appointmentId}/reschedule`, { new_date: newDate, notes: notes || null }).then(r => r.data)

// ── Referrals ─────────────────────────────────────────────────────────────────
export const listReferrals = (babyId) => api.get(`/api/referrals/baby/${babyId}`).then(r => r.data)
export const createReferral = (babyId, data) => api.post(`/api/referrals/baby/${babyId}`, data).then(r => r.data)
export const updateReferralStatus = (referralId, data) => api.patch(`/api/referrals/${referralId}`, data).then(r => r.data)

// ── Discharge / reactivate ────────────────────────────────────────────────────
export const dischargeBaby = (id, discharge_reason, notes) =>
  api.post(`/api/babies/${id}/discharge`, { discharge_reason, notes }).then(r => r.data)
export const reactivateBaby = (id) =>
  api.post(`/api/babies/${id}/reactivate`).then(r => r.data)

// ── Dilation ──────────────────────────────────────────────────────────────────
export const updateDilation = (babyId, dilation_status) =>
  api.patch(`/api/babies/${babyId}/dilation`, { dilation_status }).then(r => r.data)

// ── Contact logs ──────────────────────────────────────────────────────────────
export const getContactLogs = (babyId) => api.get(`/api/contact-logs/${babyId}`).then(r => r.data)
export const addContactNote = (babyId, message) =>
  api.post(`/api/contact-logs/${babyId}/note`, { message }).then(r => r.data)

// ── Screening requests ────────────────────────────────────────────────────────
export const createScreeningRequest = (baby_id, notes) =>
  api.post('/api/screening-requests/', { baby_id, notes }).then(r => r.data)
export const getPendingScreeningRequests = () =>
  api.get('/api/screening-requests/pending').then(r => r.data)
export const getActiveScreeningRequest = (babyId) =>
  api.get(`/api/screening-requests/baby/${babyId}`).then(r => r.data)
export const claimScreeningRequest = (id) =>
  api.post(`/api/screening-requests/${id}/claim`).then(r => r.data)
export const completeScreeningRequest = (id) =>
  api.post(`/api/screening-requests/${id}/complete`).then(r => r.data)

// ── Ophthalmologist hospital list ─────────────────────────────────────────────
export const getMyHospitals = () => api.get('/api/exams/my-hospitals').then(r => r.data)

// ── Users ─────────────────────────────────────────────────────────────────────
export const listUsers = () => api.get('/api/users/').then(r => r.data)
export const createUser = (data) => api.post('/api/users/', data).then(r => r.data)
export const deactivateUser = (id) => api.patch(`/api/users/${id}/deactivate`).then(r => r.data)
export const activateUser = (id) => api.patch(`/api/users/${id}/activate`).then(r => r.data)

// ── SMS Gateway ───────────────────────────────────────────────────────────────
export const getGatewayStatus = () => api.get('/api/reminders/gateway-status').then(r => r.data)
export const sendTestSms = (phone) => api.post('/api/reminders/test-sms', null, { params: { phone } }).then(r => r.data)

// ── Analytics (central coordinator) ──────────────────────────────────────────
export const getScreeningVolume = (params) => api.get('/api/analytics/screening-volume', { params }).then(r => r.data)
export const getLtfuRate        = (params) => api.get('/api/analytics/ltfu-rate', { params }).then(r => r.data)
export const getAtRiskTrend     = (params) => api.get('/api/analytics/at-risk-trend', { params }).then(r => r.data)
export const getAtRiskBabies    = ()       => api.get('/api/analytics/at-risk-babies').then(r => r.data)
export const getLtfuBabies      = (params) => api.get('/api/analytics/ltfu-babies', { params }).then(r => r.data)

// ── SMS Templates ─────────────────────────────────────────────────────────────
export const getTemplates = () => api.get('/api/templates/').then(r => r.data)
export const updateTemplate = (language, trigger, body) =>
  api.put(`/api/templates/${language}/${trigger}`, { body }).then(r => r.data)
export const resetTemplate = (language, trigger) =>
  api.delete(`/api/templates/${language}/${trigger}`).then(r => r.data)
