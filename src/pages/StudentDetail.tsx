import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../data/supabase'
import { formatCad } from '../domain/money'
import { ConfirmationDialog } from '../components/ConfirmationDialog'
import { authError } from '../domain/auth-errors'
import { normalizeSupabaseError } from '../domain/data-state'
import type { Student, Lesson, Invoice } from '../domain/types'
import { loadStudentDetail } from '../data/repositories'
import { Loading, ErrorState, EmptyState } from '../components/Shared'

export function StudentDetail() {
  const {id}=useParams(); const [student,setStudent]=useState<Student|null>(null); const [lessons,setLessons]=useState<Lesson[]>([]); const [invoices,setInvoices]=useState<Invoice[]>([]); const [claimed,setClaimed]=useState<Set<string>>(new Set())
  const [editing,setEditing]=useState(false); const [form,setForm]=useState<Partial<Student>>({name:''}); const [message,setMessage]=useState('')
  const [saving,setSaving]=useState(false); const savingRef=useRef(false)
  const navigate=useNavigate()
  const loadGeneration=useRef(0)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [notFound,setNotFound]=useState(false)
  async function load(){
    if(!supabase||!id)return
    const generation=++loadGeneration.current
    setLoading(true);setError('');setNotFound(false)
    const result=await loadStudentDetail(supabase,id)
    if(generation!==loadGeneration.current) return
    setLoading(false)
    if(result.error){setError(normalizeSupabaseError(result.error));setEditing(false);return}
    if(!result.student){setNotFound(true);return}
    setStudent(result.student);setLessons(result.lessons);setInvoices(result.invoices);setClaimed(result.claimed)
    if(result.student)setForm(result.student)
  }
  useEffect(()=>{
    setStudent(null);setLessons([]);setInvoices([]);setClaimed(new Set())
    loadGeneration.current++
    void load()
  },[id])
  function beginEdit(){if(!student)return;setForm(student);setEditing(true);setMessage('')}
  async function saveEdit(e:FormEvent){e.preventDefault();if(!supabase||!student||savingRef.current)return;savingRef.current=true;setSaving(true)
    try{const payload={name:(form.name||'').trim(),recipient_name:form.recipient_name?.trim()||null,email:form.email?.trim()||null,phone:form.phone?.trim()||null,billing_address:form.billing_address?.trim()||null,memo:form.memo?.trim()||null};const {error}=await supabase.from('students').update(payload).eq('id',student.id);if(error){setMessage(authError(error));return}setEditing(false);setMessage('Student saved.');await load()}
    finally{savingRef.current=false;setSaving(false)}
  }
  const [archiveOpen,setArchiveOpen]=useState(false)
  const [archiving,setArchiving]=useState(false)
  async function archiveStudent(){if(!supabase||!student||archiving)return
    setArchiving(true)
    const {error}=await supabase.from('students').update({archived_at:new Date().toISOString()}).eq('id',student.id)
    setArchiving(false);setArchiveOpen(false)
    if(error){setMessage(authError(error));return}
    navigate('/students',{state:{message:`${student.name} archived.`}})
  }
  if(loading)return <Loading message="Loading student…" />
  if(error)return <><h1>Student unavailable</h1><ErrorState message={error} onRetry={load}/></>
  if(notFound||!student)return <><h1>Student not found</h1><EmptyState message="This student does not exist or is not available to this workspace."/><button type="button" onClick={()=>navigate('/students')}>Return to students</button></>
  const unbilled=lessons.filter(l=>!claimed.has(l.id));const total=unbilled.reduce((n,l)=>n+l.charge_cents,0)
  if(student.archived_at)return <><h1>Student archived</h1><EmptyState message="This student is archived and cannot be used for new lessons or invoices."/><button type="button" onClick={()=>navigate('/students')}>Return to students</button></>
  return <section><h1>{student.name}</h1><div className="actions"><button type="button" onClick={beginEdit}>Edit student</button><button type="button" className="danger" onClick={()=>setArchiveOpen(true)}>Archive student</button></div>
    <ConfirmationDialog open={archiveOpen} title="Archive student?" confirmLabel="Archive student" pending={archiving} onCancel={()=>setArchiveOpen(false)} onConfirm={archiveStudent}>
      <p><strong>{student.name}</strong> will be archived. Existing lessons and finalized invoices remain readable and reproducible.</p>
    </ConfirmationDialog>
    {editing&&<form onSubmit={saveEdit} className="form-grid card"><h2>Edit student</h2>
      <label>Name *<input value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})} required maxLength={200}/></label>
      <label>Recipient or parent<input value={form.recipient_name||''} onChange={e=>setForm({...form,recipient_name:e.target.value})}/></label>
      <label>Email<input type="email" value={form.email||''} onChange={e=>setForm({...form,email:e.target.value})}/></label>
      <label>Phone<input value={form.phone||''} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
      <label>Billing address<textarea value={form.billing_address||''} onChange={e=>setForm({...form,billing_address:e.target.value})} maxLength={1000}/></label>
      <label>Internal memo<textarea value={form.memo||''} onChange={e=>setForm({...form,memo:e.target.value})} maxLength={4000}/></label>
      <div className="actions"><button className="primary" type="submit" disabled={saving}>{saving?'Saving…':'Save student'}</button><button type="button" onClick={()=>{setEditing(false);setMessage('')}} disabled={saving}>Cancel</button></div>
    </form>}
    {message&&<p role="status">{message}</p>}
    <div className="card invoice-detail"><p><strong>Unbilled:</strong> {unbilled.length} lesson(s) · {formatCad(total)}</p>{student.recipient_name&&<p><strong>Recipient:</strong> {student.recipient_name}</p>}{student.email&&<p><strong>Email:</strong> {student.email}</p>}{student.phone&&<p><strong>Phone:</strong> {student.phone}</p>}{student.billing_address&&<p><strong>Billing address:</strong> {student.billing_address}</p>}</div>
    <h2>Recent unbilled lessons</h2><ul>{unbilled.slice(0,10).map(l=><li key={l.id}>{l.lesson_date} — {l.minutes} minutes — {formatCad(l.charge_cents)}</li>)}</ul>
    <h2>Invoices</h2><div className="cards">{invoices.map(i=><NavLink className="card student-card" key={i.id} to={`/invoices/${i.id}`}><strong>{i.invoice_number||'Draft'}</strong><span>{i.status}</span><span>{i.period_start} – {i.period_end}</span></NavLink>)}</div>
  </section>
}
