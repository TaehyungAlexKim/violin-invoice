import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { HashRouter, Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import {
  consumeInitialRecoveryCallback,
  matchesInitialRecoverySession,
  supabase,
} from './data/supabase'
import { clearWorkspaceOwnerCache, loadWorkspaceOwnerId } from './data/workspace'
import type { Session } from '@supabase/supabase-js'
import { parseCadToCents, formatCad } from './domain/money'
import { addCalendarDay, todayInVancouver, parseDateOnly } from './domain/date-only'
import { downloadInvoice, pdfDownloadErrorMessage } from './pdf/download-invoice'
import type { InvoiceSnapshot } from './domain/invoice-snapshot'
import { decideMfaAccess, mfaFailureDecision } from './domain/mfa'
import {
  buildPasswordResetRedirectUrl,
  decideRecoveryTransition,
  lessonSaveError,
  passwordResetRequestError,
  recoveryInProgressKey,
  scrubAuthParamsAndRoute,
} from './domain/auth'
import './App.css'

type Student = { id:string; name:string; recipient_name?:string|null; email?:string|null; phone?:string|null; billing_address?:string|null; memo?:string|null }
type Lesson = { id:string; student_id:string; lesson_date:string; minutes:number; charge_cents:number; entry_key:string }
type Invoice = { id:string; student_id:string; status:'draft'|'finalized'; period_start:string; period_end:string; issue_date?:string|null; finalized_at?:string|null; invoice_number?:string|null; snapshot_json?:InvoiceSnapshot|null; snapshot_schema_version?:number|null }

function authError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const status = (error as {status?:number}|null)?.status
  if(status===429 || /rate.?limit|too many requests|over_request_rate_limit/i.test(message)) {
    return 'Too many requests. Wait a few minutes and try again.'
  }
  if (/invalid|password|credentials/i.test(message)) return 'Invalid email or password.'
  if (/operator|access/i.test(message)) return 'Access denied.'
  return 'Unable to complete the request. Please try again.'
}

export {
  buildPasswordResetRedirectUrl,
  hasImplicitRecoveryCallback,
} from './domain/auth'

export function validatePassword(password: string, confirmation: string): string {
  if (password.length < 6) return 'Password must be at least 6 characters.'
  if (password !== confirmation) return 'Passwords do not match.'
  return ''
}

export function passwordResetRedirectUrl(): string {
  return buildPasswordResetRedirectUrl(window.location.origin, import.meta.env.BASE_URL)
}

const recoverySuccessKey = 'violin-invoice-password-set'
let recoveryCallbackConsumed = false

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

function beginRecovery(
  event: string,
  session: Session | null,
  matchesInitialCallback: boolean,
): boolean {
  const decision = decideRecoveryTransition({
    event,
    hasSession: Boolean(session),
    matchesInitialCallback,
    active: recoveryInProgress(),
    consumed: recoveryCallbackConsumed,
  })
  if(decision.kind === 'ignore')return false
  recoveryCallbackConsumed = true
  consumeInitialRecoveryCallback()
  sessionStorage.setItem(recoveryInProgressKey, '1')
  replaceCleanRoute('/reset-password')
  return true
}

export async function signOutLocalSession(
  client: NonNullable<typeof supabase>,
  afterRemoval: () => void = clearWorkspaceOwnerCache,
): Promise<string> {
  const {error}=await client.auth.signOut({scope:'local'})
  if(error)return 'Unable to sign out. Your local session is still active; please try again.'
  afterRemoval()
  return ''
}

export function studentDeleteError(error: unknown): string {
  const value = error as {code?:string; message?:string}
  if (value.code === '23503' || /foreign key|linked|invoice|lesson/i.test(value.message||'')) {
    return 'This student is linked to lessons or invoices and cannot be deleted.'
  }
  return 'Unable to delete the student. Please try again.'
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
    if(!await isOperatorUser(supabase,userId)){
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

function Shell({children}:{children:React.ReactNode}) {
  const [email,setEmail]=useState('')
  const [logoutError,setLogoutError]=useState('')
  const navigate=useNavigate()
  useEffect(()=>{ supabase?.auth.getUser().then(({data})=>setEmail(data.user?.email ?? '')) },[])
  async function logout(){
    if(!supabase)return
    setLogoutError('')
    const signOutError=await signOutLocalSession(supabase)
    if(signOutError){setLogoutError(signOutError);return}
    finishRecovery('/login')
    setEmail('')
    navigate('/login',{replace:true})
  }
  return <div className="shell">
    <header><strong>Violin Invoices</strong><div className="account"><span>{email}</span><button onClick={logout}>Log out</button></div></header>
    {logoutError&&<p className="error account-error" role="alert">{logoutError}</p>}
    <nav aria-label="Main navigation">
      <NavLink to="/students">Students</NavLink>
      <NavLink to="/lessons">Lessons</NavLink>
      <NavLink to="/invoices">Invoices</NavLink>
      <NavLink to="/settings">Settings</NavLink>
    </nav>
    <main>{children}</main>
  </div>
}

function Settings() {
  const [teacherName,setTeacherName]=useState(''); const [businessName,setBusinessName]=useState('')
  const [address,setAddress]=useState(''); const [email,setEmail]=useState(''); const [phone,setPhone]=useState('')
  const [message,setMessage]=useState('')
  useEffect(()=>{ if(!supabase)return; supabase.from('teacher_settings').select('*').maybeSingle().then(({data})=>{
    if(data){setTeacherName(data.teacher_name||'');setBusinessName(data.business_name||'');setAddress(data.address||'');setEmail(data.email||'');setPhone(data.phone||'')}
  })},[])
  async function save(e:FormEvent){e.preventDefault();if(!supabase)return
    const workspaceOwnerId=await loadWorkspaceOwnerId(supabase,(await supabase.auth.getUser()).data.user!.id)
    if(!workspaceOwnerId){setMessage('Access denied.');return}
    const {error}=await supabase.from('teacher_settings').upsert({
    owner_id:workspaceOwnerId,
    teacher_name:teacherName.trim(),business_name:businessName.trim()||null,address:address.trim()||null,email:email.trim()||null,phone:phone.trim()||null,currency:'CAD'
  });setMessage(error?authError(error):'Settings saved.') }
  return <section><h1>Settings</h1><form onSubmit={save} className="form-grid">
    <label>Teacher name *<input value={teacherName} onChange={e=>setTeacherName(e.target.value)} required maxLength={200}/></label>
    <label>Business or trading name<input value={businessName} onChange={e=>setBusinessName(e.target.value)} maxLength={200}/></label>
    <label>Address<textarea value={address} onChange={e=>setAddress(e.target.value)} maxLength={1000}/></label>
    <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <label>Phone<input value={phone} onChange={e=>setPhone(e.target.value)} maxLength={80}/></label>
    <label>Currency<input value="CAD" disabled /></label>
    <button className="primary" type="submit">Save settings</button>
  </form>{message&&<p role="status">{message}</p>}</section>
}

function Students() {
  const [students,setStudents]=useState<Student[]>([]); const [search,setSearch]=useState('')
  const [form,setForm]=useState<Partial<Student>>({name:''}); const [message,setMessage]=useState('')
  const [lessons,setLessons]=useState<Lesson[]>([]); const [invoices,setInvoices]=useState<Invoice[]>([]); const [claimed,setClaimed]=useState<Set<string>>(new Set())
  const navigate=useNavigate()
  async function load(){if(!supabase)return;const [s,l,i,c]=await Promise.all([supabase.from('students').select('*').order('name'),supabase.from('lessons').select('*'),supabase.from('invoices').select('*'),supabase.from('invoice_lesson_claims').select('lesson_id')]);setStudents(s.data||[]);setLessons(l.data||[]);setInvoices(i.data||[]);setClaimed(new Set((c.data||[]).map(x=>x.lesson_id))) }
  useEffect(()=>{load()},[])
  async function save(e:FormEvent){e.preventDefault();if(!supabase)return;
    const user=(await supabase.auth.getUser()).data.user
    if(!user)return
    const workspaceOwnerId=await loadWorkspaceOwnerId(supabase,user.id)
    if(!workspaceOwnerId){setMessage('Access denied.');return}
    const payload={owner_id:workspaceOwnerId,name:(form.name||'').trim(),recipient_name:form.recipient_name?.trim()||null,email:form.email?.trim()||null,phone:form.phone?.trim()||null,billing_address:form.billing_address?.trim()||null,memo:form.memo?.trim()||null}
    const {error}=form.id?await supabase.from('students').update(payload).eq('id',form.id):await supabase.from('students').insert(payload)
    setMessage(error?authError(error):'Student saved.')
    if(!error){setForm({name:''});load()}
  }
  const shown=students.filter(s=>s.name.toLowerCase().includes(search.toLowerCase()))
  return <section><h1>Students</h1><input aria-label="Search students" placeholder="Search students" value={search} onChange={e=>setSearch(e.target.value)} />
    <div className="student-layout"><div className="cards">{shown.map(s=>{
      const studentLessons=lessons.filter(l=>l.student_id===s.id&&!claimed.has(l.id));const unbilled=studentLessons.reduce((n,l)=>n+l.charge_cents,0)
      const recent=invoices.filter(i=>i.student_id===s.id&&i.status==='finalized').sort((a,b)=>b.period_end.localeCompare(a.period_end)||String(b.finalized_at||'').localeCompare(String(a.finalized_at||''))||b.id.localeCompare(a.id))[0]
      return <button className="card student-card" key={s.id} onClick={()=>navigate(`/students/${s.id}`)}><strong>{s.name}</strong><span>{recent?`Recent finalized period: ${recent.period_end}`:'No finalized period'}</span><span>{studentLessons.length} unbilled lesson(s) · {formatCad(unbilled)}</span></button>
    })}{shown.length===0&&<p>No students found.</p>}</div>
    <form onSubmit={save} className="form-grid card"><h2>{form.id?'Edit student':'Add student'}</h2>
      <label>Name *<input value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})} required maxLength={200}/></label>
      <label>Recipient or parent<input value={form.recipient_name||''} onChange={e=>setForm({...form,recipient_name:e.target.value})}/></label>
      <label>Email<input type="email" value={form.email||''} onChange={e=>setForm({...form,email:e.target.value})}/></label>
      <label>Phone<input value={form.phone||''} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
      <label>Billing address<textarea value={form.billing_address||''} onChange={e=>setForm({...form,billing_address:e.target.value})} maxLength={1000}/></label>
      <label>Internal memo<textarea value={form.memo||''} onChange={e=>setForm({...form,memo:e.target.value})} maxLength={4000}/></label>
      <div className="actions"><button className="primary" type="submit">Save student</button>{form.id&&<button type="button" onClick={()=>setForm({name:''})}>Cancel</button>}</div>
    </form></div>{message&&<p role="status">{message}</p>}</section>
}

function StudentDetail() {
  const {id}=useParams(); const [student,setStudent]=useState<Student|null>(null); const [lessons,setLessons]=useState<Lesson[]>([]); const [invoices,setInvoices]=useState<Invoice[]>([]); const [claimed,setClaimed]=useState<Set<string>>(new Set())
  const [editing,setEditing]=useState(false); const [form,setForm]=useState<Partial<Student>>({name:''}); const [message,setMessage]=useState('')
  const navigate=useNavigate()
  async function load(){if(!supabase||!id)return;const [s,l,i,c]=await Promise.all([supabase.from('students').select('*').eq('id',id).maybeSingle(),supabase.from('lessons').select('*').eq('student_id',id).order('lesson_date',{ascending:false}),supabase.from('invoices').select('*').eq('student_id',id).order('period_end',{ascending:false}).order('finalized_at',{ascending:false}).order('id',{ascending:false}),supabase.from('invoice_lesson_claims').select('lesson_id')]);setStudent(s.data);setLessons(l.data||[]);setInvoices(i.data||[]);setClaimed(new Set((c.data||[]).map(x=>x.lesson_id)));if(s.data)setForm(s.data)}
  useEffect(()=>{load()},[id])
  function beginEdit(){if(!student)return;setForm(student);setEditing(true);setMessage('')}
  async function saveEdit(e:FormEvent){e.preventDefault();if(!supabase||!student)return;const payload={name:(form.name||'').trim(),recipient_name:form.recipient_name?.trim()||null,email:form.email?.trim()||null,phone:form.phone?.trim()||null,billing_address:form.billing_address?.trim()||null,memo:form.memo?.trim()||null};const {error}=await supabase.from('students').update(payload).eq('id',student.id);if(error){setMessage(authError(error));return}setEditing(false);setMessage('Student saved.');await load()}
  async function deleteStudent(){if(!supabase||!student)return;if(invoices.length||lessons.length){setMessage('This student is linked to lessons or invoices and cannot be deleted.');return}if(!confirm(`Delete ${student.name}?`))return;const {error}=await supabase.from('students').delete().eq('id',student.id);if(error){setMessage(studentDeleteError(error));return}navigate('/students')}
  if(!student)return <p>Loading student…</p>
  const unbilled=lessons.filter(l=>!claimed.has(l.id));const total=unbilled.reduce((n,l)=>n+l.charge_cents,0)
  return <section><h1>{student.name}</h1><div className="actions"><button type="button" onClick={beginEdit}>Edit student</button><button type="button" onClick={deleteStudent}>Delete student</button></div>
    {editing&&<form onSubmit={saveEdit} className="form-grid card"><h2>Edit student</h2>
      <label>Name *<input value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})} required maxLength={200}/></label>
      <label>Recipient or parent<input value={form.recipient_name||''} onChange={e=>setForm({...form,recipient_name:e.target.value})}/></label>
      <label>Email<input type="email" value={form.email||''} onChange={e=>setForm({...form,email:e.target.value})}/></label>
      <label>Phone<input value={form.phone||''} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
      <label>Billing address<textarea value={form.billing_address||''} onChange={e=>setForm({...form,billing_address:e.target.value})} maxLength={1000}/></label>
      <label>Internal memo<textarea value={form.memo||''} onChange={e=>setForm({...form,memo:e.target.value})} maxLength={4000}/></label>
      <div className="actions"><button className="primary" type="submit">Save student</button><button type="button" onClick={()=>{setEditing(false);setMessage('')}}>Cancel</button></div>
    </form>}
    {message&&<p role={/cannot be deleted|Unable to delete/.test(message)?'alert':'status'}>{message}</p>}
    <div className="card invoice-detail"><p><strong>Unbilled:</strong> {unbilled.length} lesson(s) · {formatCad(total)}</p>{student.recipient_name&&<p><strong>Recipient:</strong> {student.recipient_name}</p>}{student.email&&<p><strong>Email:</strong> {student.email}</p>}{student.phone&&<p><strong>Phone:</strong> {student.phone}</p>}{student.billing_address&&<p><strong>Billing address:</strong> {student.billing_address}</p>}</div>
    <h2>Recent unbilled lessons</h2><ul>{unbilled.slice(0,10).map(l=><li key={l.id}>{l.lesson_date} — {l.minutes} minutes — {formatCad(l.charge_cents)}</li>)}</ul>
    <h2>Invoices</h2><div className="cards">{invoices.map(i=><NavLink className="card student-card" key={i.id} to={`/invoices/${i.id}`}><strong>{i.invoice_number||'Draft'}</strong><span>{i.status}</span><span>{i.period_start} – {i.period_end}</span></NavLink>)}</div>
  </section>
}

function Lessons() {
  const [students,setStudents]=useState<Student[]>([]); const [lessons,setLessons]=useState<Lesson[]>([])
  const [studentId,setStudentId]=useState(''); const [lessonDate,setLessonDate]=useState(todayInVancouver())
  const [minutes,setMinutes]=useState('60'); const [amount,setAmount]=useState('65.00'); const [message,setMessage]=useState('')
  const [filterStudent,setFilterStudent]=useState(''); const [filterStart,setFilterStart]=useState(''); const [filterEnd,setFilterEnd]=useState(''); const [billed,setBilled]=useState<'all'|'billed'|'unbilled'>('all')
  const [claimed,setClaimed]=useState<Set<string>>(new Set()); const [editing,setEditing]=useState<Lesson|null>(null)
  async function load(){if(!supabase)return;const [s,l,c]=await Promise.all([supabase.from('students').select('*').order('name'),supabase.from('lessons').select('*').order('lesson_date',{ascending:false}).order('id',{ascending:false}),supabase.from('invoice_lesson_claims').select('lesson_id')]);setStudents(s.data||[]);setLessons(l.data||[]);setClaimed(new Set((c.data||[]).map(x=>x.lesson_id)))}
  useEffect(()=>{load()},[])
  async function save(e:FormEvent){e.preventDefault();setMessage('')
    try{
      parseDateOnly(lessonDate); const cents=parseCadToCents(amount)
      if(!supabase||!studentId)return
      const user=(await supabase.auth.getUser()).data.user;if(!user)return
      const workspaceOwnerId=await loadWorkspaceOwnerId(supabase,user.id)
      if(!workspaceOwnerId){setMessage('Access denied.');return}
      const payload={owner_id:workspaceOwnerId,student_id:studentId,lesson_date:lessonDate,minutes:Number(minutes),charge_cents:cents,entry_key:crypto.randomUUID()}
      const {data,error}=await supabase.from('lessons').insert(payload).select().maybeSingle()
      if(error){setMessage(lessonSaveError(error));return}
      const duplicates=lessons.filter(x=>x.student_id===studentId&&x.lesson_date===lessonDate&&x.minutes===Number(minutes)&&x.charge_cents===cents)
      setMessage(duplicates.length?'Lesson saved. Duplicate candidate: an earlier matching lesson exists.':'Lesson saved.')
      if(data)setLessons(prev=>[data as Lesson,...prev])
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to save lesson.')}
  }
  async function editLesson(lesson:Lesson){if(claimed.has(lesson.id)){setMessage('This lesson is included in a finalized invoice and cannot be edited.');return}setEditing(lesson);setLessonDate(lesson.lesson_date);setMinutes(String(lesson.minutes));setAmount((lesson.charge_cents/100).toFixed(2))}
  async function saveEdit(e:FormEvent){e.preventDefault();if(!supabase||!editing)return;try{const cents=parseCadToCents(amount);const {error}=await supabase.from('lessons').update({lesson_date:lessonDate,minutes:Number(minutes),charge_cents:cents}).eq('id',editing.id);if(error){setMessage(lessonSaveError(error));return}setMessage('Lesson saved.');setEditing(null);load()}catch(error){setMessage(error instanceof Error?error.message:'Unable to save lesson.')}}
  async function deleteLesson(lesson:Lesson){if(claimed.has(lesson.id)){setMessage('This lesson is included in a finalized invoice and cannot be deleted.');return}if(!confirm('Delete this lesson?'))return;if(!supabase)return;const {error}=await supabase.from('lessons').delete().eq('id',lesson.id);setMessage(error?authError(error):'Lesson deleted.');if(!error)load()}
  const filtered=lessons.filter(l=>(!filterStudent||l.student_id===filterStudent)&&(!filterStart||l.lesson_date>=filterStart)&&(!filterEnd||l.lesson_date<=filterEnd)&&(billed==='all'||(billed==='billed'?claimed.has(l.id):!claimed.has(l.id))))
  return <section><h1>Lessons</h1><form onSubmit={editing?saveEdit:save} className="lesson-form card">
    <label>Student<select value={editing?.student_id||studentId} onChange={e=>editing?setEditing({...editing,student_id:e.target.value}):setStudentId(e.target.value)} required disabled={Boolean(editing)}><option value="">Select a student</option>{students.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
    <label>Lesson date<input type="date" value={lessonDate} onChange={e=>setLessonDate(e.target.value)} required/></label>
    <label>Minutes<input type="number" min="1" max="1440" value={minutes} onChange={e=>setMinutes(e.target.value)} required/></label>
    <label>Actual charge (CAD)<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} required/></label>
    <button className="primary" type="submit">{editing?'Save lesson':'Add lesson'}</button>{editing&&<button type="button" onClick={()=>setEditing(null)}>Cancel edit</button>}
  </form>{message&&<p role="status">{message}</p>}
  <div className="form-grid filter-grid card">
    <label>Student<select value={filterStudent} onChange={e=>setFilterStudent(e.target.value)}><option value="">All students</option>{students.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
    <label>Start date<input type="date" value={filterStart} onChange={e=>setFilterStart(e.target.value)}/></label>
    <label>End date<input type="date" value={filterEnd} onChange={e=>setFilterEnd(e.target.value)}/></label>
    <label>Status<select value={billed} onChange={e=>setBilled(e.target.value as 'all'|'billed'|'unbilled')}><option value="all">All</option><option value="unbilled">Unbilled</option><option value="billed">Billed</option></select></label>
  </div>
  <div className="table-wrap"><table><thead><tr><th>Date</th><th>Student</th><th>Minutes</th><th>Actual charge</th><th>Status</th><th>Actions</th></tr></thead><tbody>{filtered.map(l=><tr key={l.id}><td>{l.lesson_date}</td><td>{students.find(s=>s.id===l.student_id)?.name||'Unknown student'}</td><td>{l.minutes}</td><td>{formatCad(l.charge_cents)}</td><td>{claimed.has(l.id)?'Billed':'Unbilled'}</td><td><button type="button" onClick={()=>editLesson(l)} disabled={claimed.has(l.id)}>Edit</button> <button type="button" onClick={()=>deleteLesson(l)} disabled={claimed.has(l.id)}>Delete</button></td></tr>)}</tbody></table></div></section>
}

function Invoices() {
  const [students,setStudents]=useState<Student[]>([]); const [invoices,setInvoices]=useState<Invoice[]>([])
  const [tab,setTab]=useState<'draft'|'finalized'>('draft'); const [studentFilter,setStudentFilter]=useState('')
  useEffect(()=>{if(!supabase)return;Promise.all([supabase.from('students').select('*').order('name'),supabase.from('invoices').select('*').order('period_end',{ascending:false})]).then(([s,i])=>{setStudents(s.data||[]);setInvoices(i.data||[])})},[])
  const shown=invoices.filter(i=>i.status===tab&&(!studentFilter||i.student_id===studentFilter)).sort((a,b)=>b.period_end.localeCompare(a.period_end)||String(b.finalized_at||'').localeCompare(String(a.finalized_at||''))||b.id.localeCompare(a.id))
  return <section><h1>Invoices</h1><div className="invoice-actions"><div className="tabs"><button className={tab==='draft'?'active':''} onClick={()=>setTab('draft')}>Draft</button><button className={tab==='finalized'?'active':''} onClick={()=>setTab('finalized')}>Finalized</button></div><NavLink className="primary button-link" to="/invoices/new">New invoice</NavLink></div>
    <label>Filter by student<select value={studentFilter} onChange={e=>setStudentFilter(e.target.value)}><option value="">All students</option>{students.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
    {shown.length===0&&<p className="empty">No {tab} invoices.</p>}
    <div className="cards">{shown.map(i=><a className="card student-card" href={`#/invoices/${i.id}`} key={i.id}><strong>{i.invoice_number||'Draft'}</strong><span>{students.find(s=>s.id===i.student_id)?.name}</span><span>{i.period_start} – {i.period_end}</span></a>)}</div>
  </section>
}

function InvoiceDetail() {
  const {id}=useParams(); const navigate=useNavigate()
  const [invoice,setInvoice]=useState<Invoice|null>(null); const [students,setStudents]=useState<Student[]>([])
  const [draftStart,setDraftStart]=useState(todayInVancouver()); const [draftEnd,setDraftEnd]=useState(todayInVancouver())
  const [eligible,setEligible]=useState<Lesson[]>([]); const [message,setMessage]=useState(''); const [teacherName,setTeacherName]=useState('')
  const [previewing,setPreviewing]=useState(false); const [finalizing,setFinalizing]=useState(false); const [downloading,setDownloading]=useState(false)
  useEffect(()=>{if(!supabase||!id)return;(async()=>{
    const [inv,ss,teacher]=await Promise.all([supabase.from('invoices').select('*').eq('id',id).single(),supabase.from('students').select('*'),supabase.from('teacher_settings').select('teacher_name').maybeSingle()])
    setInvoice(inv.data);setStudents(ss.data||[]);setTeacherName(teacher.data?.teacher_name||'')
    if(inv.data){const start=inv.data.period_start,end=inv.data.period_end;setDraftStart(start);setDraftEnd(end)}
  })()},[id])
  async function preview(){if(!supabase||!invoice)return;
    setPreviewing(true)
    setMessage('')
    try{parseDateOnly(draftStart);parseDateOnly(draftEnd);if(draftStart>draftEnd){setMessage('The start date must be on or before the end date.');return}
      const {data,error}=await supabase.from('lessons').select('*').eq('student_id',invoice.student_id).gte('lesson_date',draftStart).lte('lesson_date',draftEnd).order('lesson_date').order('id')
      if(error){setMessage(authError(error));return}
      const {data:claimData,error:claimError}=await supabase.from('invoice_lesson_claims').select('lesson_id')
      if(claimError){setMessage(authError(claimError));return}
      const claimed=new Set((claimData||[]).map(c=>c.lesson_id))
      const eligibleLessons=(data||[]).filter(l=>!claimed.has(l.id))
      setEligible(eligibleLessons)
      const {data:finalized,error:finalizedError}=await supabase.from('invoices').select('period_start,period_end').eq('student_id',invoice.student_id).eq('status','finalized')
      if(finalizedError){setMessage(authError(finalizedError));return}
      const overlaps=(finalized||[]).some(i=>i.period_start<=draftEnd && i.period_end>=draftStart)
      if(overlaps)setMessage('This period overlaps an existing finalized invoice. Finalization is rejected.')
      else if(!eligibleLessons.length)setMessage('No unbilled lessons are available in this date range.')
      else setMessage(`Preview: ${eligibleLessons.length} eligible lesson(s), ${formatCad(eligibleLessons.reduce((n,l)=>n+l.charge_cents,0))}.`)
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to preview.')}
    finally{setPreviewing(false)}}
  useEffect(()=>{if(invoice?.status==='draft')preview()},[invoice])
  async function saveDraft(){if(!supabase||!invoice)return;const {error}=await supabase.from('invoices').update({period_start:draftStart,period_end:draftEnd}).eq('id',invoice.id);setMessage(error?authError(error):'Draft range saved.') }
  async function finalize(){if(!supabase||!invoice)return;if(!teacherName){setMessage('Enter the teacher name in Settings before finalizing.');return}
    setFinalizing(true)
    setMessage('Finalizing…')
    try{parseDateOnly(draftStart);parseDateOnly(draftEnd)}catch(error){setMessage(error instanceof Error?error.message:'A valid period start and end date are required.');return}
    if(draftStart>draftEnd){setMessage('The start date must be on or before the end date.');return}
    const {data,error}=await supabase.rpc('finalize_invoice',{p_invoice_id:invoice.id,p_period_start:draftStart,p_period_end:draftEnd})
    if(error){setFinalizing(false);setMessage(/overlap|included|already/i.test(error.message)?'This period or lesson is already included in a finalized invoice.':/start date|valid period/i.test(error.message)?error.message:authError(error));return}
    const snapshot=data as InvoiceSnapshot
    setInvoice({...invoice,status:'finalized',period_start:draftStart,period_end:draftEnd,snapshot_json:snapshot,invoice_number:snapshot.invoice.number,issue_date:snapshot.invoice.issueDate})
    try {
      await downloadInvoice(snapshot)
      setMessage('Invoice finalized. PDF download started.')
    } catch (error) {
      setMessage(`Invoice finalized. ${pdfDownloadErrorMessage(error)}`)
    } finally {
      setFinalizing(false)
    }
  }
  async function deleteDraft(){if(!supabase||!invoice)return;if(!confirm('Delete this draft?'))return;const {error}=await supabase.from('invoices').delete().eq('id',invoice.id);if(error)setMessage(authError(error));else navigate('/invoices')}
  async function downloadFinalized(){
    if(!invoice?.snapshot_json)return
    setDownloading(true)
    setMessage('')
    try{
      await downloadInvoice(invoice.snapshot_json)
      setMessage('PDF download started.')
    }catch(error){
      setMessage(pdfDownloadErrorMessage(error))
    }finally{
      setDownloading(false)
    }
  }
  if(!invoice)return <p>Loading invoice…</p>
  const student=students.find(s=>s.id===invoice.student_id)
  if(invoice.status==='finalized'){
    const snapshot=invoice.snapshot_json
    return <section><h1>Invoice {invoice.invoice_number}</h1><div className="card invoice-detail"><p><strong>Status:</strong> Finalized</p><p><strong>Issue date:</strong> {invoice.issue_date}</p><p><strong>Student:</strong> {student?.name}</p><p><strong>Service period:</strong> {invoice.period_start} – {invoice.period_end}</p>{invoice.finalized_at&&<p><strong>Finalized at:</strong> {invoice.finalized_at}</p>}<p><strong>Schema:</strong> {invoice.snapshot_schema_version??snapshot?.schemaVersion}</p>{snapshot&&<><p><strong>PDF template:</strong> {snapshot.render.templateVersion}</p><p><strong>Renderer:</strong> {snapshot.render.rendererName} {snapshot.render.rendererVersion}</p><p><strong>Font:</strong> {snapshot.render.fontManifest.family}</p><p><strong>Total:</strong> {formatCad(snapshot.totalCents)}</p></>}<p>Finalized invoices cannot be edited. If correction is needed, use a future void or credit workflow.</p>{snapshot&&<button className="primary" onClick={downloadFinalized} disabled={downloading}>{downloading?'Preparing PDF…':'Download PDF'}</button>}{message&&<p role="status">{message}</p>}</div></section>
  }
  return <section><h1>Invoice draft</h1><div className="form-grid card"><label>Student<select value={invoice.student_id} disabled>{students.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label>Start date<input type="date" value={draftStart} onChange={e=>{setDraftStart(e.target.value);setEligible([])}} /></label>
    <label>End date<input type="date" value={draftEnd} onChange={e=>{setDraftEnd(e.target.value);setEligible([])}} /></label>
    <div className="actions"><button onClick={preview} disabled={previewing}>{previewing?'Previewing…':'Preview'}</button><button onClick={saveDraft}>Save draft</button><button className="primary" onClick={finalize} disabled={finalizing||draftStart>draftEnd||!eligible.length||!teacherName}>{finalizing?'Finalizing…':'Finalize and download'}</button><button onClick={deleteDraft}>Delete draft</button></div>
  </div>{draftStart>draftEnd&&<p className="error">The start date must be on or before the end date.</p>}
  {!teacherName&&<p className="error">Enter the teacher name in Settings before finalizing.</p>}
  {!eligible.length&&!previewing&&<p className="empty">Finalize is disabled because there are no unbilled lessons in the selected date range.</p>}
  {message&&<p role="status">{message}</p>}<h2>Eligible lessons</h2><ul>{eligible.map(l=><li key={l.id}>{l.lesson_date} — {l.minutes} minutes — {formatCad(l.charge_cents)}</li>)}</ul></section>
}

function CreateInvoice() {
  const [students,setStudents]=useState<Student[]>([]); const [studentId,setStudentId]=useState(''); const navigate=useNavigate()
  useEffect(()=>{if(supabase)supabase.from('students').select('*').order('name').then(({data})=>setStudents(data||[]))},[])
  async function create(){if(!supabase||!studentId)return;const user=(await supabase.auth.getUser()).data.user;if(!user)return
    const workspaceOwnerId=await loadWorkspaceOwnerId(supabase,user.id)
    if(!workspaceOwnerId){alert('Access denied.');return}
    const end=todayInVancouver();let start=end.slice(0,7)+'-01'
    const {data:latest}=await supabase.from('invoices').select('period_end,finalized_at,id').eq('student_id',studentId).eq('status','finalized').order('period_end',{ascending:false}).order('finalized_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle()
    if(latest)start=addCalendarDay(latest.period_end)
    const {data,error}=await supabase.from('invoices').insert({owner_id:workspaceOwnerId,student_id:studentId,status:'draft',period_start:start,period_end:end}).select().single()
    if(error)alert(authError(error));else navigate(`/invoices/${data.id}`)
  }
  return <section><h1>Create invoice</h1><div className="card form-grid"><label>Student<select value={studentId} onChange={e=>setStudentId(e.target.value)}><option value="">Select a student</option>{students.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label><button className="primary" disabled={!studentId} onClick={create}>Create draft</button></div></section>
}

export async function isOperatorUser(client: NonNullable<typeof supabase>, userId: string): Promise<boolean> {
  const {data,error}=await client.from('app_operators').select('workspace_owner_id').eq('user_id',userId).maybeSingle()
  return !error && Boolean(data)
}

function Protected() {
  const [sessionChecked,setSessionChecked]=useState(false)
  const [hasSession,setHasSession]=useState(false)
  const [hasAal2,setHasAal2]=useState(false)
  const [isOperator,setIsOperator]=useState(false)
  const navigate=useNavigate()
  useEffect(()=>{
    if(!supabase){setSessionChecked(true);return}
    async function check(session:Session|null){
      setSessionChecked(false)
      setHasSession(Boolean(session))
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
      const aal2=!assurance.error && assurance.data.currentLevel==='aal2'
      setHasAal2(aal2)
      if(!aal2){
        clearWorkspaceOwnerCache()
        setIsOperator(false)
        setSessionChecked(true)
        return
      }
      setIsOperator(await isOperatorUser(supabase!,session.user.id))
      setSessionChecked(true)
    }
    supabase.auth.getSession().then(({data})=>check(data.session))
    const {data}=supabase.auth.onAuthStateChange((event,s)=>{
      if(event==='SIGNED_OUT'){
        clearRecoveryState()
        clearWorkspaceOwnerCache()
      }
      if(event==='PASSWORD_RECOVERY' || recoveryInProgress())return
      void check(s)
    })
    return()=>data.subscription.unsubscribe()
  },[navigate])
  if(!sessionChecked)return <p className="loading">Loading…</p>
  if(!hasSession)return <Navigate to="/login" replace />
  if(!hasAal2)return <Navigate to="/login" replace />
  if(!isOperator)return <main className="login"><h1>Access denied.</h1></main>
  return <Shell><Routes><Route path="/students" element={<Students/>}/><Route path="/students/:id" element={<StudentDetail/>}/><Route path="/lessons" element={<Lessons/>}/><Route path="/invoices" element={<Invoices/>}/><Route path="/invoices/new" element={<CreateInvoice/>}/><Route path="/invoices/:id" element={<InvoiceDetail/>}/><Route path="/settings" element={<Settings/>}/><Route path="*" element={<Navigate to="/students" replace/>}/></Routes></Shell>
}

function RecoveryRouter() {
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

export default function App() {
  useEffect(()=>{document.documentElement.lang='en-CA'},[])
  return <HashRouter><RecoveryRouter/></HashRouter>
}
