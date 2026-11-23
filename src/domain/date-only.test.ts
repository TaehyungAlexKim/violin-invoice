import { describe, expect, it } from 'vitest'
import { addCalendarDay, parseDateOnly, todayInVancouver } from './date-only'

describe('date-only rules', () => {
  it('adds calendar days without timezone shift', () => {
    expect(addCalendarDay('2026-11-30')).toBe('2026-12-01')
  })
  it('rejects malformed and impossible dates', () => {
    expect(() => parseDateOnly('2026-02-30')).toThrow()
  })
  it('uses Vancouver for today', () => {
    expect(todayInVancouver(new Date('2026-11-04T19:30:00Z'))).toBe('2026-11-04')
  })
})
