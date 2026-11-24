export function authError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const status = (error as { status?: number } | null)?.status
  if (status === 429 || /rate.?limit|too many requests|over_request_rate_limit/i.test(message)) {
    return 'Too many requests. Wait a few minutes and try again.'
  }
  if (/invalid|password|credentials/i.test(message)) return 'Invalid email or password.'
  if (/operator|access/i.test(message)) return 'Access denied.'
  return 'Unable to complete the request. Please try again.'
}
