export const browserAuthOptions = {
  flowType: 'implicit' as const,
  detectSessionInUrl: true,
  persistSession: true,
}

export const recoveryInProgressKey = 'violin-invoice-recovery-in-progress'

const authUrlParameters = [
  'access_token',
  'refresh_token',
  'expires_in',
  'token_type',
  'type',
] as const

export function buildPasswordResetRedirectUrl(origin: string, baseUrl: string): string {
  const cleanOrigin = origin.replace(/\/+$/, '')
  const trimmedBase = baseUrl.replace(/^\/+|\/+$/g, '')
  const cleanBase = trimmedBase ? `/${trimmedBase}/` : '/'
  return `${cleanOrigin}${cleanBase}`
}

function authCallbackParams(href: string): URLSearchParams[] {
  const url = new URL(href)
  const hash = url.hash.replace(/^#/, '')
  const queryIndex = hash.indexOf('?')
  const hashParams = queryIndex >= 0 ? hash.slice(queryIndex + 1) : hash
  return [url.searchParams, new URLSearchParams(hashParams)]
}

export function hasImplicitRecoveryCallback(href: string): boolean {
  try {
    return authCallbackParams(href).some(params =>
      ['recovery', 'invite'].includes(params.get('type') || '') && Boolean(params.get('access_token')),
    )
  } catch {
    return false
  }
}

export function implicitRecoverySessionMatches(href: string, accessToken: string | undefined): boolean {
  if (!accessToken) return false
  try {
    return authCallbackParams(href).some(params =>
      ['recovery', 'invite'].includes(params.get('type') || '')
      && params.get('access_token') === accessToken,
    )
  } catch {
    return false
  }
}

export function scrubAuthParamsAndRoute(href: string, route: string): string {
  const url = new URL(href)
  for (const parameter of authUrlParameters) url.searchParams.delete(parameter)

  const cleanRoute = route.startsWith('#') ? route : `#${route}`
  url.hash = cleanRoute
  return url.toString()
}

export type RecoveryTransition =
  | { kind: 'start' }
  | { kind: 'ignore' }

export function decideRecoveryTransition({
  event,
  hasSession,
  matchesInitialCallback,
  active,
  consumed,
}: {
  event: string
  hasSession: boolean
  matchesInitialCallback: boolean
  active: boolean
  consumed: boolean
}): RecoveryTransition {
  if (!hasSession || active || consumed) return { kind: 'ignore' }
  if (event === 'PASSWORD_RECOVERY') return { kind: 'start' }
  if (
    matchesInitialCallback
    && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')
  ) {
    return { kind: 'start' }
  }
  return { kind: 'ignore' }
}

export function passwordResetRequestError(error: unknown): string {
  const value = error as {status?:number;code?:string;message?:string}
  const detail = `${value.code || ''} ${value.message || ''}`
  if(value.status===429 || /rate.?limit|too many requests|over_request_rate_limit/i.test(detail)) {
    return 'Too many password reset requests. Wait a few minutes and try again.'
  }
  if(/redirect|url.*allow|not allowed/i.test(detail)) {
    return 'Password reset is not configured correctly. Contact the administrator.'
  }
  return 'Unable to send a reset email. Please try again.'
}

export function lessonSaveError(error: unknown): string {
  const value = error as {code?:string;message?:string}
  if(value.code==='23514' && /finalized invoice period/i.test(value.message || '')) {
    return 'This lesson falls within a finalized invoice period and cannot be saved. Choose a date outside that period or review the finalized invoice.'
  }
  if(/finalized invoice|included in a finalized invoice/i.test(value.message || '')) {
    return 'This lesson is included in a finalized invoice and cannot be changed.'
  }
  return 'Unable to save the lesson. Please try again.'
}
