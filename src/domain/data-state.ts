export type DataState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'empty'; data: T }
  | { status: 'error'; message: string }
  | { status: 'not-found' }

export function normalizeSupabaseError(error: unknown): string {
  const value = error as { code?: string; status?: number; message?: string } | null
  const message = value?.message || ''
  if (value?.status === 401 || value?.code === 'PGRST301') return 'Your session has expired. Sign in again.'
  if (value?.status === 403 || /permission denied|row-level security|rls/i.test(message)) {
    return 'You do not have permission to access this information.'
  }
  if (value?.status === 429 || /rate.?limit|too many requests/i.test(message)) {
    return 'Too many requests. Wait a moment and try again.'
  }
  if (/network|fetch|failed to fetch|timeout/i.test(message)) {
    return 'The service could not be reached. Check your connection and retry.'
  }
  return 'Unable to complete the request. Please try again.'
}
