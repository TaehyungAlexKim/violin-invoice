export const LESSON_NOTE_MAX_LENGTH = 300

export function normalizeLessonNote(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return Array.from(trimmed).slice(0, LESSON_NOTE_MAX_LENGTH).join('')
}

export function clampNoteToThreeLines(value: string): string {
  const normalized = normalizeLessonNote(value)
  if (!normalized) return ''
  const points = Array.from(normalized.replace(/\r\n?|\n/g, '\n'))
  const lines: string[] = []
  let current = ''
  let units = 0
  let index = 0
  while (index < points.length && lines.length < 3) {
    const character = points[index]
    if (character === '\n') {
      lines.push(current)
      current = ''
      units = 0
      index++
      continue
    }
    const width = /[\u2E80-\u9FFF\uAC00-\uD7AF\u3040-\u30FF]/u.test(character) ? 1 : 0.55
    const isLastVisibleLine = lines.length === 2
    const hasMoreAfterCharacter = index < points.length - 1
    const ellipsisRoom = isLastVisibleLine && hasMoreAfterCharacter ? 0.55 : 0
    if (units + width + ellipsisRoom > 55 && current) {
      if (isLastVisibleLine) {
        current += '…'
      }
      lines.push(current)
      current = ''
      units = 0
      continue
    }
    current += character
    units += width
    index++
  }
  if (lines.length < 3 && current) {
    lines.push(current)
  }
  if (index < points.length && lines.length === 3 && !lines[2].endsWith('…')) {
    lines[2] = `${lines[2].slice(0, -1)}…`
  }
  return lines.join('\n')
}

export type InvoiceSnapshot = {
  schemaVersion: 1
  invoice: { id: string; number: string; status: 'finalized'; issueDate: string }
  currency: 'CAD'
  businessTimezone: 'America/Vancouver'
  locale: 'en-CA'
  servicePeriod: { start: string; end: string }
  sender: Record<string, string>
  recipient: Record<string, string>
  lines: Array<{ sourceLessonId: string; lessonDate: string; minutes: number; chargeCents: number; note?: string }>
  subtotalCents: number
  taxCents: 0
  totalCents: number
  render: {
    fontManifest: {
      family: 'Noto Sans KR'
      normalFile: 'NotoSansKR.ttf' | 'NotoSansKR-subset-2.0.ttf'
      sha256: string
      license: 'OFL-1.1'
      licenseFile: 'OFL.txt'
      normalOnly: true
      upstream?: string
    }
    templateVersion: '1.0' | '2.0'
    rendererName: 'pdfmake'
    rendererVersion: string
  }
}

export function deterministicFilename(snapshot: InvoiceSnapshot): string {
  return `${snapshot.invoice.number}_${snapshot.servicePeriod.start}_${snapshot.servicePeriod.end}.pdf`
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function validateInvoiceSnapshot(value: unknown): InvoiceSnapshot {
  if (!record(value)) throw new Error('Invalid invoice snapshot: object required.')
  if (value.schemaVersion !== 1) throw new Error('Unsupported invoice snapshot schema.')
  if (value.currency !== 'CAD' || value.businessTimezone !== 'America/Vancouver' || value.locale !== 'en-CA') {
    throw new Error('Invalid invoice snapshot locale or currency.')
  }
  if (!record(value.invoice) || typeof value.invoice.id !== 'string' ||
      typeof value.invoice.number !== 'string' || value.invoice.status !== 'finalized' ||
      !isIsoDate(value.invoice.issueDate)) {
    throw new Error('Invalid finalized invoice identity.')
  }
  if (!record(value.servicePeriod) || !isIsoDate(value.servicePeriod.start) || !isIsoDate(value.servicePeriod.end)) {
    throw new Error('Invalid invoice service period.')
  }
  if (!record(value.sender) || !record(value.recipient) || !Array.isArray(value.lines)) {
    throw new Error('Invalid invoice snapshot parties or lines.')
  }
  if (!value.lines.every((line) => record(line) &&
      typeof line.sourceLessonId === 'string' && isIsoDate(line.lessonDate) &&
      Number.isInteger(line.minutes) && Number.isInteger(line.chargeCents) &&
      (line.note === undefined || (typeof line.note === 'string' && line.note.length <= LESSON_NOTE_MAX_LENGTH)))) {
    throw new Error('Invalid invoice snapshot lesson lines.')
  }
  for (const key of ['subtotalCents', 'taxCents', 'totalCents'] as const) {
    if (!Number.isInteger(value[key]) || (value[key] as number) < 0) {
      throw new Error(`Invalid invoice snapshot ${key}.`)
    }
  }
  if (value.taxCents !== 0) throw new Error('Unexpected invoice tax in snapshot.')
  if (!record(value.render) || !record(value.render.fontManifest)) {
    throw new Error('Invalid invoice snapshot render manifest.')
  }
  const font = value.render.fontManifest
  if (font.family !== 'Noto Sans KR' ||
      !['NotoSansKR.ttf','NotoSansKR-subset-2.0.ttf'].includes(String(font.normalFile)) ||
      typeof font.sha256 !== 'string' || font.license !== 'OFL-1.1' ||
      font.normalOnly !== true) {
    throw new Error('Invalid invoice font manifest.')
  }
  if (!['1.0','2.0'].includes(String(value.render.templateVersion)) || value.render.rendererName !== 'pdfmake' ||
      typeof value.render.rendererVersion !== 'string') {
    throw new Error('Invalid invoice renderer manifest.')
  }
  return value as unknown as InvoiceSnapshot
}
