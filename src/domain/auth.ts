export const browserAuthOptions = {
  flowType: 'implicit' as const,
  detectSessionInUrl: true,
  persistSession: true,
}

export function buildPasswordResetRedirectUrl(origin: string, baseUrl: string): string {
  const cleanOrigin = origin.replace(/\/+$/, '')
  const trimmedBase = baseUrl.replace(/^\/+|\/+$/g, '')
  const cleanBase = trimmedBase ? `/${trimmedBase}/` : '/'
  return `${cleanOrigin}${cleanBase}`
}

export function hasImplicitRecoveryCallback(href: string): boolean {
  try {
    const url = new URL(href)
    const candidates = [url.searchParams, new URLSearchParams(url.hash.replace(/^#/, ''))]
    return candidates.some(params => params.get('type') === 'recovery' && Boolean(params.get('access_token')))
  } catch {
    return false
  }
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
