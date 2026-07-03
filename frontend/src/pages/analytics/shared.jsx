// Shared building blocks for the Analytics dashboard sections — extracted from
// AnalyticsPage.jsx so every section file can reuse the same look & feel.

// ── Shared custom tooltip ─────────────────────────────────────────────────────
export function ChartTooltip({ active, payload, label, valueLabel }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius)', padding: '.5rem .75rem',
      fontSize: '.82rem', boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{ color: 'var(--gray-500)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 700, color: 'var(--gray-900)' }}>
        {payload[0].value}{valueLabel}
      </div>
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────
export function StatCard({ value, label, sub, color, icon, onClick }) {
  return (
    <div
      className="card"
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', gap: '.3rem' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{
          width: 38, height: 38, borderRadius: 'var(--radius)',
          background: color + '18',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color, fontSize: '1.1rem', flexShrink: 0,
        }}>{icon}</div>
        {onClick && (
          <span style={{ fontSize: '.72rem', color: 'var(--gray-400)', marginTop: 4 }}>View list →</span>
        )}
      </div>
      <div style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-.04em', color: 'var(--gray-900)', lineHeight: 1, marginTop: '.4rem' }}>
        {value ?? '—'}
      </div>
      <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--gray-600)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {label}
      </div>
      {sub && <div style={{ fontSize: '.75rem', color: 'var(--gray-400)', marginTop: '.1rem' }}>{sub}</div>}
    </div>
  )
}

// ── Chart card wrapper ────────────────────────────────────────────────────────
export function ChartCard({ title, sub, children, loading, empty, emptyText }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--gray-900)' }}>{title}</div>
        {sub && <div style={{ fontSize: '.78rem', color: 'var(--gray-400)', marginTop: 2 }}>{sub}</div>}
      </div>
      {loading ? (
        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="spinner" />
        </div>
      ) : empty ? (
        <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray-400)', fontSize: '.85rem', fontStyle: 'italic' }}>
          {emptyText || 'No data recorded yet'}
        </div>
      ) : children}
    </div>
  )
}

// ── Section heading ───────────────────────────────────────────────────────────
export function SectionHeading({ title, sub }) {
  return (
    <div style={{ margin: '2rem 0 1rem' }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--gray-900)', margin: 0 }}>{title}</h2>
      {sub && <p style={{ fontSize: '.82rem', color: 'var(--gray-400)', margin: '.2rem 0 0' }}>{sub}</p>}
    </div>
  )
}

// ── Baby detail modal ─────────────────────────────────────────────────────────
export function BabyModal({ title, babies, loading, columns, onClose }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.1rem 1.25rem', borderBottom: '1px solid var(--gray-100)' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--gray-900)' }}>{title}</div>
            {!loading && <div style={{ fontSize: '.78rem', color: 'var(--gray-400)', marginTop: 2 }}>{babies?.length ?? 0} babies</div>}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', fontSize: '1.25rem', lineHeight: 1, padding: '4px 8px' }}
          >
            ×
          </button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ padding: '2rem', display: 'flex', justifyContent: 'center' }}>
              <div className="spinner" />
            </div>
          ) : !babies?.length ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-400)', fontSize: '.88rem' }}>
              No babies found for this period.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
              <thead>
                <tr style={{ background: 'var(--gray-50)' }}>
                  {columns.map(c => (
                    <th key={c.key} style={{ padding: '.6rem .9rem', textAlign: 'left', fontWeight: 600, color: 'var(--gray-500)', fontSize: '.75rem', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {babies.map((b, i) => (
                  <tr key={b.id} style={{ borderTop: '1px solid var(--gray-100)', background: i % 2 ? 'var(--gray-50)' : 'var(--surface)' }}>
                    {columns.map(c => (
                      <td key={c.key} style={{ padding: '.65rem .9rem', color: 'var(--gray-800)', whiteSpace: c.wrap ? 'normal' : 'nowrap' }}>
                        {c.render ? c.render(b) : (b[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Shared labels / colors ────────────────────────────────────────────────────
export const STAGE_LABELS = {
  no_rop: 'No ROP', immature: 'Immature',
  stage_1: 'Stage 1', stage_2: 'Stage 2', stage_3: 'Stage 3',
  stage_4: 'Stage 4', stage_5: 'Stage 5',
}
export const ZONE_LABELS = { zone_i: 'Zone I', zone_ii: 'Zone II', zone_iii: 'Zone III' }
export const LANGUAGE_LABELS = { english: 'English', luganda: 'Luganda', runyankole: 'Runyankole', acholi: 'Acholi', ateso: 'Ateso', unknown: 'Unknown' }

export const STAGE_COLORS = {
  no_rop: 'var(--green-600)', immature: 'var(--teal-400)',
  stage_1: 'var(--teal-600)', stage_2: 'var(--amber-500)', stage_3: 'var(--amber-600)',
  stage_4: 'var(--red-500, #ef4444)', stage_5: 'var(--red-600)',
}

export const DONUT_COLORS = ['var(--teal-600)', 'var(--teal-400)', 'var(--amber-500)', 'var(--amber-600)', 'var(--red-600)', 'var(--gray-400)']

// under 20% green, 20-40% amber, over 40% red — matches spec's rate-coloring rule
export function rateColor(pct) {
  if (pct == null) return 'var(--gray-400)'
  if (pct < 20) return 'var(--teal-600)'
  if (pct <= 40) return 'var(--amber-500)'
  return 'var(--red-600)'
}

export function fmtPct(v) {
  return v == null ? '—' : `${v}%`
}
