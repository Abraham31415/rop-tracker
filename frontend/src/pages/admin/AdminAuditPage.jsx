import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAuditLogs } from '../../services/adminApi'

const ACTION_COLORS = {
  CREATE:     { bg: '#14532D', color: '#4ADE80' },
  UPDATE:     { bg: '#1E3A5F', color: '#93C5FD' },
  DEACTIVATE: { bg: '#7F1D1D', color: '#FCA5A5' },
  ACTIVATE:   { bg: '#14532D', color: '#4ADE80' },
  DELETE:     { bg: '#7F1D1D', color: '#FCA5A5' },
  LOGIN:      { bg: '#2E1065', color: '#C4B5FD' },
}

const ENTITY_TYPES = ['', 'User', 'Baby', 'Hospital', 'Exam', 'Appointment']
const ACTION_TYPES = ['', 'CREATE', 'UPDATE', 'DEACTIVATE', 'ACTIVATE', 'DELETE', 'LOGIN']

const INPUT_STYLE = {
  padding: '.45rem .75rem', border: '1px solid #334155', borderRadius: 6,
  fontSize: '.85rem', background: '#0F172A', color: '#F1F5F9',
}

function ActionBadge({ action }) {
  const { bg, color } = ACTION_COLORS[action] || { bg: '#243044', color: '#94A3B8' }
  return (
    <span style={{ background: bg, color, padding: '.2rem .6rem', borderRadius: 99, fontSize: '.75rem', fontWeight: 600 }}>
      {action}
    </span>
  )
}

function formatDate(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleString('en-UG', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function AdminAuditPage() {
  const [filters, setFilters] = useState({ entity_type: '', action_type: '' })
  const [applied, setApplied] = useState({})

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['admin-audit', applied],
    queryFn: () => getAuditLogs({ ...applied, limit: 200 }),
  })

  function applyFilters() {
    const f = {}
    if (filters.entity_type) f.entity_type = filters.entity_type
    if (filters.action_type) f.action_type = filters.action_type
    setApplied(f)
  }

  function clearFilters() {
    setFilters({ entity_type: '', action_type: '' })
    setApplied({})
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 .25rem', fontSize: '1.25rem', fontWeight: 700, color: '#F1F5F9' }}>
        Audit Log
      </h1>
      <p style={{ margin: '0 0 1.5rem', fontSize: '.85rem', color: '#94A3B8' }}>
        All system actions performed by admin and clinical staff
      </p>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '.75rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={{ display: 'block', fontSize: '.75rem', color: '#94A3B8', marginBottom: '.3rem', fontWeight: 500 }}>Entity type</label>
          <select
            value={filters.entity_type}
            onChange={e => setFilters(f => ({ ...f, entity_type: e.target.value }))}
            style={INPUT_STYLE}
          >
            {ENTITY_TYPES.map(t => <option key={t} value={t}>{t || 'All types'}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '.75rem', color: '#94A3B8', marginBottom: '.3rem', fontWeight: 500 }}>Action</label>
          <select
            value={filters.action_type}
            onChange={e => setFilters(f => ({ ...f, action_type: e.target.value }))}
            style={INPUT_STYLE}
          >
            {ACTION_TYPES.map(t => <option key={t} value={t}>{t || 'All actions'}</option>)}
          </select>
        </div>
        <button
          onClick={applyFilters}
          style={{ padding: '.45rem 1rem', background: '#3B82F6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '.85rem', fontWeight: 500 }}
        >
          Filter
        </button>
        {Object.keys(applied).length > 0 && (
          <button
            onClick={clearFilters}
            style={{ padding: '.45rem 1rem', background: '#243044', color: '#CBD5E1', border: '1px solid #334155', borderRadius: 6, cursor: 'pointer', fontSize: '.85rem' }}
          >
            Clear
          </button>
        )}
      </div>

      {isLoading ? (
        <div style={{ color: '#94A3B8' }}>Loading...</div>
      ) : (
        <div style={{ background: '#1A2235', border: '1px solid #1E3A5F', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
            <thead>
              <tr style={{ background: '#141C30' }}>
                {['Time', 'Action', 'Entity', 'Performed by', 'Details', 'IP'].map(h => (
                  <th key={h} style={{ padding: '.65rem 1rem', textAlign: 'left', fontSize: '.72rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid #1E3A5F', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <tr key={log.id} style={{ borderBottom: i < logs.length - 1 ? '1px solid #1E3A5F' : 'none' }}>
                  <td style={{ padding: '.65rem 1rem', color: '#94A3B8', whiteSpace: 'nowrap', fontSize: '.8rem' }}>
                    {formatDate(log.created_at)}
                  </td>
                  <td style={{ padding: '.65rem 1rem' }}>
                    <ActionBadge action={log.action_type} />
                  </td>
                  <td style={{ padding: '.65rem 1rem', color: '#CBD5E1' }}>
                    <span style={{ fontWeight: 500 }}>{log.entity_type}</span>
                    {log.entity_id && (
                      <span style={{ color: '#64748B', fontSize: '.75rem', display: 'block' }}>
                        {log.entity_id.substring(0, 8)}...
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '.65rem 1rem' }}>
                    <div style={{ fontWeight: 500, color: '#F1F5F9' }}>{log.user_name}</div>
                    <div style={{ fontSize: '.75rem', color: '#94A3B8' }}>{log.user_role}</div>
                  </td>
                  <td style={{ padding: '.65rem 1rem', maxWidth: 240 }}>
                    {log.details ? (
                      <div style={{ fontSize: '.78rem', color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {Object.entries(log.details).map(([k, v]) => `${k}: ${v}`).join(' | ')}
                      </div>
                    ) : '-'}
                  </td>
                  <td style={{ padding: '.65rem 1rem', color: '#64748B', fontSize: '.78rem' }}>
                    {log.ip_address || '-'}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#64748B' }}>
                    No audit entries found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
