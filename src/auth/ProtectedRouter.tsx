import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { isFixtureMode, supabase } from '../data/supabase'
import { clearWorkspaceOwnerCache } from '../data/workspace'
import { Loading, ErrorState } from '../components/Shared'
import { matchesInitialRecoverySession } from '../data/supabase'
import { clearRecoveryState, beginRecovery, recoveryInProgress, replaceCleanRoute } from './recovery'
import { Shell } from '../components/Shell'
import { Students } from '../pages/Students'
import { StudentDetail } from '../pages/StudentDetail'
import { Lessons } from '../pages/Lessons'
import { Invoices } from '../pages/Invoices'
import { InvoiceDetail } from '../pages/InvoiceDetail'
import { CreateInvoice } from '../pages/CreateInvoice'
import { Settings } from '../pages/Settings'
import { Login, ResetPassword } from './AuthPages'
import { isOperatorUserResult } from '../domain/auth'

export async function isOperatorUser(client: NonNullable<typeof supabase>, userId: string) {
  return isOperatorUserResult(client as never, userId)
}

export {
  buildPasswordResetRedirectUrl,
  hasImplicitRecoveryCallback,
  passwordResetRedirectUrl,
  signOutLocalSession,
  studentDeleteError,
  validatePassword,
} from './AuthPages'

function Protected() {
  const [sessionChecked,setSessionChecked]=useState(false)
  const [hasSession,setHasSession]=useState(false)
  const [hasAal2,setHasAal2]=useState(false)
  const [isOperator,setIsOperator]=useState(false)
  const [authorizationError,setAuthorizationError]=useState('')
  const [authCheckNonce,setAuthCheckNonce]=useState(0)
  const navigate=useNavigate()
  useEffect(()=>{
    if(!supabase){setSessionChecked(true);return}
    let active=true
    async function check(session:Session|null){
      setSessionChecked(false)
      if(!session&&isFixtureMode){
        const raw=typeof window!=='undefined'?window.localStorage.getItem('sb-127-auth-token'):null
        if(raw){
          try{
            const fixture=JSON.parse(raw) as Session
            if(fixture.access_token?.startsWith('eyJ')) session=fixture
          }catch{}
        }
      }
      setHasSession(Boolean(session))
      setAuthorizationError('')
      if(session && recoveryInProgress()){
        setSessionChecked(true)
        navigate('/reset-password',{replace:true})
        return
      }
      if(!session){
        clearWorkspaceOwnerCache()
        setHasAal2(false)
        setIsOperator(false)
        setSessionChecked(true)
        return
      }
      const assurance=await supabase!.auth.mfa.getAuthenticatorAssuranceLevel()
      if(assurance.error){
        if(active){setAuthorizationError('Unable to verify multi-factor authentication. Please retry.');setSessionChecked(true)}
        return
      }
      const aal2=assurance.data.currentLevel==='aal2'
      setHasAal2(aal2)
      if(!aal2){
        clearWorkspaceOwnerCache()
        setIsOperator(false)
        setSessionChecked(true)
        return
      }
      const operator=await isOperatorUser(supabase!,session.user.id)
      if(!active)return
      if(operator.status==='failure'){setAuthorizationError(operator.message);setSessionChecked(true);return}
      setIsOperator(operator.status==='allowed')
      setSessionChecked(true)
    }
    supabase.auth.getSession().then(({data,error})=>{
      if(error){setAuthorizationError('Unable to check this session. Please retry.');setSessionChecked(true);return}
      void check(data.session)
    })
    const {data}=supabase.auth.onAuthStateChange((event,s)=>{
      if(event==='SIGNED_OUT'){
        clearRecoveryState()
        clearWorkspaceOwnerCache()
      }
      if(event==='PASSWORD_RECOVERY' || recoveryInProgress())return
      void check(s)
    })
    return()=>{active=false;data.subscription.unsubscribe()}
  },[navigate,authCheckNonce])
  if(!sessionChecked)return <Loading message="Checking secure access…" />
  if(authorizationError)return <main className="login"><section className="card"><h1>Authorization check unavailable</h1><ErrorState message={authorizationError} onRetry={()=>setAuthCheckNonce(n=>n+1)} /></section></main>
  if(!hasSession)return <Navigate to="/login" replace />
  if(!hasAal2)return <Navigate to="/login" replace />
  if(!isOperator)return <main className="login"><h1>Access denied.</h1></main>
  return <Shell><Routes><Route path="/students" element={<Students/>}/><Route path="/students/:id" element={<StudentDetail/>}/><Route path="/lessons" element={<Lessons/>}/><Route path="/invoices" element={<Invoices/>}/><Route path="/invoices/new" element={<CreateInvoice/>}/><Route path="/invoices/:id" element={<InvoiceDetail/>}/><Route path="/settings" element={<Settings/>}/><Route path="*" element={<Navigate to="/students" replace/>}/></Routes></Shell>
}
export function RecoveryRouter() {
  const [ready,setReady]=useState(false)
  const navigate=useNavigate()
  useEffect(()=>{
    if(!supabase){
      setReady(true)
      return
    }
    let active=true
    const {data:listener}=supabase.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_OUT'){
        clearRecoveryState()
        return
      }
      if(beginRecovery(
        event,
        session,
        matchesInitialRecoverySession(session),
      )){
        navigate('/reset-password',{replace:true})
        return
      }
    })
    void supabase.auth.getSession().then(({data})=>{
      if(!active)return
      if(beginRecovery(
        'INITIAL_SESSION',
        data.session,
        matchesInitialRecoverySession(data.session),
      )){
        navigate('/reset-password',{replace:true})
      }else if(data.session && recoveryInProgress()){
        replaceCleanRoute('/reset-password')
        navigate('/reset-password',{replace:true})
      }
      setReady(true)
    })
    return()=>{
      active=false
      listener.subscription.unsubscribe()
    }
  },[navigate])
  if(!ready)return <p className="loading" role="status">Loading…</p>
  return <Routes>
    <Route path="/login" element={<Login/>}/>
    <Route path="/reset-password" element={<ResetPassword/>}/>
    <Route path="*" element={<Protected/>}/>
  </Routes>
}