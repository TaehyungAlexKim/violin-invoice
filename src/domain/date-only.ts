const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseDateOnly(value: string): { year: number; month: number; day: number } {
  const match = DATE_RE.exec(value)
  if (!match) throw new Error('Use an ISO date in YYYY-MM-DD format.')
  const [, y, m, d] = match
  const year = Number(y), month = Number(m), day = Number(d)
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error('Enter a valid calendar date.')
  }
  return { year, month, day }
}

export function formatDateOnly(value: string): string {
  parseDateOnly(value)
  return value
}

export function addCalendarDay(value: string): string {
  const { year, month, day } = parseDateOnly(value)
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  return [
    String(next.getUTCFullYear()).padStart(4, '0'),
    String(next.getUTCMonth() + 1).padStart(2, '0'),
    String(next.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

export function todayInVancouver(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => parts.find((part) => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
