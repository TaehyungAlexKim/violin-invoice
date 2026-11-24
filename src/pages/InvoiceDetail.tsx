import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../data/supabase'
import { formatCad } from '../domain/money'
import { todayInVancouver, parseDateOnly, formatDateOnly, formatAuditTimestamp } from '../domain/date-only'
import { downloadInvoice, pdfDownloadErrorMessage } from '../pdf/download-invoice'
import { validateInvoiceSnapshot } from '../domain/invoice-snapshot'
import type { InvoiceSnapshot } from '../domain/invoice-snapshot'
import { Loading, ErrorState, EmptyState } from '../components/Shared'
import { ConfirmationDialog } from '../components/ConfirmationDialog'
import { normalizeSupabaseError } from '../domain/data-state'
import { authError } from '../domain/auth-errors'
import type { Student, Lesson, Invoice } from '../domain/types'
import { loadInvoiceDetail } from '../data/repositories'
import { reconcileFinalizationFailure } from '../data/repositories'

export function InvoiceDetail() {
  const {id}=useParams(); const navigate=useNavigate()
  const [invoice,setInvoice]=useState<Invoice|null>(null); const [students,setStudents]=useState<Student[]>([])
  const [draftStart,setDraftStart]=useState(todayInVancouver()); const [draftEnd,setDraftEnd]=useState(todayInVancouver())
  const [eligible,setEligible]=useState<Lesson[]>([]); const [message,setMessage]=useState(''); const [teacherName,setTeacherName]=useState('')
  const [previewing,setPreviewing]=useState(false); const [finalizing,setFinalizing]=useState(false); const [downloading,setDownloading]=useState(false)
  const [detailLoading,setDetailLoading]=useState(true); const [detailError,setDetailError]=useState('')
  const [detailNotFound,setDetailNotFound]=useState(false)
  const [finalizeOpen,setFinalizeOpen]=useState(false); const [draftDeleteOpen,setDraftDeleteOpen]=useState(false)
  const [savingDraft,setSavingDraft]=useState(false); const [deletingDraft,setDeletingDraft]=useState(false)
  const [pdfProgress,setPdfProgress]=useState('')
  const loadGeneration=useRef(0)
  const previewGeneration=useRef(0)
  const previewIdentity=useRef('')
  const [previewFresh,setPreviewFresh]=useState(false)
  const [previewOverlap,setPreviewOverlap]=useState(false)
  const [snapshotInvalid,setSnapshotInvalid]=useState(false)
  async function loadDetail(){
    if(!supabase||!id)return
    const generation=++loadGeneration.current
    setDetailLoading(true);setDetailError('');setDetailNotFound(false);setInvoice(null);setEligible([])
    setSnapshotInvalid(false)
    const result=await loadInvoiceDetail(supabase,id)
    if(generation!==loadGeneration.current)return
    setDetailLoading(false)
    if(result.error){setDetailError(normalizeSupabaseError(result.error));return}
    if(!result.invoice){setDetailNotFound(true);return}
    setInvoice(result.invoice);setStudents(result.students);setTeacherName(result.teacherName);setSnapshotInvalid(result.snapshotInvalid)
    const start=result.invoice.period_start,end=result.invoice.period_end;setDraftStart(start);setDraftEnd(end)
  }
  useEffect(()=>{void loadDetail()},[id])
  async function preview(){if(!supabase||!invoice)return;
    const generation=++previewGeneration.current
    const identity=`${invoice.id}|${invoice.student_id}|${draftStart}|${draftEnd}`
    previewIdentity.current=identity
    setPreviewFresh(false)
    setPreviewOverlap(false)
    setPreviewing(true)
    setMessage('')
    try{parseDateOnly(draftStart);parseDateOnly(draftEnd);if(draftStart>draftEnd){setMessage('The start date must be on or before the end date.');return}
      const lessonsIdentity=identity
      const {data,error}=await supabase.from('lessons').select('*').eq('student_id',invoice.student_id).gte('lesson_date',draftStart).lte('lesson_date',draftEnd).order('lesson_date').order('id')
      if(generation!==previewGeneration.current||previewIdentity.current!==lessonsIdentity)return
      if(error){setMessage(authError(error));return}
      const {data:claimData,error:claimError}=await supabase.from('invoice_lesson_claims').select('lesson_id')
      if(generation!==previewGeneration.current||previewIdentity.current!==lessonsIdentity)return
      if(claimError){setMessage(authError(claimError));return}
      const claimed=new Set((claimData||[]).map(c=>c.lesson_id))
      const eligibleLessons=(data||[]).filter(l=>!claimed.has(l.id))
      const {data:finalized,error:finalizedError}=await supabase.from('invoices').select('period_start,period_end').eq('student_id',invoice.student_id).eq('status','finalized')
      if(generation!==previewGeneration.current||previewIdentity.current!==lessonsIdentity)return
      if(finalizedError){setMessage(authError(finalizedError));return}
      setEligible(eligibleLessons)
      const overlaps=(finalized||[]).some(i=>i.period_start<=draftEnd && i.period_end>=draftStart)
      if(overlaps){
        setMessage('This period overlaps an existing finalized invoice. Finalization is rejected.')
        setPreviewFresh(false);setPreviewOverlap(true)
      } else if(!eligibleLessons.length){
        setMessage('No unbilled lessons are available in this date range.')
        setPreviewFresh(false);setPreviewOverlap(false)
      } else {
        setMessage(`Preview: ${eligibleLessons.length} eligible lesson(s), ${formatCad(eligibleLessons.reduce((n,l)=>n+l.charge_cents,0))}.`)
        setPreviewFresh(true);setPreviewOverlap(false)
      }
    }catch(error){if(generation===previewGeneration.current&&previewIdentity.current===identity)setMessage(error instanceof Error?error.message:'Unable to preview.')}
    finally{if(generation===previewGeneration.current&&previewIdentity.current===identity)setPreviewing(false)}}
  useEffect(()=>{if(invoice?.status==='draft')preview()},[invoice])
  async function saveDraft(){if(!supabase||!invoice||savingDraft)return
    setSavingDraft(true);setMessage('')
    const {error}=await supabase.from('invoices').update({period_start:draftStart,period_end:draftEnd}).eq('id',invoice.id)
    setSavingDraft(false)
    setMessage(error?normalizeSupabaseError(error):'Draft range saved.')
  }
  async function finalize(){if(!supabase||!invoice)return;if(!teacherName){setMessage('Enter the teacher name in Settings before finalizing.');return}
    const identity=`${invoice.id}|${invoice.student_id}|${draftStart}|${draftEnd}`
    if(previewing||previewIdentity.current!==identity||!previewFresh||previewOverlap||!eligible.length) {
      setMessage('The preview is stale or incomplete. Preview the current range before finalizing.')
      return
    }
    if(finalizing)return
    setFinalizeOpen(false);setFinalizing(true)
    setMessage('Finalizing…')
    const finalizationIdentity=identity
    try{
      parseDateOnly(draftStart);parseDateOnly(draftEnd)
      if(draftStart>draftEnd){setMessage('The start date must be on or before the end date.');return}
      const {data,error}=await supabase.rpc('finalize_invoice',{p_invoice_id:invoice.id,p_period_start:draftStart,p_period_end:draftEnd})
      if(error){
        await reconcileError(error)
        return
      }
      let snapshot: InvoiceSnapshot
      try{snapshot=validateInvoiceSnapshot(data)}
      catch{
        setMessage('Finalization was submitted, but the returned invoice snapshot could not be verified. Refetching persisted invoice…')
        await loadDetail()
        return
      }
      if(finalizationIdentity!==`${invoice.id}|${invoice.student_id}|${draftStart}|${draftEnd}`)return
      setInvoice({...invoice,status:'finalized',period_start:draftStart,period_end:draftEnd,snapshot_json:snapshot,invoice_number:snapshot.invoice.number,issue_date:snapshot.invoice.issueDate})
      await downloadInvoice(snapshot,(progress)=>{
        if(finalizationIdentity!==`${invoice.id}|${invoice.student_id}|${draftStart}|${draftEnd}`)return
        setPdfProgress(progress.stage==='font'
          ? progress.loaded && progress.total
            ? `Preparing PDF font… ${Math.round(progress.loaded/progress.total*100)}%`
            : 'Preparing PDF font…'
          : progress.stage==='renderer' ? 'Loading PDF renderer…'
          : progress.stage==='generating' ? 'Generating PDF…'
          : 'Starting PDF download…')
      })
      if(finalizationIdentity===`${invoice.id}|${invoice.student_id}|${draftStart}|${draftEnd}`)setMessage('Invoice finalized. PDF download started.')
    } catch (error) {
      await reconcileError(error)
    } finally {
      if(finalizationIdentity===`${invoice.id}|${invoice.student_id}|${draftStart}|${draftEnd}`)setFinalizing(false)
    }
  }
  async function reconcileError(originalError:unknown){
    if(!supabase||!invoice)return
    const finalizationIdentity=`${invoice.id}|${invoice.student_id}|${draftStart}|${draftEnd}`
    const outcome=await reconcileFinalizationFailure(supabase,invoice.id,invoice.student_id,originalError)
    if(finalizationIdentity!==`${invoice.id}|${invoice.student_id}|${draftStart}|${draftEnd}`)return
    if(outcome.kind==='finalized'){
      setInvoice(outcome.invoice)
      setDetailNotFound(false)
      setSnapshotInvalid(outcome.invalidSnapshot)
      const downloadError=String(originalError instanceof Error?originalError.message:'')
      if(outcome.invalidSnapshot){
        setMessage('Invoice finalized, but the stored invoice snapshot is invalid. Download is unavailable until the snapshot is corrected.')
      }else if(downloadError.startsWith('PDF_')||downloadError.startsWith('Unsupported')){
        setMessage(`Invoice finalized. ${pdfDownloadErrorMessage(originalError)} It remains available for retry.`)
      }else{
        setMessage('Invoice finalized. The finalized invoice and PDF download are available.')
      }
      return
    }
    const value=originalError as {code?:string;message?:string}
    setMessage(/overlap|included|already/i.test(value.message||'')
      ? 'This period or lesson is already included in a finalized invoice.'
      : normalizeSupabaseError(originalError))
  }
  async function deleteDraft(){if(!supabase||!invoice||deletingDraft)return
    setDeletingDraft(true)
    const {error}=await supabase.from('invoices').delete().eq('id',invoice.id)
    setDeletingDraft(false);setDraftDeleteOpen(false)
    if(error)setMessage(normalizeSupabaseError(error));else navigate('/invoices')
  }
  async function downloadFinalized(){
    if(!invoice?.snapshot_json)return
    setDownloading(true)
    setMessage('')
    try{
      await downloadInvoice(invoice.snapshot_json,(progress)=>{
        setMessage(progress.stage==='font'
          ? progress.loaded && progress.total
            ? `Preparing PDF font… ${Math.round(progress.loaded/progress.total*100)}%`
            : 'Preparing PDF font…'
          : progress.stage==='renderer' ? 'Loading PDF renderer…'
          : progress.stage==='generating' ? 'Generating PDF…'
          : 'Starting PDF download…')
      })
      setMessage('PDF download started.')
    }catch(error){
      setMessage(pdfDownloadErrorMessage(error))
    }finally{
      setDownloading(false)
    }
  }
  if(detailLoading)return <Loading message="Loading invoice…" />
  if(detailError)return <ErrorState message={detailError} onRetry={loadDetail}/>
  if(detailNotFound||!invoice)return <><h1>Invoice not found</h1><EmptyState message="This invoice does not exist or is not available to this workspace."/><button type="button" onClick={()=>navigate('/invoices')}>Return to invoices</button></>
  const student=students.find(s=>s.id===invoice.student_id)
  if(invoice.status==='finalized'){
    const snapshot=invoice.snapshot_json
    return <section><h1>Invoice {invoice.invoice_number}</h1><div className="card invoice-detail"><p><strong>Status:</strong> Finalized</p><p><strong>Issue date:</strong> {invoice.issue_date?formatDateOnly(invoice.issue_date):''}</p><p><strong>Student:</strong> {student?.name}</p><p><strong>Service period:</strong> {formatDateOnly(invoice.period_start)} – {formatDateOnly(invoice.period_end)}</p>{invoice.finalized_at&&<p><strong>Finalized at:</strong> {formatAuditTimestamp(invoice.finalized_at)}</p>}{snapshot&&<p><strong>Total:</strong> {formatCad(snapshot.totalCents)}</p>}<p>Finalized invoices cannot be edited. If correction is needed, use a future void or credit workflow.</p>{snapshotInvalid||!snapshot?<div className="error-state" role="alert"><p>PDF unavailable: the stored finalized snapshot is invalid or missing.</p><button type="button" onClick={loadDetail}>Retry</button></div>:<button className="primary" onClick={downloadFinalized} disabled={downloading}>{downloading?'Preparing PDF…':'Download PDF'}</button>}{message&&<p role="status">{message}</p>}</div></section>
  }
  const finalizeStudent=student?.name||'Unknown student'
  const finalizeTotal=formatCad(eligible.reduce((total,lesson)=>total+lesson.charge_cents,0))
  return <section><h1>Invoice draft</h1>
    <ConfirmationDialog open={finalizeOpen} title="Finalize this invoice?" confirmLabel="Finalize invoice" pending={finalizing} onCancel={()=>setFinalizeOpen(false)} onConfirm={finalize}>
      <dl className="confirmation-summary">
        <dt>Student</dt><dd>{finalizeStudent}</dd>
        <dt>Service period</dt><dd>{formatDateOnly(draftStart)} – {formatDateOnly(draftEnd)}</dd>
        <dt>Eligible lessons</dt><dd>{eligible.length}</dd>
        <dt>Total</dt><dd>{finalizeTotal}</dd>
      </dl>
      <p>This is irreversible. A finalized invoice cannot be edited or deleted.</p>
    </ConfirmationDialog>
    <ConfirmationDialog open={draftDeleteOpen} title="Delete draft?" confirmLabel="Delete draft" pending={deletingDraft} onCancel={()=>setDraftDeleteOpen(false)} onConfirm={deleteDraft}>
      <p>This draft and its unsaved range are permanently deleted.</p>
    </ConfirmationDialog>
    <div className="form-grid card"><label>Student<select value={invoice.student_id} disabled>{students.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label>Start date<input type="date" value={draftStart} onChange={e=>{setDraftStart(e.target.value);setEligible([]);setPreviewFresh(false);previewGeneration.current++}} /></label>
    <label>End date<input type="date" value={draftEnd} onChange={e=>{setDraftEnd(e.target.value);setEligible([]);setPreviewFresh(false);previewGeneration.current++}} /></label>
    <div className="actions"><button onClick={preview} disabled={previewing}>{previewing?'Previewing…':'Preview'}</button><button onClick={saveDraft} disabled={savingDraft}>{savingDraft?'Saving…':'Save draft'}</button><button className="primary" onClick={()=>setFinalizeOpen(true)} disabled={previewing||finalizing||draftStart>draftEnd||!previewFresh||previewOverlap||!eligible.length||!teacherName}>{finalizing?(pdfProgress||'Finalizing…'):'Finalize and download'}</button><button className="danger" onClick={()=>setDraftDeleteOpen(true)} disabled={deletingDraft}>Delete draft</button></div>
  </div>{draftStart>draftEnd&&<p className="error">The start date must be on or before the end date.</p>}
  {!teacherName&&<p className="error">Enter the teacher name in Settings before finalizing.</p>}
  {!eligible.length&&!previewing&&<p className="empty">Finalize is disabled because there are no unbilled lessons in the selected date range.</p>}
  {message&&<p role="status">{message}</p>}<h2>Eligible lessons</h2><ul>{eligible.map(l=><li key={l.id}>{l.lesson_date} — {l.minutes} minutes — {formatCad(l.charge_cents)}</li>)}</ul></section>
}
