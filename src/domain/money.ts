export function parseCadToCents(input: string): number {
  const value = input.trim()
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) {
    throw new Error('Enter a valid amount with no more than two decimal places.')
  }
  const [whole, fraction = ''] = value.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 100_000_000) {
    throw new Error('Amount must be between CA$0.00 and CA$1,000,000.00.')
  }
  return cents
}

export function formatCad(cents: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

export function effectiveHourlyRateCents(chargeCents: number, minutes: number): number {
  if (minutes <= 0) throw new Error('Minutes must be positive.')
  const centsPerMinuteHundredths = (chargeCents * 100 * 60) / minutes
  return Math.floor((centsPerMinuteHundredths + 50) / 100)
}
