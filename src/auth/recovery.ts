import { consumeInitialRecoveryCallback } from '../data/supabase'
import type { Session } from '@supabase/supabase-js'
import { decideRecoveryTransition, recoveryInProgressKey, scrubAuthParamsAndRoute } from '../domain/auth'

export const recoverySuccessKey = 'violin-invoice-password-set'
export let recoveryCallbackConsumed = false
export function recoveryInProgress(): boolean { return sessionStorage.getItem(recoveryInProgressKey) === '1' }
export function clearRecoveryState(): void { sessionStorage.removeItem(recoveryInProgressKey) }
export function replaceCleanRoute(route: string): void { window.history.replaceState(window.history.state, '', scrubAuthParamsAndRoute(window.location.href, route)) }
export function finishRecovery(route: string): void { clearRecoveryState(); replaceCleanRoute(route) }
export function beginRecovery(event: string, session: Session | null, matchesInitialCallback: boolean): boolean {
  const decision=decideRecoveryTransition({event,hasSession:Boolean(session),matchesInitialCallback,active:recoveryInProgress(),consumed:recoveryCallbackConsumed})
  if(decision.kind==='ignore') return false
  recoveryCallbackConsumed=true
  consumeInitialRecoveryCallback()
  sessionStorage.setItem(recoveryInProgressKey,'1')
  replaceCleanRoute('/reset-password')
  return true
}
