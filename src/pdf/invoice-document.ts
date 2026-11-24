import type { TDocumentDefinitions, TableCell } from 'pdfmake/interfaces'
import { formatCad } from '../domain/money'
import type { InvoiceSnapshot } from '../domain/invoice-snapshot'
import { clampNoteToThreeLines } from '../domain/invoice-snapshot'

export function snapshotToDocument(snapshot: InvoiceSnapshot): TDocumentDefinitions {
  const sender = snapshot.sender
  const recipient = snapshot.recipient
  const senderHeader = sender.businessName || sender.teacherName
  const senderDetails = [sender.teacherName, sender.address, sender.email, sender.phone].filter(Boolean)
  const recipientDetails = [
    recipient.studentName,
    recipient.recipientName,
    recipient.email,
    recipient.phone,
    recipient.billingAddress,
  ].filter(Boolean)

  const body: TableCell[][] = [[
    { text: 'Date' },
    { text: 'Minutes' },
    { text: 'Actual charge (CAD)' },
  ]]
  snapshot.lines.forEach((line) => {
    body.push([
      line.lessonDate,
      String(line.minutes),
      formatCad(line.chargeCents),
    ])
    if (snapshot.render.templateVersion === '2.0' && typeof line.note === 'string' && line.note.trim()) {
      body.push([
        { text: clampNoteToThreeLines(line.note), colSpan: 3, margin: [0, 2, 0, 4] },
        '',
        '',
      ])
    }
  })

  return {
    pageSize: 'LETTER',
    pageMargins: [36, 36, 36, 36],
    defaultStyle: { font: 'NotoSansKR' },
    header: (currentPage: number) => currentPage > 1
      ? { text: snapshot.invoice.number, alignment: 'right', margin: [36, 18, 36, 0], fontSize: 8 }
      : undefined,
    footer: (currentPage: number, pageCount: number) => ({
      text: `${snapshot.invoice.number}  |  Page ${currentPage} of ${pageCount}`,
      alignment: 'right', margin: [36, 0, 36, 18], fontSize: 8,
    }),
    content: [
      {
        columns: [
          { width: '*', stack: [
            { text: senderHeader, fontSize: 18 },
            ...senderDetails.map((text) => ({ text })),
          ] },
          { width: 180, stack: [
            { text: 'INVOICE', fontSize: 22, alignment: 'right' },
            { text: snapshot.invoice.number, alignment: 'right' },
            { text: `Issue date: ${snapshot.invoice.issueDate}`, alignment: 'right' },
            { text: 'Currency: CAD', alignment: 'right' },
          ] },
        ],
        margin: [0, 0, 0, 18],
      },
      { text: 'Bill to', fontSize: 11 },
      { stack: recipientDetails.map((text) => ({ text })), margin: [0, 4, 0, 14] },
      { text: `Service period: ${snapshot.servicePeriod.start} – ${snapshot.servicePeriod.end}`, margin: [0, 0, 0, 10] },
      {
        table: {
          headerRows: 1,
          widths: ['*', 70, 120],
          dontBreakRows: true,
          body,
        },
        layout: 'lightHorizontalLines',
      },
      {
        table: { widths: ['*', 120], body: [[
          { text: 'Subtotal' }, { text: formatCad(snapshot.subtotalCents), alignment: 'right' },
        ], [
          { text: 'Total' }, { text: `CAD ${formatCad(snapshot.totalCents)}`, alignment: 'right' },
        ]] },
        layout: 'noBorders',
        margin: [0, 12, 0, 0],
      },
    ],
  }
}
