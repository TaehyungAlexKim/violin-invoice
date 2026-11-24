import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../data/supabase'
import { clearWorkspaceOwnerCache } from '../data/workspace'
import { decideMfaAccess, mfaFailureDecision } from '../domain/mfa'
import { buildPasswordResetRedirectUrl, isOperatorUserResult, passwordResetRequestError, recoveryInProgressKey, scrubAuthParamsAndRoute } from '../domain/auth'
import { authError } from '../domain/auth-errors'

const recoverySuccessKey = 'violin-invoice-password-set'

export async function isOperatorUser(client: NonNullable<typeof supabase>, userId: string) {
  return isOperatorUserResult(client as never, userId)
}

function recoveryInProgress(): boolean {
  return sessionStorage.getItem(recoveryInProgressKey) === '1'
}

function clearRecoveryState(): void {
  sessionStorage.removeItem(recoveryInProgressKey)
}

function replaceCleanRoute(route: string): void {
  window.history.replaceState(
    window.history.state,
    '',
    scrubAuthParamsAndRoute(window.location.href, route),
  )
}

function finishRecovery(route: string): void {
  clearRecoveryState()
  replaceCleanRoute(route)
}


function Login() {
  const [email,setEmail] = useState('')
  const [password,setPassword] = useState('')
  const [error,setError] = useState('')
  const [success,setSuccess] = useState('')
  const [phase,setPhase] = useState<'password'|'checking'|'enroll'|'verify'>('password')
  const [busy,setBusy] = useState(false)
  const [code,setCode] = useState('')
  const [mfa,setMfa] = useState<{
    factorId:string
    challengeId:string
    enrollment:boolean
    qrCode:string
    secret:string
  } | null>(null)
  const navigate = useNavigate()
  const sessionCheckStarted = useRef(false)
  useEffect(()=>{
    const message = sessionStorage.getItem(recoverySuccessKey)
    if(message){sessionStorage.removeItem(recoverySuccessKey);setSuccess(message)}
  },[])
  useEffect(()=>{
    if(!supabase || sessionCheckStarted.current)return
    sessionCheckStarted.current=true
    async function continueOperator(){
      const {data}=await supabase!.auth.getSession()
      if(!data.session || recoveryInProgress())return
      await inspectMfa(data.session.user.id,false)
    }
    void continueOperator()
    // The one-shot ref prevents this changing callback from repeating session work.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  },[inspectMfa])
  async function enterAppAfterAal2(userId:string){
    if(!supabase)return false
    const assurance=await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if(assurance.error || assurance.data.currentLevel!=='aal2'){
      setError('Multi-factor authentication is required before you can continue.')
      setPhase('password')
      return false
    }
    const operator=await isOperatorUser(supabase,userId)
    if(operator.status==='failure'){
      setError(operator.message)
      setPhase('password')
      return false
    }
    if(operator.status==='denied'){
      setError('Access denied.')
      setPhase('password')
      const signOutError=await signOutLocalSession(supabase)
      if(signOutError){
        setError(signOutError)
        return false
      }
      finishRecovery('/login')
      setPassword('')
      setMfa(null)
      setCode('')
      return false
    }
    setMfa(null)
    setCode('')
    finishRecovery('/students')
    navigate('/students',{replace:true})
    return true
  }
  async function startChallenge(factorId:string,enrollment:boolean,qrCode='',secret=''){
    if(!supabase)return
    setBusy(true)
    const {data,error}=await supabase.auth.mfa.challenge({factorId})
    setBusy(false)
    if(error || !data?.id){
      setError(mfaFailureDecision(error).message)
      setMfa({factorId,challengeId:'',enrollment,qrCode,secret})
      setPhase(enrollment?'enroll':'verify')
      return
    }
    setMfa({factorId,challengeId:data.id,enrollment,qrCode,secret})
    setPhase(enrollment?'enroll':'verify')
  }
  async function startEnrollment(){
    if(!supabase)return
    setBusy(true)
    setError('')
    const {data,error}=await supabase.auth.mfa.enroll({
      factorType:'totp',
      friendlyName:'Violin Invoice',
    })
    setBusy(false)
    if(error || !data || !('totp' in data)){
      setError(mfaFailureDecision(error).message)
      return
    }
    setMfa({
      factorId:data.id,
      challengeId:'',
      enrollment:true,
      qrCode:data.totp.qr_code,
      secret:data.totp.secret,
    })
    setPhase('enroll')
  }
  async function inspectMfa(userId:string,createEnrollment:boolean){
    if(!supabase)return
    setPhase('checking')
    setError('')
    const [factors,assurance]=await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ])
    if(factors.error || !factors.data || assurance.error){
      setPhase('password')
      setError('Unable to check multi-factor authentication. Sign in again to retry.')
      return
    }
    const decision=decideMfaAccess(assurance.data.currentLevel,factors.data.all)
    if(decision.kind==='allowed'){
      await enterAppAfterAal2(userId)
      return
    }
    if(decision.kind==='verify'){
      setMfa({factorId:decision.factorId,challengeId:'',enrollment:false,qrCode:'',secret:''})
      setPhase('verify')
      await startChallenge(decision.factorId,false)
      return
    }
    setMfa(null)
    setPhase('enroll')
    if(createEnrollment)await startEnrollment()
  }
  async function forgotPassword() {
    setError('')
    setSuccess('')
    const normalizedEmail=email.trim()
    if(!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)){
      setError('Enter a valid email address before requesting a reset.')
      return
    }
    if(!supabase){setError('Supabase is not configured. Add the public environment variables.');return}
    const {error}=await supabase.auth.resetPasswordForEmail(normalizedEmail,{redirectTo:passwordResetRedirectUrl()})
    if(error)setError(passwordResetRequestError(error))
    else setSuccess('If this email belongs to an operator, a password reset email has been sent.')
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!supabase) { setError('Supabase is not configured. Add the public environment variables.'); return }
    setBusy(true)
    const {data,error} = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error || !data.user) setError(authError(error ?? new Error('Sign in failed.')))
    else {
      finishRecovery('/login')
      await inspectMfa(data.user.id,true)
    }
  }
  async function verifyMfa(event:FormEvent){
    event.preventDefault()
    if(!supabase || !mfa || !/^\d{6}$/.test(code))return
    setBusy(true)
    setError('')
    let challengeId=mfa.challengeId
    if(!challengeId){
      const challenge=await supabase.auth.mfa.challenge({factorId:mfa.factorId})
      if(challenge.error || !challenge.data?.id){
        setBusy(false)
        setError(mfaFailureDecision(challenge.error).message)
        return
      }
      challengeId=challenge.data.id
    }
    const {error}=await supabase.auth.mfa.verify({
      factorId:mfa.factorId,
      challengeId,
      code,
    })
    setBusy(false)
    if(error){
      const failure=mfaFailureDecision(error)
      setError(failure.message)
      setCode('')
      if(failure.challengeExpired)setMfa({...mfa,challengeId:''})
      return
    }
    const {data}=await supabase.auth.getSession()
    if(data.session)await enterAppAfterAal2(data.session.user.id)
  }
  async function restartEnrollment(){
    if(!supabase)return
    const factorId=mfa?.factorId
    setBusy(true)
    setError('')
    if(factorId){
      const {error}=await supabase.auth.mfa.unenroll({factorId})
      if(error){
        setBusy(false)
        setError('Unable to restart authenticator enrollment. Sign out and try again.')
        return
      }
    }
    setBusy(false)
    setMfa(null)
    setCode('')
    await startEnrollment()
  }
  async function signOutOfMfa(){
    if(!supabase)return
    const signOutError=await signOutLocalSession(supabase)
    if(signOutError){
      setError(signOutError)
      return
    }
    finishRecovery('/login')
    setMfa(null)
    setCode('')
    setError('')
    setPassword('')
    setPhase('password')
  }
  if(phase==='checking'){
    return <main className="login"><p className="loading" role="status">Checking multi-factor authentication…</p></main>
  }
  if(phase==='enroll' || phase==='verify'){
    const qrSource=mfa?.qrCode || ''
    return <main className="login"><section className="card mfa-card">
      <h1>{phase==='enroll'?'Set up authenticator':'Verify sign in'}</h1>
      {phase==='enroll' && mfa?.qrCode ? <>
        <p>Scan this QR code with your authenticator app, then enter its current six-digit code.</p>
        <img className="mfa-qr" src={qrSource} alt="Authenticator QR code" />
        <p className="mfa-secret-label">Can’t scan the QR code?</p>
        <code className="mfa-secret">{mfa.secret}</code>
        <p>Save the authenticator account and any recovery information in a secure password manager.</p>
      </> : phase==='enroll' ? <>
        <p>Protect this operator account with an authenticator app before entering the workspace.</p>
        <button className="primary" type="button" disabled={busy} onClick={startEnrollment}>
          {busy?'Preparing…':'Set up authenticator'}
        </button>
      </> : <p>Enter the current six-digit code from your authenticator app.</p>}
      {mfa && (phase==='verify' || mfa.qrCode) && <form onSubmit={verifyMfa} className="mfa-form">
        <label>Six-digit code<input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={event=>setCode(event.target.value.replace(/\D/g,'').slice(0,6))}
          required
        /></label>
        <button className="primary" type="submit" disabled={busy || code.length!==6}>
          {busy?'Verifying…':'Verify and continue'}
        </button>
      </form>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="mfa-actions">
        {phase==='verify' && mfa && <button type="button" disabled={busy} onClick={()=>startChallenge(mfa.factorId,false)}>Get a new challenge</button>}
        {phase==='enroll' && mfa && <button type="button" disabled={busy} onClick={restartEnrollment}>Restart enrollment</button>}
        <button type="button" disabled={busy} onClick={signOutOfMfa}>Sign out</button>
      </div>
    </section></main>
  }
  return <main className="login"><form onSubmit={submit} className="card">
    <h1>Violin Lesson Invoices</h1>
    <label>Email<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required /></label>
    <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required /></label>
    {error && <p className="error" role="alert">{error}</p>}
    {success && <p className="success" role="status">{success}</p>}
    <button className="primary" type="submit" disabled={busy}>{busy?'Signing in…':'Sign in'}</button>
    <button className="forgot-button" type="button" onClick={forgotPassword}>Forgot password?</button>
  </form></main>
}
function ResetPassword() {
  const [checking,setChecking]=useState(true)
  const [hasRecoverySession,setHasRecoverySession]=useState(false)
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [confirmation,setConfirmation]=useState('')
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const navigate=useNavigate()

  useEffect(()=>{
    if(!supabase){setChecking(false);setError('Supabase is not configured.');return}
    async function checkSession(){
      const {data}=await supabase!.auth.getSession()
      if(data.session && recoveryInProgress()){
        setHasRecoverySession(true)
      }
      setChecking(false)
    }
    void checkSession()
    const {data}=supabase.auth.onAuthStateChange((event,session)=>{
      if(event==='PASSWORD_RECOVERY' && session){
        if(recoveryInProgress()){
          setHasRecoverySession(true)
          setChecking(false)
        }
      }
      if(event==='SIGNED_OUT'){
        clearRecoveryState()
        setHasRecoverySession(false)
      }
    })
    return()=>data.subscription.unsubscribe()
  },[])

  async function sendReset(event:FormEvent){
    event.preventDefault()
    setError('')
    setMessage('')
    if(!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())){
      setError('Enter a valid email address.')
      return
    }
    if(!supabase){setError('Supabase is not configured.');return}
    const {error}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:passwordResetRedirectUrl()})
    if(error)setError(passwordResetRequestError(error))
    else setMessage('If this email belongs to an operator, a password reset email has been sent.')
  }

  async function setPasswordSubmit(event:FormEvent){
    event.preventDefault()
    setError('')
    setMessage('')
    const validationError=validatePassword(password,confirmation)
    if(validationError){setError(validationError);return}
    if(!supabase){setError('Supabase is not configured.');return}
    const {error}=await supabase.auth.updateUser({password})
    if(error){
      setError(error.message?.toLowerCase().includes('session')
        ? 'The recovery session has expired. Request a new reset email.'
        : 'Unable to set the password. Please try again.')
      return
    }
    const signOutError=await signOutLocalSession(supabase)
    if(signOutError){
      setError(signOutError)
      return
    }
    finishRecovery('/login')
    setPassword('')
    setConfirmation('')
    sessionStorage.setItem(recoverySuccessKey,'Your password is set. You can now sign in.')
    navigate('/login',{replace:true})
  }

  async function cancelRecovery(){
    if(!supabase)return
    setError('')
    const signOutError=await signOutLocalSession(supabase)
    if(signOutError){
      setError(signOutError)
      return
    }
    finishRecovery('/login')
    setHasRecoverySession(false)
    navigate('/login',{replace:true})
  }

  if(checking)return <main className="login"><p className="loading" role="status">Checking reset link…</p></main>
  return <main className="login"><section className="card reset-card">
    <h1>{hasRecoverySession?'Set your password':'Password reset link required'}</h1>
    {hasRecoverySession ? <>
      <p>Choose a new password for this operator account.</p>
      <form onSubmit={setPasswordSubmit} className="reset-form">
        <label>New password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password" minLength={6} required /></label>
        <label>Confirm new password<input type="password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="new-password" minLength={6} required /></label>
        {error && <p className="error" role="alert">{error}</p>}
        {message && <p className="success" role="status">{message}</p>}
        <button className="primary" type="submit">Set password</button>
      </form>
      <button type="button" className="forgot-button" onClick={cancelRecovery}>Cancel and sign out</button>
    </> : <>
      <p>This page needs a valid password recovery link from Supabase. Open the most recent reset email, or request another one below.</p>
      <form onSubmit={sendReset} className="reset-form">
        <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required /></label>
        {error && <p className="error" role="alert">{error}</p>}
        {message && <p className="success" role="status">{message}</p>}
        <button className="primary" type="submit">Send reset email</button>
      </form>
      <Link to="/login">Return to login</Link>
    </>}
  </section></main>
}

export { buildPasswordResetRedirectUrl, hasImplicitRecoveryCallback } from '../domain/auth'
export function validatePassword(password: string, confirmation: string): string {
  if (password.length < 6) return 'Password must be at least 6 characters.'
  if (password !== confirmation) return 'Passwords do not match.'
  return ''
}
export function passwordResetRedirectUrl(): string { return buildPasswordResetRedirectUrl(window.location.origin, import.meta.env.BASE_URL) }
export async function signOutLocalSession(client: NonNullable<typeof supabase>, afterRemoval: () => void = clearWorkspaceOwnerCache): Promise<string> {
  const {error}=await client.auth.signOut({scope:'local'})
  if(error)return 'Unable to sign out. Your local session is still active; please try again.'
  afterRemoval(); return ''
}
export function studentDeleteError(error: unknown): string {
  const value=error as {code?:string;message?:string}
  if(value.code==='23503'||/foreign key|linked|invoice|lesson/i.test(value.message||'')) return 'This student is linked to lessons or invoices and cannot be deleted.'
  return 'Unable to delete the student. Please try again.'
}
export { Login, ResetPassword }
