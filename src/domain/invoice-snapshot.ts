export type InvoiceSnapshot = {
  schemaVersion: 1
  invoice: { id: string; number: string; status: 'finalized'; issueDate: string }
  currency: 'CAD'
  businessTimezone: 'America/Vancouver'
  locale: 'en-CA'
  servicePeriod: { start: string; end: string }
  sender: Record<string, string>
  recipient: Record<string, string>
  lines: Array<{ sourceLessonId: string; lessonDate: string; minutes: number; chargeCents: number }>
  subtotalCents: number
  taxCents: 0
  totalCents: number
  render: {
    fontManifest: {
      family: 'Noto Sans KR'
      normalFile: 'NotoSansKR.ttf'
      sha256: '194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252'
      license: 'OFL-1.1'
      licenseFile: 'OFL.txt'
      normalOnly: true
      upstream?: string
    }
    templateVersion: '1.0'
    rendererName: 'pdfmake'
    rendererVersion: string
  }
}

export function deterministicFilename(snapshot: InvoiceSnapshot): string {
  return `${snapshot.invoice.number}_${snapshot.servicePeriod.start}_${snapshot.servicePeriod.end}.pdf`
}
