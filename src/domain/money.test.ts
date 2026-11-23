import { describe, expect, it } from 'vitest'
import { effectiveHourlyRateCents, formatCad, parseCadToCents } from './money'

describe('CAD cents', () => {
  it.each(['65','65.0','65.00'])('parses %s correctly', (value) => {
    expect(parseCadToCents(value)).toBe(6500)
  })
  it('adds decimal cents exactly', () => {
    expect(parseCadToCents('0.10') + parseCadToCents('0.20')).toBe(30)
  })
  it.each(['1.005','1e2','NaN','-1','Infinity'])('rejects %s', (value) => {
    expect(() => parseCadToCents(value)).toThrow()
  })
  it('formats zero and derived hourly rate', () => {
    expect(formatCad(3500)).toContain('35')
    expect(effectiveHourlyRateCents(6750,45)).toBe(9000)
  })
})
