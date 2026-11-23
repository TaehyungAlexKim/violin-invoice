import { describe, expect, it } from 'vitest'
import { buildPasswordResetRedirectUrl, isOperatorUser, studentDeleteError, validatePassword } from './App'

function operatorClient(result: { data: unknown; error: unknown }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => result,
        }),
      }),
    }),
  } as unknown as Parameters<typeof isOperatorUser>[0]
}

describe('operator access check', () => {
  it('allows only an exact operator-row match', async () => {
    expect(await isOperatorUser(operatorClient({data:{workspace_owner_id:'workspace-owner'},error:null}), 'operator')).toBe(true)
  })

  describe('student deletion error', () => {
    it('returns an English linked-data message for FK constraints', () => {
      expect(studentDeleteError({code:'23503',message:'violates foreign key constraint'})).toBe(
        'This student is linked to lessons or invoices and cannot be deleted.',
      )
    })
    it('returns an English fallback for unknown database errors', () => {
      expect(studentDeleteError({code:'XX000',message:'database failure'})).toBe(
        'Unable to delete the student. Please try again.',
      )
    })
  })

  describe('password reset', () => {
    it('builds a GitHub Pages HashRouter recovery redirect', () => {
      expect(buildPasswordResetRedirectUrl('https://teacher.github.io/', '/violin-invoice/'))
        .toBe('https://teacher.github.io/violin-invoice/#/reset-password')
    })

    it('enforces the minimum password length', () => {
      expect(validatePassword('12345', '12345')).toBe('Password must be at least 6 characters.')
    })

    it('requires matching confirmation text', () => {
      expect(validatePassword('123456', '654321')).toBe('Passwords do not match.')
    })

    it('accepts a matching password meeting the minimum', () => {
      expect(validatePassword('123456', '123456')).toBe('')
    })
  })
  it('denies missing operators, RLS mismatches, and query errors uniformly', async () => {
    expect(await isOperatorUser(operatorClient({data:null,error:null}), 'second-user')).toBe(false)
    expect(await isOperatorUser(operatorClient({data:null,error:{message:'permission denied'}}), 'second-user')).toBe(false)
  })
})
