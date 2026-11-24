import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../data/supabase'
import { loadWorkspaceOwnerId } from '../data/workspace'
import { Loading, ErrorState, StatusMessage } from '../components/Shared'
import { normalizeSupabaseError } from '../domain/data-state'

export function settingsSaveAllowed(loading: boolean, loaded: boolean, error: string, saving: boolean): boolean {
  return !loading && loaded && error === '' && !saving
}

export function Settings() {
  const [teacherName,setTeacherName]=useState(''); const [businessName,setBusinessName]=useState('')
  const [address,setAddress]=useState(''); const [email,setEmail]=useState(''); const [phone,setPhone]=useState('')
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [saving,setSaving]=useState(false)
  const [loaded,setLoaded]=useState(false)
  async function loadSettings(){
    if(!supabase)return
    setLoading(true);setError('');setLoaded(false)
    const {data,error:queryError}=await supabase.from('teacher_settings').select('*').maybeSingle()
    setLoading(false)
    if(queryError){setError(normalizeSupabaseError(queryError));return}
    if(data){setTeacherName(data.teacher_name||'');setBusinessName(data.business_name||'');setAddress(data.address||'');setEmail(data.email||'');setPhone(data.phone||'')}
    setLoaded(true)
  }
  useEffect(()=>{void loadSettings()},[])
  async function save(e:FormEvent){e.preventDefault();if(!supabase||!settingsSaveAllowed(loading,loaded,error,saving))return
    setSaving(true);setMessage('');setError('')
    const user=await supabase.auth.getUser()
    if(user.error || !user.data.user){setError('Your session has expired. Sign in again.');setSaving(false);return}
    const workspaceOwnerId=await loadWorkspaceOwnerId(supabase,user.data.user.id)
    if(!workspaceOwnerId){setError('Unable to verify operator access. Retry, or sign in again.');setSaving(false);return}
    if(!workspaceOwnerId){setMessage('Access denied.');return}
    const {error:upsertError}=await supabase.from('teacher_settings').upsert({
    owner_id:workspaceOwnerId,
    teacher_name:teacherName.trim(),business_name:businessName.trim()||null,address:address.trim()||null,email:email.trim()||null,phone:phone.trim()||null,currency:'CAD'
  })
    setSaving(false)
    setMessage(upsertError?'':'Settings saved.')
    if(upsertError)setError(normalizeSupabaseError(upsertError))
  }
  return <section><h1>Settings</h1>
    {loading ? <Loading message="Loading settings…" /> : error ? <ErrorState message={error} onRetry={loadSettings}/> : null}
    {!loading && loaded && !error && <form onSubmit={save} className="form-grid">
    <label>Teacher name *<input autoComplete="name" value={teacherName} onChange={e=>setTeacherName(e.target.value)} required maxLength={200}/></label>
    <label>Business or trading name<input autoComplete="organization" value={businessName} onChange={e=>setBusinessName(e.target.value)} maxLength={200}/></label>
    <label>Address<textarea autoComplete="street-address" value={address} onChange={e=>setAddress(e.target.value)} maxLength={1000}/></label>
    <label>Email<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <label>Phone<input type="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} maxLength={80}/></label>
    <label>Currency<input value="CAD" disabled /></label>
    <button className="primary" type="submit" disabled={saving}>{saving?'Saving…':'Save settings'}</button>
  </form>}{message&&<StatusMessage>{message}</StatusMessage>}</section>
}
