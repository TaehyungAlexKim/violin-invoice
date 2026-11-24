import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../data/supabase'
import { loadWorkspaceOwnerId } from '../data/workspace'
import { addCalendarDay, todayInVancouver } from '../domain/date-only'
import { Loading, ErrorState } from '../components/Shared'
import { normalizeSupabaseError } from '../domain/data-state'
import type { Student } from '../domain/types'

export function CreateInvoice() {
  const [students,setStudents]=useState<Student[]>([]); const [studentId,setStudentId]=useState(''); const navigate=useNavigate()
  const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [creating,setCreating]=useState(false)
  const creatingRef=useRef(false)
  const draftOperation=useRef<{key:string;studentId:string}>({key:'',studentId:''})
  function selectStudent(nextStudentId:string){
    setStudentId(nextStudentId)
    if(draftOperation.current.studentId!==nextStudentId){
      draftOperation.current={key:'',studentId:nextStudentId}
      setError('')
    }
  }
  function resetDraftOperation(){draftOperation.current={key:'',studentId:studentId}}
  async function loadStudents(){
    if(!supabase)return
    setLoading(true);setError('')
    const result=await supabase.from('students').select('*').order('name')
    setLoading(false)
    if(result.error){setError(normalizeSupabaseError(result.error));return}
    setStudents((result.data||[]).filter((student:Student)=>!student.archived_at))
  }
  useEffect(()=>{void loadStudents()},[])
  async function create(){if(!supabase||!studentId||creatingRef.current)return
    creatingRef.current=true;setCreating(true);setError('')
    try{
      const user=(await supabase.auth.getUser()).data.user;if(!user){setError('Your session has expired. Sign in again.');return}
      const workspaceOwnerId=await loadWorkspaceOwnerId(supabase,user.id)
      if(!workspaceOwnerId){setError('Unable to verify operator access. Please retry.');return}
      if(!draftOperation.current.key||draftOperation.current.studentId!==studentId){
        draftOperation.current={key:crypto.randomUUID(),studentId}
      }
      const operation=draftOperation.current
      const end=todayInVancouver();let start=end.slice(0,7)+'-01'
      const latest=await supabase.from('invoices').select('period_end,finalized_at,id').eq('student_id',studentId).eq('status','finalized').order('period_end',{ascending:false}).order('finalized_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle()
      if(latest.error){setError('Unable to verify the latest finalized invoice. Please retry.');return}
      if(latest.data)start=addCalendarDay(latest.data.period_end)
      const insert=await supabase.from('invoices').insert({owner_id:workspaceOwnerId,student_id:studentId,status:'draft',period_start:start,period_end:end,entry_key:operation.key}).select().maybeSingle()
      if(insert.error){
        if(insert.error.code==='23505'){
          const existing=await supabase.from('invoices').select('*').eq('owner_id',workspaceOwnerId).eq('entry_key',operation.key).maybeSingle()
          if(existing.error || !existing.data){setError('Unable to reconcile the draft retry. Please retry.');return}
          if(existing.data.entry_key!==operation.key||existing.data.student_id!==operation.studentId||existing.data.status!=='draft'){
            resetDraftOperation()
            setError('The draft key belongs to a different operation. Rotate the form and try again.')
            return
          }
          resetDraftOperation();navigate(`/invoices/${existing.data.id}`)
        }else setError(normalizeSupabaseError(insert.error))
      }else if(insert.data){
        if(insert.data.entry_key!==operation.key||insert.data.student_id!==operation.studentId||insert.data.status!=='draft'){
          resetDraftOperation()
          setError('The returned draft belongs to a different student operation. No navigation was performed.')
          return
        }
        resetDraftOperation();navigate(`/invoices/${insert.data.id}`)
      }
    }finally{creatingRef.current=false;setCreating(false)}
  }
  return <section><h1>Create invoice</h1>
    {loading?<Loading message="Loading students…"/>:error?<ErrorState message={error} onRetry={loadStudents}/>:<div className="card form-grid"><label>Student<select value={studentId} onChange={e=>selectStudent(e.target.value)}><option value="">Select a student</option>{students.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label><button className="primary" disabled={!studentId||creating} onClick={create}>{creating?'Creating…':'Create draft'}</button><button type="button" disabled={creating} onClick={resetDraftOperation}>Reset draft operation</button></div>}
  </section>
}
