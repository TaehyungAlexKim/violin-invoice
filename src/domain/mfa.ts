export type MfaFactor = {
  id: string
  factor_type: string
  status: string
}

export type MfaAccessDecision =
  | { kind: 'enroll' }
  | { kind: 'verify'; factorId: string }
  | { kind: 'allowed' }

export function decideMfaAccess(
  currentLevel: string | null | undefined,
  factors: MfaFactor[],
): MfaAccessDecision {
  if (currentLevel === 'aal2') return { kind: 'allowed' }

  const verifiedTotp = factors.find(
    factor => factor.factor_type === 'totp' && factor.status === 'verified',
  )
  return verifiedTotp ? { kind: 'verify', factorId: verifiedTotp.id } : { kind: 'enroll' }
}

export type MfaFailureDecision = {
  message: string
  challengeExpired: boolean
}

export function mfaFailureDecision(error: unknown): MfaFailureDecision {
  const message = error instanceof Error ? error.message : String(
    (error as { message?: unknown } | null)?.message ?? error ?? '',
  )
  if (/expired|too old|challenge.*not found/i.test(message)) {
    return {
      message: 'This verification challenge has expired. Request a new one and try again.',
      challengeExpired: true,
    }
  }
  if (/invalid|incorrect|otp|one.?time|code|token|verify/i.test(message)) {
    return {
      message: 'Invalid authentication code. Enter the current six-digit code and try again.',
      challengeExpired: false,
    }
  }
  return {
    message: 'Unable to complete multi-factor authentication. Please try again.',
    challengeExpired: false,
  }
}
