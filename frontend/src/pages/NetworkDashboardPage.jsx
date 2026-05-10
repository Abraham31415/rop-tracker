import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getNetworkOverview } from '../services/api'
import { format, startOfWeek, endOfWeek } from 'date-fns'

// ── Static fallback for when API is offline ───────────────────────────────────
const DUMMY = {
  summary: {
    total_babies: 54, total_ltfu: 4, total_due_today: 3,
    total_due_soon: 7, total_on_track: 40,
    active_hospitals: 6,
    reminders_sent_this_week: 18, reminders_failed_this_week: 2,
  },
  hospitals: [
    { id: '1', name: 'Mulago National Referral Hospital', district: 'Kampala', region: 'Central', total: 18, ltfu: 3, due_today: 2, due_soon: 3, on_track: 10 },
    { id: '2', name: 'Kiruddu General Hospital',         district: 'Kampala', region: 'Central', total: 9,  ltfu: 1, due_today: 1, due_soon: 2, on_track: 5  },
    { id: '3', name: 'Mbarara RRRH',                    district: 'Mbarara', region: 'Western', total: 11, ltfu: 0, due_today: 0, due_soon: 1, on_track: 10 },
    { id: '4', name: 'Gulu Regional Referral Hospital',  district: 'Gulu',    region: 'Northern',total: 6,  ltfu: 0, due_today: 0, due_soon: 1, on_track: 5  },
    { id: '5', name: 'Lacor Hospital',                  district: 'Gulu',    region: 'Northern',total: 5,  ltfu: 0, due_today: 0, due_soon: 0, on_track: 5  },
    { id: '6', name: 'Mbale Regional Referral Hospital', district: 'Mbale',   region: 'Eastern', total: 5,  ltfu: 0, due_today: 0, due_soon: 0, on_track: 5  },
  ],
  reminder_activity: [
    { trigger: 't_minus_3', sent: 8, failed: 1, total: 9  },
    { trigger: 't_minus_1', sent: 7, failed: 1, total: 8  },
    { trigger: 'day_of',    sent: 2, failed: 0, total: 2  },
    { trigger: 'ltfu_48h',  sent: 1, failed: 0, total: 1  },
  ],
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const TRIGGER_META = {
  t_minus_3: { label: '3 Days Before',   color: 'var(--teal-600)',   bg: 'var(--teal-50)'   },
  t_minus_1: { label: '1 Day Before',    color: 'var(--amber-600)',  bg: 'var(--amber-50)'  },
  day_of:    { label: 'Day Of',          color: 'var(--red-600)',    bg: 'var(--red-50)'    },
  ltfu_48h:  { label: 'LTFU Alert',      color: 'var(--red-700)',    bg: '#fee2e2'          },
}

function pct(n, total) {
  return total === 0 ? 0 : Math.round((n / total) * 100)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function NetStatCard({ value, label, sub, colorVar, icon }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{
          width: 38, height: 38, borderRadius: 'var(--radius)',
          background: colorVar + '15',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: colorVar, fontSize: '1.1rem', flexShrink: 0,
        }}>{icon}</div>
      </div>
      <div style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-.04em', color: 'var(--gray-900)', lineHeight: 1, marginTop: '.4rem' }}>
        {value}
      </div>
      <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--gray-600)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      {sub && <div style={{ fontSize: '.75rem', color: 'var(--gray-400)', marginTop: '.1rem' }}>{sub}</div>}
    </div>
  )
}

function UrgencyBar({ ltfu, due_today, due_soon, on_track, total }) {
  if (total === 0) return <span style={{ fontSize: '.78rem', color: 'var(--gray-400)' }}>No babies enrolled</span>
  const segs = [
    { n: ltfu + due_today, color: 'var(--red-500)' },
    { n: due_soon,         color: 'var(--amber-400)' },
    { n: on_track,         color: 'var(--green-400)' },
  ].filter(s => s.n > 0)
  return (
    <div style={{ display: 'flex', height: 6, borderRadius: 99, overflow: 'hidden', gap: 1, background: 'var(--gray-100)' }}>
      {segs.map((s, i) => (
        <div key={i} style={{ flex: s.n, background: s.color, borderRadius: 99 }} title={s.n} />
      ))}
    </div>
  )
}

function UrgencyCount({ n, color, bg, label }) {
  if (n === 0) return <span style={{ color: 'var(--gray-300)', fontWeight: 600, fontSize: '.88rem' }}>-</span>
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <span style={{
        fontWeight: 700, fontSize: '.92rem', color,
        background: bg, borderRadius: 6, padding: '2px 8px',
        minWidth: 32, textAlign: 'center',
      }}>{n}</span>
    </div>
  )
}

function ReminderRow({ item }) {
  const meta = TRIGGER_META[item.trigger] || { label: item.trigger, color: 'var(--gray-600)', bg: 'var(--gray-100)' }
  const sentPct = pct(item.sent, item.total)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '.75rem 0', borderBottom: '1px solid var(--gray-100)' }}>
      <div style={{ width: 120, flexShrink: 0 }}>
        <span style={{
          display: 'inline-block', padding: '.2rem .65rem',
          borderRadius: 999, fontSize: '.75rem', fontWeight: 700,
          background: meta.bg, color: meta.color,
        }}>{meta.label}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', height: 8, borderRadius: 99, overflow: 'hidden', background: 'var(--gray-100)', marginBottom: '.3rem' }}>
          {item.sent > 0 && <div style={{ flex: item.sent, background: 'var(--green-400)', borderRadius: 99 }} />}
          {item.failed > 0 && <div style={{ flex: item.failed, background: 'var(--red-400)', marginLeft: 1, borderRadius: 99 }} />}
        </div>
        <div style={{ fontSize: '.72rem', color: 'var(--gray-400)' }}>
          {sentPct}% delivered
        </div>
      </div>
      <div style={{ width: 60, textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: '.9rem', color: 'var(--green-700)' }}>{item.sent}</div>
        <div style={{ fontSize: '.7rem', color: 'var(--gray-400)' }}>sent</div>
      </div>
      <div style={{ width: 50, textAlign: 'right', flexShrink: 0 }}>
        {item.failed > 0 ? (
          <>
            <div style={{ fontWeight: 700, fontSize: '.9rem', color: 'var(--red-600)' }}>{item.failed}</div>
            <div style={{ fontSize: '.7rem', color: 'var(--gray-400)' }}>failed</div>
          </>
        ) : (
          <span style={{ color: 'var(--gray-300)', fontSize: '.85rem' }}>-</span>
        )}
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function NetworkDashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['network-overview'],
    queryFn: getNetworkOverview,
    refetchInterval: 5 * 60 * 1000,  // auto-refresh every 5 min
  })

  const d = error ? DUMMY : (data || DUMMY)
  const isDemo = !!error
  const { summary, hospitals, reminder_activity } = d

  const weekLabel = `${format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'dd MMM')} – ${format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'dd MMM yyyy')}`

  // Group hospitals by region
  const regions = [...new Set(hospitals.map(h => h.region))].sort()
  const byRegion = {}
  regions.forEach(r => { byRegion[r] = hospitals.filter(h => h.region === r) })

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-text">
          <h2>Network Overview</h2>
          <p>All hospitals · {format(new Date(), 'EEEE, d MMMM yyyy')}</p>
        </div>
        <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center' }}>
          {isDemo && (
            <span className="demo-notice" style={{ padding: '.35rem .9rem', fontSize: '.78rem' }}>
              Demo data - API offline
            </span>
          )}
          <Link to="/enroll" className="btn btn-primary">+ Enroll Baby</Link>
        </div>
      </div>

      {isLoading && !error ? (
        <div className="spinner-center"><div className="spinner" /></div>
      ) : (
        <>
          {/* ── Network summary cards ─────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: '1rem', marginBottom: '1.75rem' }}>
            <NetStatCard
              value={summary.total_babies}
              label="Total Babies"
              sub="Across all hospitals"
              colorVar="var(--teal-600)"
              icon="👶"
            />
            <NetStatCard
              value={summary.total_ltfu}
              label="Lost to Follow-Up"
              sub={summary.total_ltfu > 0 ? 'Require urgent contact' : 'All babies accounted for'}
              colorVar="var(--red-600)"
              icon="!"
            />
            <NetStatCard
              value={summary.total_due_today + summary.total_due_soon}
              label="Due This Week"
              sub={`${summary.total_due_today} today · ${summary.total_due_soon} in 1–2 days`}
              colorVar="var(--amber-600)"
              icon="~"
            />
            <NetStatCard
              value={summary.active_hospitals}
              label="Active Hospitals"
              sub="With enrolled babies"
              colorVar="var(--teal-700)"
              icon="+"
            />
            <NetStatCard
              value={summary.reminders_sent_this_week}
              label="SMS Sent"
              sub={`This week · ${summary.reminders_failed_this_week} failed`}
              colorVar="var(--green-600)"
              icon="✓"
            />
            <NetStatCard
              value={summary.blindness_prevented ?? 0}
              label="Blindness Prevented"
              sub="Babies receiving active treatment"
              colorVar="var(--teal-600)"
              icon="👁"
            />
          </div>

          {/* ── Hospital breakdown ────────────────────────────────────────── */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '1.5rem' }}>
            <div style={{ padding: '1rem 1.375rem', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--teal-600)', textTransform: 'uppercase', letterSpacing: '.09em', marginBottom: '.2rem' }}>
                  Hospital Network
                </div>
                <h3 style={{ fontSize: '.95rem', fontWeight: 700, color: 'var(--gray-900)' }}>
                  Urgency breakdown by hospital
                </h3>
              </div>
              <div style={{ display: 'flex', gap: '1.25rem', fontSize: '.72rem', color: 'var(--gray-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--red-500)', display: 'inline-block' }} /> LTFU / Today
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--amber-400)', display: 'inline-block' }} /> Due Soon
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--green-400)', display: 'inline-block' }} /> On Track
                </span>
              </div>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '32%' }}>Hospital</th>
                    <th>Region</th>
                    <th style={{ textAlign: 'center' }}>Total</th>
                    <th style={{ textAlign: 'center', color: 'var(--red-600)' }}>LTFU</th>
                    <th style={{ textAlign: 'center', color: 'var(--red-600)' }}>Due Today</th>
                    <th style={{ textAlign: 'center', color: 'var(--amber-600)' }}>Due Soon</th>
                    <th style={{ textAlign: 'center', color: 'var(--green-700)' }}>On Track</th>
                    <th style={{ width: '18%' }}>Urgency</th>
                  </tr>
                </thead>
                <tbody>
                  {hospitals.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', color: 'var(--gray-400)', padding: '2rem' }}>
                        No hospital data available.
                      </td>
                    </tr>
                  ) : (
                    hospitals.map(h => (
                      <tr
                        key={h.id}
                        style={{ borderLeft: h.ltfu > 0 ? '3px solid var(--red-500)' : h.due_today > 0 ? '3px solid var(--amber-400)' : '3px solid transparent' }}
                      >
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--gray-900)', fontSize: '.88rem' }}>{h.name}</div>
                          <div style={{ fontSize: '.72rem', color: 'var(--gray-400)', marginTop: '.1rem' }}>{h.district}</div>
                        </td>
                        <td>
                          <span style={{
                            display: 'inline-block', padding: '.15rem .55rem',
                            background: 'var(--gray-100)', borderRadius: 999,
                            fontSize: '.72rem', fontWeight: 600, color: 'var(--gray-600)',
                          }}>{h.region}</span>
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--gray-800)' }}>
                          {h.total || <span style={{ color: 'var(--gray-300)' }}>0</span>}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <UrgencyCount n={h.ltfu}      color="var(--red-700)"   bg="var(--red-100)"   />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <UrgencyCount n={h.due_today} color="#92400e"          bg="var(--amber-100)" />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <UrgencyCount n={h.due_soon}  color="var(--amber-600)" bg="var(--amber-50)"  />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <UrgencyCount n={h.on_track}  color="var(--green-700)" bg="var(--green-100)" />
                        </td>
                        <td>
                          <UrgencyBar {...h} />
                          <div style={{ fontSize: '.68rem', color: 'var(--gray-400)', marginTop: '.3rem', textAlign: 'right' }}>
                            {h.total > 0 ? `${pct(h.on_track, h.total)}% on track` : '-'}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {hospitals.length > 0 && (
                  <tfoot>
                    <tr style={{ background: 'var(--gray-50)', fontWeight: 700 }}>
                      <td style={{ padding: '.75rem 1rem', fontSize: '.8rem', color: 'var(--gray-600)' }}>Network Total</td>
                      <td />
                      <td style={{ textAlign: 'center', padding: '.75rem 1rem', color: 'var(--gray-900)' }}>{summary.total_babies}</td>
                      <td style={{ textAlign: 'center', padding: '.75rem 1rem', color: 'var(--red-700)' }}>{summary.total_ltfu}</td>
                      <td style={{ textAlign: 'center', padding: '.75rem 1rem', color: '#92400e' }}>{summary.total_due_today}</td>
                      <td style={{ textAlign: 'center', padding: '.75rem 1rem', color: 'var(--amber-600)' }}>{summary.total_due_soon}</td>
                      <td style={{ textAlign: 'center', padding: '.75rem 1rem', color: 'var(--green-700)' }}>{summary.total_on_track}</td>
                      <td style={{ padding: '.75rem 1rem' }}>
                        <div style={{ fontSize: '.75rem', color: 'var(--gray-500)' }}>
                          {pct(summary.total_on_track, summary.total_babies)}% on track network-wide
                        </div>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* ── Reminder activity ─────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

            <div className="card">
              <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--teal-600)', textTransform: 'uppercase', letterSpacing: '.09em', marginBottom: '.2rem' }}>
                Reminder Activity
              </div>
              <h3 style={{ fontSize: '.95rem', fontWeight: 700, color: 'var(--gray-900)', marginBottom: '.25rem' }}>SMS Delivery - This Week</h3>
              <p style={{ fontSize: '.78rem', color: 'var(--gray-400)', marginBottom: '1.25rem' }}>{weekLabel}</p>

              {reminder_activity.map(item => (
                <ReminderRow key={item.trigger} item={item} />
              ))}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--gray-100)' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--green-700)' }}>{summary.reminders_sent_this_week}</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--gray-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Delivered</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: summary.reminders_failed_this_week > 0 ? 'var(--red-600)' : 'var(--gray-300)' }}>
                    {summary.reminders_failed_this_week}
                  </div>
                  <div style={{ fontSize: '.72rem', color: 'var(--gray-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Failed</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--teal-700)' }}>
                    {summary.reminders_sent_this_week + summary.reminders_failed_this_week}
                  </div>
                  <div style={{ fontSize: '.72rem', color: 'var(--gray-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Total</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--teal-600)' }}>
                    {pct(summary.reminders_sent_this_week, summary.reminders_sent_this_week + summary.reminders_failed_this_week)}%
                  </div>
                  <div style={{ fontSize: '.72rem', color: 'var(--gray-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Success rate</div>
                </div>
              </div>
            </div>

            {/* LTFU spotlight */}
            <div className="card" style={{ background: summary.total_ltfu > 0 ? 'linear-gradient(135deg, #fff5f5, #fee2e2)' : 'linear-gradient(135deg, var(--green-50), #dcfce7)', border: `1px solid ${summary.total_ltfu > 0 ? '#fca5a5' : '#86efac'}` }}>
              <div style={{ fontSize: '.7rem', fontWeight: 700, color: summary.total_ltfu > 0 ? 'var(--red-600)' : 'var(--green-700)', textTransform: 'uppercase', letterSpacing: '.09em', marginBottom: '.5rem' }}>
                {summary.total_ltfu > 0 ? 'Action Required' : 'Network Health'}
              </div>

              {summary.total_ltfu > 0 ? (
                <>
                  <div style={{ fontSize: '3.5rem', fontWeight: 900, color: 'var(--red-600)', lineHeight: 1, letterSpacing: '-.04em', marginBottom: '.5rem' }}>
                    {summary.total_ltfu}
                  </div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--red-700)', marginBottom: '.5rem' }}>
                    {summary.total_ltfu === 1 ? 'baby is' : 'babies are'} Lost to Follow-Up
                  </div>
                  <p style={{ fontSize: '.85rem', color: 'var(--red-700)', opacity: .8, lineHeight: 1.6, marginBottom: '1.25rem' }}>
                    These babies missed their scheduled exam and could not be reached within 48 hours. Coordinators should call caregivers directly.
                  </p>
                  <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                    {hospitals.filter(h => h.ltfu > 0).map(h => (
                      <div key={h.id} style={{
                        padding: '.35rem .75rem', borderRadius: 999,
                        background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.2)',
                        fontSize: '.78rem', fontWeight: 600, color: 'var(--red-700)',
                      }}>
                        {h.name.split(' ').slice(0, 2).join(' ')} · {h.ltfu} LTFU
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '3.5rem', fontWeight: 900, color: 'var(--green-600)', lineHeight: 1, letterSpacing: '-.04em', marginBottom: '.5rem' }}>
                    0
                  </div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--green-700)', marginBottom: '.5rem' }}>
                    Lost to Follow-Up
                  </div>
                  <p style={{ fontSize: '.85rem', color: 'var(--green-700)', opacity: .8, lineHeight: 1.6 }}>
                    All babies in the network are accounted for. The reminder system is keeping caregivers engaged.
                  </p>
                  <div style={{ marginTop: '1.25rem', fontSize: '.85rem', color: 'var(--green-700)', fontWeight: 600 }}>
                    {pct(summary.total_on_track, summary.total_babies)}% of all babies are on track ✓
                  </div>
                </>
              )}
            </div>

          </div>
        </>
      )}
    </div>
  )
}
