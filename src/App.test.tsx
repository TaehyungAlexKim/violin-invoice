import { describe, expect, it } from 'vitest'
import { buildPasswordResetRedirectUrl, isOperatorUser, studentDeleteError, validatePassword } from './App'
import { decideMfaAccess, mfaFailureDecision } from './domain/mfa'

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

  describe('MFA access decisions', () => {
    it('enrolls when no verified TOTP factor exists', () => {
      expect(decideMfaAccess('aal1', [])).toEqual({kind:'enroll'})
    })

    it('verifies an existing TOTP factor for an AAL1 session', () => {
      expect(decideMfaAccess('aal1', [{id:'totp-1',factor_type:'totp',status:'verified'}]))
        .toEqual({kind:'verify',factorId:'totp-1'})
    })

    it('allows an AAL2 session', () => {
      expect(decideMfaAccess('aal2', [{id:'totp-1',factor_type:'totp',status:'verified'}]))
        .toEqual({kind:'allowed'})
    })

    it('maps verification failure to a safe retry state', () => {
      expect(mfaFailureDecision({message:'invalid TOTP code'})).toEqual({
        message:'Invalid authentication code. Enter the current six-digit code and try again.',
        challengeExpired:false,
      })
      expect(mfaFailureDecision({message:'challenge expired'})).toEqual({
        message:'This verification challenge has expired. Request a new one and try again.',
        challengeExpired:true,
      })
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
