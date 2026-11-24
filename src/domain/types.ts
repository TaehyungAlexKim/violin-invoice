import type { InvoiceSnapshot } from './invoice-snapshot'

export type Student = {
  id: string
  name: string
  archived_at?: string | null
  recipient_name?: string | null
  email?: string | null
  phone?: string | null
  billing_address?: string | null
  memo?: string | null
}

export type Lesson = {
  id: string
  student_id: string
  lesson_date: string
  minutes: number
  charge_cents: number
  entry_key: string
  note?: string | null
}

export type Invoice = {
  id: string
  student_id: string
  entry_key?: string
  status: 'draft' | 'finalized'
  period_start: string
  period_end: string
  issue_date?: string | null
  finalized_at?: string | null
  invoice_number?: string | null
  snapshot_json?: InvoiceSnapshot | null
  snapshot_schema_version?: number | null
}
