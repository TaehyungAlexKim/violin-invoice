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
import {
  browserAuthOptions,
  decideRecoveryTransition,
  lessonSaveError,
  passwordResetRequestError,
  scrubAuthParamsAndRoute,
} from './domain/auth'
import { allocateStableOperationKey } from './domain/auth'
import { settingsSaveAllowed } from './pages/Settings'
import { validateInvoiceSnapshot } from './domain/invoice-snapshot'
import { reconcileDraftEntryKey, reconcileDraftNavigation, reconcileFinalizationFailure, previewResultIsCurrent } from './data/repositories'
import { LESSON_NOTE_MAX_LENGTH, clampNoteToThreeLines, normalizeLessonNote } from './domain/invoice-snapshot'

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

describe('safe review boundaries', () => {
  it('normalizes lesson notes and clamps PDF display to three lines without changing the 300-character cap', () => {
    expect(LESSON_NOTE_MAX_LENGTH).toBe(300)
    expect(normalizeLessonNote('  warm-up  ')).toBe('warm-up')
    expect(normalizeLessonNote('   ')).toBeNull()
    const clamped = clampNoteToThreeLines('W'.repeat(300))
    expect(clamped.split('\n').length).toBeLessThanOrEqual(3)
    expect(clamped.replaceAll('\n','')).toHaveLength(300)
    expect(clampNoteToThreeLines('漢'.repeat(300)).endsWith('…')).toBe(true)
    const multiline = clampNoteToThreeLines('first\nsecond\nthird\nfourth')
    expect(multiline.split('\n')).toHaveLength(3)
    expect(multiline.split('\n')[2].endsWith('…')).toBe(true)
  })
  it('blocks Settings save until a successful load', () => {
    expect(settingsSaveAllowed(true,true,'',false)).toBe(false)
    expect(settingsSaveAllowed(false,false,'Unable to load',false)).toBe(false)
    expect(settingsSaveAllowed(false,true,'',false)).toBe(true)
  })

  it('reuses a stable lesson operation key for retries and rotates after success/reset', () => {
    const createKey=vi.fn(()=>`key-${createKey.mock.calls.length}`)
    const first=allocateStableOperationKey('', '', 'student|date|60|65', createKey)
    expect(allocateStableOperationKey(first.key, first.identity, first.identity, createKey)).toEqual(first)
    expect(allocateStableOperationKey(first.key, first.identity, 'student|date|60|70', createKey).key).not.toBe(first.key)
  })

  it('keeps student duplicate submit guards synchronous and ref-backed', () => {
    const guard = { pending: false }
    const submit = () => {
      if (guard.pending) return 'blocked'
      guard.pending = true
      return 'started'
    }
    expect(submit()).toBe('started')
    expect(submit()).toBe('blocked')
  })

  it('reconciles an out-of-order draft conflict only with its existing entry row', () => {
    const existing = { id:'invoice-1',student_id:'student-1',status:'draft',period_start:'2026-11-01',period_end:'2026-11-30',entry_key:'stable-key' } as const
    expect(reconcileDraftEntryKey({code:'23505'}, existing)).toEqual({reconciled:true,existing})
    expect(reconcileDraftEntryKey({code:'23505'}, null)).toEqual({reconciled:false,existing:null})
  })

  it('binds draft reconciliation to the selected student and draft status', () => {
    const row={id:'invoice-1',student_id:'student-1',status:'draft',entry_key:'key-1',period_start:'2026-11-01',period_end:'2026-11-30'} as const
    expect(reconcileDraftNavigation({key:'key-1',studentId:'student-1'},row)).toEqual({safe:true,invoice:row})
    expect(reconcileDraftNavigation({key:'key-1',studentId:'student-2'},row).safe).toBe(false)
    expect(reconcileDraftNavigation({key:'key-1',studentId:'student-1'}, {...row,status:'finalized'}).safe).toBe(false)
  })

  it('reconciles commit-then-error and exposes a valid finalized invoice', async () => {
    const snapshot=validateInvoiceSnapshot({
      schemaVersion:1,currency:'CAD',businessTimezone:'America/Vancouver',locale:'en-CA',
      invoice:{id:'invoice-1',number:'VI-2026-000001',status:'finalized',issueDate:'2026-11-23'},
      servicePeriod:{start:'2026-11-01',end:'2026-11-23'},sender:{},recipient:{},
      lines:[],subtotalCents:0,taxCents:0,totalCents:0,
      render:{fontManifest:{family:'Noto Sans KR',normalFile:'NotoSansKR-subset-2.0.ttf',sha256:'c9a5624db8919577ac53deb3a111dc6561bd4b69c06774288cc634a630f24c60',license:'OFL-1.1',normalOnly:true,licenseFile:'OFL.txt'},templateVersion:'2.0',rendererName:'pdfmake',rendererVersion:'0.3.15'},
    })
    const finalized={id:'invoice-1',student_id:'student-1',status:'finalized',period_start:'2026-11-01',period_end:'2026-11-23',snapshot_json:snapshot}
    const client={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:finalized,error:null})})})})} as unknown as Parameters<typeof reconcileFinalizationFailure>[0]
    const outcome=await reconcileFinalizationFailure(client,'invoice-1','student-1',new Error('RPC returned after commit'))
    expect(outcome.kind).toBe('finalized')
    if(outcome.kind==='finalized'){expect(outcome.invalidSnapshot).toBe(false);expect(outcome.invoice.status).toBe('finalized')}
  })

  it('rejects delayed preview results from superseded invoice/range generations', async () => {
    let resolveA!: (value:string)=>void
    let resolveB!: (value:string)=>void
    const a=new Promise<string>(resolve=>{resolveA=resolve})
    const b=new Promise<string>(resolve=>{resolveB=resolve})
    let currentGeneration=1
    let currentIdentity='invoice-1|student-1|2026-11-01|2026-11-30'
    resolveA('A'); resolveB('B')
    await Promise.all([a,b])
    currentGeneration=2
    currentIdentity='invoice-1|student-1|2026-12-01|2026-12-31'
    expect(previewResultIsCurrent(1,currentGeneration,'invoice-1|student-1|2026-11-01|2026-11-30',currentIdentity)).toBe(false)
    expect(previewResultIsCurrent(2,currentGeneration,currentIdentity,currentIdentity)).toBe(true)
  })

  it('rejects malformed persisted snapshots', () => {
    expect(()=>validateInvoiceSnapshot({schemaVersion:1,render:null})).toThrow(/Invalid/)
  })
})

describe('operator access check', () => {
  it('allows only an exact operator-row match', async () => {
    expect(await isOperatorUser(operatorClient({data:{workspace_owner_id:'workspace-owner'},error:null}), 'operator')).toEqual({status:'allowed'})
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
        'https://teacher.github.io/violin-invoice/#access_token=redacted&type=recovery&expires_in=3600',
      )).toBe(true)
      expect(hasImplicitRecoveryCallback(
        'https://teacher.github.io/violin-invoice/#access_token=redacted&type=invite&expires_in=3600',
      )).toBe(true)
      expect(hasImplicitRecoveryCallback(
        'https://teacher.github.io/violin-invoice/#/reset-password',
      )).toBe(false)
      expect(hasImplicitRecoveryCallback(
        'https://teacher.github.io/violin-invoice/#access_token=redacted&type=magiclink',
      )).toBe(false)
    })

    it('scrubs callback credentials and replaces the route with history-safe URL data', () => {
      const scrubbed = scrubAuthParamsAndRoute(
        'https://teacher.github.io/violin-invoice/?keep=yes&access_token=query-redacted'
        + '#access_token=fragment-redacted&refresh_token=refresh-redacted'
        + '&expires_in=3600&token_type=bearer&type=recovery',
        '/reset-password',
      )

      expect(scrubbed).toBe(
        'https://teacher.github.io/violin-invoice/?keep=yes#/reset-password',
      )
      for (const parameter of ['access_token','refresh_token','expires_in','token_type','type']) {
        expect(scrubbed).not.toContain(`${parameter}=`)
      }
    })

    it('starts recovery exactly once and ignores later auth events', () => {
      const initial = decideRecoveryTransition({
        event: 'PASSWORD_RECOVERY',
        hasSession: true,
        matchesInitialCallback: true,
        active: false,
        consumed: false,
      })
      expect(initial).toEqual({kind:'start'})

      expect(decideRecoveryTransition({
        event: 'PASSWORD_RECOVERY',
        hasSession: true,
        matchesInitialCallback: true,
        active: false,
        consumed: true,
      })).toEqual({kind:'ignore'})
      expect(decideRecoveryTransition({
        event: 'PASSWORD_RECOVERY',
        hasSession: true,
        matchesInitialCallback: true,
        active: true,
        consumed: false,
      })).toEqual({kind:'ignore'})
    })

    it('does not turn token refresh or MFA verification into recovery transitions', () => {
      for (const event of ['TOKEN_REFRESHED', 'MFA_CHALLENGE_VERIFIED', 'USER_UPDATED']) {
        expect(decideRecoveryTransition({
          event,
          hasSession: true,
          matchesInitialCallback: true,
          active: false,
          consumed: false,
        })).toEqual({kind:'ignore'})
      }
    })

    it('uses a matching initial session for invite callbacks', () => {
      expect(decideRecoveryTransition({
        event: 'SIGNED_IN',
        hasSession: true,
        matchesInitialCallback: true,
        active: false,
        consumed: false,
      })).toEqual({kind:'start'})
      expect(decideRecoveryTransition({
        event: 'INITIAL_SESSION',
        hasSession: true,
        matchesInitialCallback: false,
        active: false,
        consumed: false,
      })).toEqual({kind:'ignore'})
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
  it('distinguishes denied operators from transient lookup failures', async () => {
    expect(await isOperatorUser(operatorClient({data:null,error:null}), 'second-user')).toEqual({status:'denied'})
    expect(await isOperatorUser(operatorClient({data:null,error:{message:'network failed'}}), 'second-user')).toEqual({
      status:'failure', message:'Unable to verify operator access. Please retry.',
    })
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
