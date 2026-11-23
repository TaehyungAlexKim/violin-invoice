import { describe, expect, it, vi } from 'vitest'
import {
  buildPasswordResetRedirectUrl,
  hasImplicitRecoveryCallback,
  isOperatorUser,
  signOutLocalSession,
  studentDeleteError,
  validatePassword,
} from './App'
import { decideMfaAccess, mfaFailureDecision } from './domain/mfa'
import { browserAuthOptions, lessonSaveError, passwordResetRequestError } from './domain/auth'

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
    it('uses the Pages base URL without a HashRouter fragment', () => {
      expect(buildPasswordResetRedirectUrl('https://teacher.github.io/', '/violin-invoice/'))
        .toBe('https://teacher.github.io/violin-invoice/')
    })

    it('recognizes an implicit recovery token before route protection', () => {
      expect(hasImplicitRecoveryCallback(
        'https://teacher.github.io/violin-invoice/#access_token=token&type=recovery&expires_in=3600',
      )).toBe(true)
      expect(hasImplicitRecoveryCallback(
        'https://teacher.github.io/violin-invoice/#/reset-password',
      )).toBe(false)
    })

    it('configures implicit persistent browser sessions', () => {
      expect(browserAuthOptions).toEqual({
        flowType:'implicit',
        detectSessionInUrl:true,
        persistSession:true,
      })
    })

    it('maps reset throttling without exposing provider text', () => {
      expect(passwordResetRequestError({status:429,message:'rate limit secret detail'}))
        .toBe('Too many password reset requests. Wait a few minutes and try again.')
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

describe('local session removal', () => {
  it('requests local sign-out and clears the workspace only after success', async () => {
    const signOut=vi.fn().mockResolvedValue({error:null})
    const afterRemoval=vi.fn()
    const client={auth:{signOut}} as unknown as Parameters<typeof signOutLocalSession>[0]

    expect(await signOutLocalSession(client,afterRemoval)).toBe('')
    expect(signOut).toHaveBeenCalledWith({scope:'local'})
    expect(afterRemoval).toHaveBeenCalledOnce()
  })

  it('retains local state and reports a useful error when sign-out fails', async () => {
    const signOut=vi.fn().mockResolvedValue({error:{message:'network'}})
    const afterRemoval=vi.fn()
    const client={auth:{signOut}} as unknown as Parameters<typeof signOutLocalSession>[0]

    expect(await signOutLocalSession(client,afterRemoval))
      .toBe('Unable to sign out. Your local session is still active; please try again.')
    expect(afterRemoval).not.toHaveBeenCalled()
  })
})

describe('finalized lesson period errors', () => {
  it('explains the retroactive lesson rejection in English', () => {
    expect(lessonSaveError({
      code:'23514',
      message:'This lesson falls within a finalized invoice period and cannot be saved.',
    })).toBe(
      'This lesson falls within a finalized invoice period and cannot be saved. Choose a date outside that period or review the finalized invoice.',
    )
  })
})
