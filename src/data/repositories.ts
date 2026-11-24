import type { SupabaseClient } from '@supabase/supabase-js'
import type { Student, Lesson, Invoice } from '../domain/types'
import { validateInvoiceSnapshot } from '../domain/invoice-snapshot'

type Client = SupabaseClient

export async function loadStudentDetail(
  client: Client,
  id: string,
): Promise<{ student: Student | null; lessons: Lesson[]; invoices: Invoice[]; claimed: Set<string>; error: unknown }> {
  const [student, lessons, invoices, claims] = await Promise.all([
    client.from('students').select('*').eq('id', id).maybeSingle(),
    client.from('lessons').select('*').eq('student_id', id).order('lesson_date', { ascending: false }),
    client.from('invoices').select('*').eq('student_id', id).order('period_end', { ascending: false }).order('finalized_at', { ascending: false }).order('id', { ascending: false }),
    client.from('invoice_lesson_claims').select('lesson_id'),
  ])
  const error = student.error || lessons.error || invoices.error || claims.error
  return {
    student: student.data as Student | null,
    lessons: (lessons.data || []) as Lesson[],
    invoices: (invoices.data || []) as Invoice[],
    claimed: new Set(((claims.data || []) as { lesson_id: string }[]).map(row => row.lesson_id)),
    error,
  }
}

export async function loadInvoiceDetail(
  client: Client,
  id: string,
): Promise<{ invoice: Invoice | null; students: Student[]; teacherName: string; snapshotInvalid: boolean; error: unknown }> {
  const [invoice, students, teacher] = await Promise.all([
    client.from('invoices').select('*').eq('id', id).maybeSingle(),
    client.from('students').select('*'),
    client.from('teacher_settings').select('teacher_name').maybeSingle(),
  ])
  let validatedInvoice: Invoice | null = null
  let snapshotError: unknown = null
  if (invoice.data) {
    const row = invoice.data as Invoice
    if (row.status === 'finalized') {
      try {
        row.snapshot_json = row.snapshot_json ? validateInvoiceSnapshot(row.snapshot_json) : null
      } catch (error) {
        snapshotError = error
        row.snapshot_json = null
      }
    }
    validatedInvoice = row
  }
  return {
    invoice: validatedInvoice,
    students: (students.data || []) as Student[],
    teacherName: (teacher.data as { teacher_name?: string } | null)?.teacher_name || '',
    snapshotInvalid: Boolean(snapshotError),
    error: invoice.error || students.error || teacher.error,
  }
}

export function reconcileDraftEntryKey(
  insertError: unknown,
  existingRow: Invoice | null,
): { reconciled: boolean; existing: Invoice | null } {
  const error = insertError as { code?: string } | null
  if (error?.code !== '23505') return { reconciled: false, existing: null }
  return existingRow
    ? { reconciled: true, existing: existingRow }
    : { reconciled: false, existing: null }
}

export function reconcileDraftNavigation(
  operation: { key: string; studentId: string },
  row: Invoice | null,
): { safe: boolean; invoice: Invoice | null } {
  if (!row) return { safe: false, invoice: null }
  if (row.entry_key !== operation.key || row.student_id !== operation.studentId || row.status !== 'draft') {
    return { safe: false, invoice: null }
  }
  return { safe: true, invoice: row }
}

export async function reconcileFinalizationFailure(
  client: Client,
  invoiceId: string,
  studentId: string,
  originalError: unknown,
): Promise<{kind:'finalized';invoice:Invoice;invalidSnapshot:boolean}|{kind:'original';error:unknown}> {
  const refetch=await client.from('invoices').select('*').eq('id',invoiceId).maybeSingle()
  if(refetch.error || !refetch.data) return {kind:'original',error:originalError}
  const invoice=refetch.data as Invoice
  if(invoice.id!==invoiceId||invoice.student_id!==studentId||invoice.status!=='finalized') {
    return {kind:'original',error:originalError}
  }
  let invalidSnapshot=false
  if(invoice.snapshot_json){
    try{invoice.snapshot_json=validateInvoiceSnapshot(invoice.snapshot_json)}
    catch{invoice.snapshot_json=null;invalidSnapshot=true}
  }else invalidSnapshot=true
  return {kind:'finalized',invoice,invalidSnapshot}
}

export function previewResultIsCurrent(
  operationGeneration: number,
  currentGeneration: number,
  operationIdentity: string,
  currentIdentity: string,
): boolean {
  return operationGeneration === currentGeneration && operationIdentity === currentIdentity
}
