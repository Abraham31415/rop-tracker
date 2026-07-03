// A baby's stored "name" field is the mother/caregiver's name entered at
// enrollment (e.g. "Nakamya Sarah"). It is always displayed prefixed with
// "B/O" (Baby Of) — the prefix is never stored in the database.
export function getBabyDisplayName(babyOrName) {
  const raw = typeof babyOrName === 'string' ? babyOrName : babyOrName?.full_name
  const name = (raw || '').trim()
  return name ? `B/O ${name}` : 'B/O Unknown'
}

// Filesystem-safe slug for PDF filenames, e.g. "B/O Nakamya Sarah" -> "B-O-Nakamya-Sarah"
export function getBabyFileNameSlug(babyOrName) {
  return getBabyDisplayName(babyOrName).replace(/[\s/]+/g, '-')
}

// Backend-generated notification title/body strings mention the baby's name
// once (as the subject) before any later mention of the caregiver contact —
// insert the "B/O" prefix at that first mention only, so the caregiver
// mention further down the sentence is left as a plain name.
export function boifyFirstMention(text, name) {
  if (!text || !name) return text
  const idx = text.indexOf(name)
  if (idx === -1) return text
  return `${text.slice(0, idx)}B/O ${text.slice(idx)}`
}
