import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../data/supabase'
import { loadWorkspaceOwnerId } from '../data/workspace'
import { formatCad } from '../domain/money'
import { authError } from '../domain/auth-errors'
import type { Student, Lesson, Invoice } from '../domain/types'
import { Loading, ErrorState, EmptyState } from '../components/Shared'
import { normalizeSupabaseError } from '../domain/data-state'

export function Students() {
  const [students,setStudents]=useState<Student[]>([]); const [search,setSearch]=useState('')
  const [form,setForm]=useState<Partial<Student>>({name:''}); const [message,setMessage]=useState('')
  const [lessons,setLessons]=useState<Lesson[]>([]); const [invoices,setInvoices]=useState<Invoice[]>([]); const [claimed,setClaimed]=useState<Set<string>>(new Set())
  const navigate=useNavigate()
  const location=useLocation()
  const navigationMessage=(location.state as {message?:string}|null)?.message
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [saving,setSaving]=useState(false)
  const savingRef=useRef(false)
  async function load(){
    if(!supabase)return
    setLoading(true);setError('')
    const [s,l,i,c]=await Promise.all([
      supabase.from('students').select('*').order('name'),
      supabase.from('lessons').select('*'),
      supabase.from('invoices').select('*'),
      supabase.from('invoice_lesson_claims').select('lesson_id'),
    ])
    setLoading(false)
    const queryError=s.error||l.error||i.error||c.error
    if(queryError){setError(normalizeSupabaseError(queryError));return}
    setStudents((s.data||[]).filter((student:Student)=>!student.archived_at));setLessons(l.data||[]);setInvoices(i.data||[]);setClaimed(new Set((c.data||[]).map(x=>x.lesson_id)))
  }
  useEffect(()=>{load()},[])
  async function save(e:FormEvent){e.preventDefault();if(!supabase||savingRef.current)return;savingRef.current=true;setSaving(true)
    try{
    const user=(await supabase.auth.getUser()).data.user
    if(!user)return
    const workspaceOwnerId=await loadWorkspaceOwnerId(supabase,user.id)
    if(!workspaceOwnerId){setMessage('Access denied.');return}
    const payload={owner_id:workspaceOwnerId,name:(form.name||'').trim(),recipient_name:form.recipient_name?.trim()||null,email:form.email?.trim()||null,phone:form.phone?.trim()||null,billing_address:form.billing_address?.trim()||null,memo:form.memo?.trim()||null}
    const {error}=form.id?await supabase.from('students').update(payload).eq('id',form.id):await supabase.from('students').insert(payload)
    setMessage(error?authError(error):'Student saved.')
    if(!error){setForm({name:''});await load()}
    }finally{savingRef.current=false;setSaving(false)}
  }
  const shown=students.filter(s=>s.name.toLowerCase().includes(search.toLowerCase()))
  return <section><h1>Students</h1>
    {(navigationMessage||message)&&<p role="status">{navigationMessage||message}</p>}
    {loading?<Loading message="Loading students…" />:error?<ErrorState message={error} onRetry={load}/>:null}
    {!loading&&!error&&<input aria-label="Search students" placeholder="Search students" value={search} onChange={e=>setSearch(e.target.value)} />}
    {!loading&&!error&&<div className="student-layout"><div className="cards">{shown.map(s=>{
      const studentLessons=lessons.filter(l=>l.student_id===s.id&&!claimed.has(l.id));const unbilled=studentLessons.reduce((n,l)=>n+l.charge_cents,0)
      const recent=invoices.filter(i=>i.student_id===s.id&&i.status==='finalized').sort((a,b)=>b.period_end.localeCompare(a.period_end)||String(b.finalized_at||'').localeCompare(String(a.finalized_at||''))||b.id.localeCompare(a.id))[0]
      return <button className="card student-card" key={s.id} onClick={()=>navigate(`/students/${s.id}`)}><strong>{s.name}</strong><span>{recent?`Recent finalized period: ${recent.period_end}`:'No finalized period'}</span><span>{studentLessons.length} unbilled lesson(s) · {formatCad(unbilled)}</span></button>
    })}{shown.length===0&&<EmptyState message="No students found." />}</div>
    <form onSubmit={save} className="form-grid card"><h2>{form.id?'Edit student':'Add student'}</h2>
      <label>Name *<input value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})} required maxLength={200}/></label>
      <label>Recipient or parent<input value={form.recipient_name||''} onChange={e=>setForm({...form,recipient_name:e.target.value})}/></label>
      <label>Email<input type="email" value={form.email||''} onChange={e=>setForm({...form,email:e.target.value})}/></label>
      <label>Phone<input value={form.phone||''} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
      <label>Billing address<textarea value={form.billing_address||''} onChange={e=>setForm({...form,billing_address:e.target.value})} maxLength={1000}/></label>
      <label>Internal memo<textarea value={form.memo||''} onChange={e=>setForm({...form,memo:e.target.value})} maxLength={4000}/></label>
      <div className="actions"><button className="primary" type="submit" disabled={saving}>{saving?'Saving…':'Save student'}</button>{form.id&&<button type="button" onClick={()=>setForm({name:''})} disabled={saving}>Cancel</button>}</div>
    </form></div>}{message&&<p role="status">{message}</p>}</section>
}
