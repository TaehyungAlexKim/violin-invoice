import { createClient } from '@supabase/supabase-js'
import {
  browserAuthOptions,
  hasImplicitRecoveryCallback,
  implicitRecoverySessionMatches,
} from '../domain/auth'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
let initialRecoveryHref = typeof window !== 'undefined' ? window.location.href : ''

export const initialRecoveryCallback = hasImplicitRecoveryCallback(initialRecoveryHref)
export const isConfigured = Boolean(url && key && !url.includes('your-project-ref') && !key.includes('replace'))
export const supabase = isConfigured
  ? createClient(url!, key!, { auth: browserAuthOptions })
  : null

let initialRecoveryCallbackAvailable = initialRecoveryCallback

export function matchesInitialRecoverySession(session: { access_token: string } | null): boolean {
  return initialRecoveryCallbackAvailable
    && implicitRecoverySessionMatches(initialRecoveryHref, session?.access_token)
}

export function consumeInitialRecoveryCallback(): void {
  initialRecoveryCallbackAvailable = false
  initialRecoveryHref = ''
}
