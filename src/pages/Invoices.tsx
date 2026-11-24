import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { supabase } from '../data/supabase'
import { formatDateOnly } from '../domain/date-only'
import { Loading, ErrorState, EmptyState } from '../components/Shared'
import { normalizeSupabaseError } from '../domain/data-state'
import type { Student, Invoice } from '../domain/types'

export function Invoices() {
  const [students,setStudents]=useState<Student[]>([]); const [invoices,setInvoices]=useState<Invoice[]>([])
  const [tab,setTab]=useState<'draft'|'finalized'>('draft'); const [studentFilter,setStudentFilter]=useState('')
  const [loading,setLoading]=useState(true); const [error,setError]=useState('')
  async function loadInvoices(){
    if(!supabase)return
    setLoading(true);setError('')
    const [s,i]=await Promise.all([supabase.from('students').select('*').order('name'),supabase.from('invoices').select('*').order('period_end',{ascending:false})])
    setLoading(false)
    if(s.error||i.error){setError(normalizeSupabaseError(s.error||i.error));return}
    setStudents(s.data||[]);setInvoices(i.data||[])
  }
  useEffect(()=>{void loadInvoices()},[])
  const shown=invoices.filter(i=>i.status===tab&&(!studentFilter||i.student_id===studentFilter)).sort((a,b)=>b.period_end.localeCompare(a.period_end)||String(b.finalized_at||'').localeCompare(String(a.finalized_at||''))||b.id.localeCompare(a.id))
  return <section><h1>Invoices</h1>
    {loading?<Loading message="Loading invoices…" />:error?<ErrorState message={error} onRetry={loadInvoices}/>:null}
    {!loading&&!error&&<><div className="invoice-actions"><div className="tabs"><button className={tab==='draft'?'active':''} onClick={()=>setTab('draft')}>Draft</button><button className={tab==='finalized'?'active':''} onClick={()=>setTab('finalized')}>Finalized</button></div><NavLink className="primary button-link" to="/invoices/new">New invoice</NavLink></div>
    <label>Filter by student<select value={studentFilter} onChange={e=>setStudentFilter(e.target.value)}><option value="">All students</option>{students.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
    {shown.length===0&&<EmptyState message={`No ${tab} invoices.`}/>}
    <div className="cards">{shown.map(i=><a className="card student-card" href={`#/invoices/${i.id}`} key={i.id}><strong>{i.invoice_number||'Draft'}</strong><span>{students.find(s=>s.id===i.student_id)?.name}</span><span>{formatDateOnly(i.period_start)} – {formatDateOnly(i.period_end)}</span></a>)}</div></>}
  </section>
}
