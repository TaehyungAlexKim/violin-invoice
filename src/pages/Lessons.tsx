import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../data/supabase'
import { loadWorkspaceOwnerId } from '../data/workspace'
import { formatCad, parseCadToCents } from '../domain/money'
import { todayInVancouver, parseDateOnly, formatDateOnly } from '../domain/date-only'
import { Loading, ErrorState, EmptyState } from '../components/Shared'
import { ConfirmationDialog } from '../components/ConfirmationDialog'
import { normalizeSupabaseError } from '../domain/data-state'
import { lessonSaveError } from '../domain/auth'
import { authError } from '../domain/auth-errors'
import { allocateStableOperationKey } from '../domain/auth'
import type { Student, Lesson } from '../domain/types'

export function Lessons() {
  const [students,setStudents]=useState<Student[]>([]); const [lessons,setLessons]=useState<Lesson[]>([])
  const [studentId,setStudentId]=useState(''); const [lessonDate,setLessonDate]=useState(todayInVancouver())
  const [minutes,setMinutes]=useState('60'); const [amount,setAmount]=useState('65.00'); const [message,setMessage]=useState('')
  const [note,setNote]=useState('')
  const [filterStudent,setFilterStudent]=useState(''); const [filterStart,setFilterStart]=useState(''); const [filterEnd,setFilterEnd]=useState(''); const [billed,setBilled]=useState<'all'|'billed'|'unbilled'>('all')
  const [claimed,setClaimed]=useState<Set<string>>(new Set()); const [editing,setEditing]=useState<Lesson|null>(null)
  const [loading,setLoading]=useState(true); const [loadError,setLoadError]=useState('')
  const [saving,setSaving]=useState(false)
  const savingRef=useRef(false)
  const [deleteLessonTarget,setDeleteLessonTarget]=useState<Lesson|null>(null)
  const [deleting,setDeleting]=useState(false)
  const operationKey=useRef('')
  const operationFormKey=useRef('')
  async function load(){if(!supabase)return;setLoading(true);setLoadError('')
    const [s,l,c]=await Promise.all([supabase.from('students').select('*').order('name'),supabase.from('lessons').select('*').order('lesson_date',{ascending:false}).order('id',{ascending:false}),supabase.from('invoice_lesson_claims').select('lesson_id')])
    setLoading(false)
    if(s.error||l.error||c.error){setLoadError(normalizeSupabaseError(s.error||l.error||c.error));return}
    setStudents((s.data||[]).filter((student: Student)=>!student.archived_at));setLessons(l.data||[]);setClaimed(new Set((c.data||[]).map(x=>x.lesson_id)))
  }
  useEffect(()=>{load()},[])
  async function save(e:FormEvent){e.preventDefault();if(savingRef.current)return;savingRef.current=true;setSaving(true);setMessage('')
    try{
      parseDateOnly(lessonDate); const cents=parseCadToCents(amount)
      if(!supabase||!studentId){setSaving(false);return}
      const user=(await supabase.auth.getUser()).data.user;if(!user)return
      const workspaceOwnerId=await loadWorkspaceOwnerId(supabase,user.id)
      if(!workspaceOwnerId){setMessage('Access denied.');return}
      const formIdentity=`${studentId}|${lessonDate}|${minutes}|${amount}|${note.trim()}`
      const allocated=allocateStableOperationKey(operationKey.current,operationFormKey.current,formIdentity,()=>crypto.randomUUID())
      operationKey.current=allocated.key
      operationFormKey.current=allocated.identity
      const payload={owner_id:workspaceOwnerId,student_id:studentId,lesson_date:lessonDate,minutes:Number(minutes),charge_cents:cents,note:note.trim()||null,entry_key:operationKey.current}
      const insert=await supabase.from('lessons').insert(payload).select().maybeSingle()
      if(insert.error){
        if(insert.error.code==='23505'){
          const existing=await supabase.from('lessons').select('*').eq('owner_id',workspaceOwnerId).eq('entry_key',operationKey.current).maybeSingle()
          if(existing.error || !existing.data){setMessage('Unable to reconcile the retry. Please try again.');return}
          setLessons(prev=>prev.some(l=>l.id===existing.data!.id)?prev:[existing.data as Lesson,...prev])
          setMessage('Lesson saved.')
        }else{setMessage(lessonSaveError(insert.error));return}
      }else{
        if(insert.data)setLessons(prev=>[insert.data as Lesson,...prev])
        setMessage('Lesson saved.')
      }
      operationKey.current=''
      operationFormKey.current=''
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to save lesson.')}
    finally{savingRef.current=false;setSaving(false)}
  }
  async function editLesson(lesson:Lesson){if(claimed.has(lesson.id)){setMessage('This lesson is included in a finalized invoice and cannot be edited.');return}setEditing(lesson);setLessonDate(lesson.lesson_date);setMinutes(String(lesson.minutes));setAmount((lesson.charge_cents/100).toFixed(2));setNote(lesson.note||'')}
  async function saveEdit(e:FormEvent){e.preventDefault();if(!supabase||!editing)return;  try{const cents=parseCadToCents(amount);const {error}=await supabase.from('lessons').update({lesson_date:lessonDate,minutes:Number(minutes),charge_cents:cents,note:note.trim()||null}).eq('id',editing.id);if(error){setMessage(lessonSaveError(error));return}setMessage('Lesson saved.');setEditing(null);setNote('');load()}catch(error){setMessage(error instanceof Error?error.message:'Unable to save lesson.')}}
  async function deleteLesson(){if(!deleteLessonTarget||deleting||!supabase)return
    if(claimed.has(deleteLessonTarget.id)){setMessage('This lesson is included in a finalized invoice and cannot be deleted.');setDeleteLessonTarget(null);return}
    setDeleting(true)
    const {error}=await supabase.from('lessons').delete().eq('id',deleteLessonTarget.id)
    setDeleting(false);setDeleteLessonTarget(null)
    setMessage(error?authError(error):'Lesson deleted.')
    if(!error)await load()
  }
  const filtered=lessons.filter(l=>(!filterStudent||l.student_id===filterStudent)&&(!filterStart||l.lesson_date>=filterStart)&&(!filterEnd||l.lesson_date<=filterEnd)&&(billed==='all'||(billed==='billed'?claimed.has(l.id):!claimed.has(l.id))))
  return <section><h1>Lessons</h1>
    {loading?<Loading message="Loading lessons…" />:loadError?<ErrorState message={loadError} onRetry={load}/>:null}
    <ConfirmationDialog open={Boolean(deleteLessonTarget)} title="Delete lesson?" confirmLabel="Delete lesson" pending={deleting} onCancel={()=>setDeleteLessonTarget(null)} onConfirm={deleteLesson}>
      {deleteLessonTarget&&<p>Delete the <strong>{formatDateOnly(deleteLessonTarget.lesson_date)}</strong> lesson for <strong>{formatCad(deleteLessonTarget.charge_cents)}</strong>? This cannot be undone.</p>}
    </ConfirmationDialog>
    <form onSubmit={editing?saveEdit:save} className="lesson-form card">
    <label>Student<select value={editing?.student_id||studentId} onChange={e=>editing?setEditing({...editing,student_id:e.target.value}):setStudentId(e.target.value)} required disabled={Boolean(editing)}><option value="">Select a student</option>{students.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
    <label>Lesson date<input type="date" value={lessonDate} onChange={e=>setLessonDate(e.target.value)} required/></label>
    <label>Minutes<input type="number" min="1" max="1440" value={minutes} onChange={e=>setMinutes(e.target.value)} required/></label>
    <label>Actual charge (CAD)<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} required/></label>
    <label className="lesson-note-field"><span>Lesson note <small>(optional, 300 characters)</small></span><textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={300}/></label>
    <div className="lesson-form-actions">
      <button className="primary" type="submit" disabled={saving}>{saving?(editing?'Saving…':'Adding…'):editing?'Save lesson':'Add lesson'}</button>
      {editing&&<button type="button" onClick={()=>{setEditing(null);setNote('')}}>Cancel edit</button>}
    </div>
  </form>{message&&<p role="status">{message}</p>}
  <div className="form-grid filter-grid card">
    <label>Student<select value={filterStudent} onChange={e=>setFilterStudent(e.target.value)}><option value="">All students</option>{students.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
    <label>Start date<input type="date" value={filterStart} onChange={e=>setFilterStart(e.target.value)}/></label>
    <label>End date<input type="date" value={filterEnd} onChange={e=>setFilterEnd(e.target.value)}/></label>
    <label>Status<select value={billed} onChange={e=>setBilled(e.target.value as 'all'|'billed'|'unbilled')}><option value="all">All</option><option value="unbilled">Unbilled</option><option value="billed">Billed</option></select></label>
  </div>
  <div className="table-wrap" role="region" aria-label="Lesson list" tabIndex={0}><table><thead><tr><th>Date</th><th>Student</th><th>Minutes</th><th>Actual charge</th><th>Note</th><th>Status</th><th>Actions</th></tr></thead><tbody>{filtered.map(l=><tr key={l.id}><td data-label="Date">{formatDateOnly(l.lesson_date)}</td><td data-label="Student">{students.find(s=>s.id===l.student_id)?.name||'Unknown student'}</td><td data-label="Minutes">{l.minutes}</td><td data-label="Charge">{formatCad(l.charge_cents)}</td><td data-label="Note">{l.note?(l.note.length>80?`${l.note.slice(0,77)}…`:l.note):'—'}</td><td data-label="Status">{claimed.has(l.id)?'Billed':'Unbilled'}</td><td data-label="Actions"><button type="button" onClick={()=>editLesson(l)} disabled={claimed.has(l.id)}>Edit</button> <button type="button" className="danger" onClick={()=>setDeleteLessonTarget(l)} disabled={claimed.has(l.id)}>Delete</button></td></tr>)}</tbody></table></div>
  <div className="lesson-cards" aria-label="Lesson cards">{filtered.map(l=><article className="card lesson-card" key={l.id}>
    <div><strong>{formatDateOnly(l.lesson_date)}</strong><span>{students.find(s=>s.id===l.student_id)?.name||'Unknown student'}</span>{l.note&&<p className="lesson-note-preview">Note: {l.note.length>80?`${l.note.slice(0,77)}…`:l.note}</p>}</div>
    <dl><div><dt>Minutes</dt><dd>{l.minutes}</dd></div><div><dt>Charge</dt><dd>{formatCad(l.charge_cents)}</dd></div><div><dt>Status</dt><dd>{claimed.has(l.id)?'Billed':'Unbilled'}</dd></div></dl>
    <div className="actions"><button type="button" onClick={()=>editLesson(l)} disabled={claimed.has(l.id)}>Edit</button><button type="button" className="danger" onClick={()=>setDeleteLessonTarget(l)} disabled={claimed.has(l.id)}>Delete</button></div>
  </article>)}</div>
  {filtered.length===0&&!loading&&<EmptyState message="No lessons match the selected filters." />}
  </section>
}
