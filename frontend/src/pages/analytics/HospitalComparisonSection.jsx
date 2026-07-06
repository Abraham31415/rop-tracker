import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { getHospitalComparison } from '../../services/api'
import { SectionHeading, rateColor } from './shared'

const COLUMNS = [
  { key: 'name', label: 'Hospital' },
  { key: 'enrolled', label: 'Enrolled' },
  { key: 'exams', label: 'Exams' },
  { key: 'ltfu_rate', label: 'LTFU Rate' },
  { key: 'treatment_rate', label: 'Treatment Rate' },
  { key: 'avg_days_to_first_exam', label: 'Avg Days to 1st Exam' },
  { key: 'sms_delivery_rate', label: 'SMS Delivery' },
  { key: 'last_activity', label: 'Last Activity' },
]

export default function HospitalComparisonSection({ fromDate, toDate, onSelectHospital }) {
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState('asc')

  const { data, isLoading } = useQuery({
    queryKey: ['analytics-hospital-comparison', fromDate, toDate],
    queryFn: () => getHospitalComparison({ ...(fromDate ? { from_date: fromDate, to_date: toDate } : {}) }),
  })

  const rows = data?.hospitals ?? []

  const sorted = useMemo(() => {
    const list = [...rows]
    list.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey]
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase() }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return list
  }, [rows, sortKey, sortDir])

  const toggleSort = (key) => {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  return (
    <>
      <SectionHeading title="Network Comparison" sub="Click a column to sort, click a hospital to filter the whole page to it" />
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: '2rem', display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--gray-400)', fontSize: '.85rem' }}>No hospitals recorded yet</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
              <thead>
                <tr style={{ background: 'var(--gray-50)' }}>
                  {COLUMNS.map(c => (
                    <th
                      key={c.key}
                      onClick={() => toggleSort(c.key)}
                      style={{ padding: '.6rem .9rem', textAlign: 'left', fontWeight: 600, color: 'var(--gray-500)', fontSize: '.75rem', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
                    >
                      {c.label}{sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((h, i) => (
                  <tr key={h.id} style={{ borderTop: '1px solid var(--gray-100)', background: i % 2 ? 'var(--gray-50)' : 'var(--surface)' }}>
                    <td style={{ padding: '.6rem .9rem', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => onSelectHospital(h.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal-600)', fontWeight: 700, padding: 0, fontSize: '.82rem', textAlign: 'left' }}
                      >
                        {h.name}
                      </button>
                    </td>
                    <td style={{ padding: '.6rem .9rem', color: 'var(--gray-700)' }}>{h.enrolled}</td>
                    <td style={{ padding: '.6rem .9rem', color: 'var(--gray-700)' }}>{h.exams}</td>
                    <td style={{ padding: '.6rem .9rem', fontWeight: 700, color: rateColor(h.ltfu_rate) }}>{h.ltfu_rate}%</td>
                    <td style={{ padding: '.6rem .9rem', color: 'var(--gray-700)' }}>{h.treatment_rate}%</td>
                    <td style={{ padding: '.6rem .9rem', color: 'var(--gray-700)' }}>{h.avg_days_to_first_exam != null ? `${h.avg_days_to_first_exam}d` : '-'}</td>
                    <td style={{ padding: '.6rem .9rem', color: 'var(--gray-700)' }}>{h.sms_delivery_rate}%</td>
                    <td style={{ padding: '.6rem .9rem', color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>
                      {h.last_activity ? format(new Date(h.last_activity), 'd MMM yyyy') : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
