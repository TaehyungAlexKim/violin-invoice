import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { downloadInvoice } from './download-invoice'
import type { InvoiceSnapshot } from '../domain/invoice-snapshot'

const snapshot: InvoiceSnapshot = {
  schemaVersion: 1,
  currency: 'CAD',
  businessTimezone: 'America/Vancouver',
  locale: 'en-CA',
  invoice: { id: '1', number: 'VI-2026-000001', status: 'finalized', issueDate: '2026-11-23' },
  servicePeriod: { start: '2026-11-01', end: '2026-11-23' },
  sender: { teacherName: 'Teacher' },
  recipient: { studentName: 'Student' },
  lines: [{ sourceLessonId: 'lesson-1', lessonDate: '2026-11-04', minutes: 60, chargeCents: 6500 }],
  subtotalCents: 6500,
  taxCents: 0,
  totalCents: 6500,
  render: {
    fontManifest: {
      family: 'Noto Sans KR',
      normalFile: 'NotoSansKR.ttf',
      sha256: '194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252',
      license: 'OFL-1.1',
      licenseFile: 'OFL.txt',
      normalOnly: true,
    },
    templateVersion: '1.0',
    rendererName: 'pdfmake',
    rendererVersion: '0.3.15',
  },
}

describe('browser PDF download', () => {
  afterEach(() => vi.restoreAllMocks())

  it('registers browser VFS fonts, renders a Blob, and clicks the download link', async () => {
    const font = await readFile('public/fonts/NotoSansKR.ttf')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(font)))
    vi.stubGlobal('crypto', globalThis.crypto)
    const createObjectUrl = vi.fn().mockReturnValue('blob:invoice')
    const revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    await downloadInvoice(snapshot)

    expect(createObjectUrl).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
  }, 20_000)
})
