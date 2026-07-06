// Shared helpers for editing / overriding a baby's next review (appointment) date.
import { format, differenceInCalendarDays } from 'date-fns'

// Reason options for changing a review date. Values are stored verbatim in the
// audit trail + contact log, so keep them human-readable (no em dashes per the
// project UI rule).
export const REVIEW_DATE_REASONS = [
  'Parent requested reschedule',
  'Clinician judgement - extend interval',
  'Clinician judgement - bring forward',
  'Baby unwell - reschedule',
  'Hospital capacity - reschedule',
  'Other',
]

export const MAX_REVIEW_WEEKS = 8

export function todayISO() {
  return format(new Date(), 'yyyy-MM-dd')
}

// Returns a validation object: { error, warning } for a candidate ISO date string.
// error blocks saving; warning requires an explicit confirm but allows saving.
export function validateReviewDate(iso) {
  if (!iso) return { error: null, warning: null }
  const picked = new Date(iso + 'T00:00:00')
  if (Number.isNaN(picked.getTime())) return { error: 'Please enter a valid date', warning: null }
  const today = new Date(todayISO() + 'T00:00:00')
  const days = differenceInCalendarDays(picked, today)
  if (days < 0) return { error: 'Review date cannot be in the past', warning: null }
  if (days > MAX_REVIEW_WEEKS * 7) {
    return {
      error: null,
      warning: 'This is longer than the maximum recommended ROP follow-up interval. Are you sure?',
    }
  }
  return { error: null, warning: null }
}

// Resolve the final reason string: when "Other" is picked, use the free-text box.
export function resolveReason(reasonSelect, otherText) {
  if (reasonSelect === 'Other') return (otherText || '').trim()
  return reasonSelect
}
