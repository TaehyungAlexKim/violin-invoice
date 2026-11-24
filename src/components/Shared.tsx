import type { ReactNode } from 'react'

export function Loading({ message = 'Loading…' }: { message?: string }) {
  return <p className="loading" role="status"><span className="spinner" aria-hidden="true" />{message}</p>
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="state error-state" role="alert">
    <p>{message}</p>
    {onRetry && <button type="button" className="primary" onClick={onRetry}>Retry</button>}
  </div>
}

export function EmptyState({ message }: { message: string }) {
  return <div className="empty-state" role="status">{message}</div>
}

export function StatusMessage({ kind = 'status', children }: { kind?: 'status' | 'alert'; children: ReactNode }) {
  return <p className={kind === 'alert' ? 'error' : 'success'} role={kind}>{children}</p>
}
