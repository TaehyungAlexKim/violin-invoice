// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { snapshotToDocument } from './invoice-document'
import { deterministicFilename } from '../domain/invoice-snapshot'
import type { InvoiceSnapshot } from '../domain/invoice-snapshot'
import { readFile } from 'node:fs/promises'
import { PassThrough } from 'node:stream'

const snapshot: InvoiceSnapshot = {
  schemaVersion:1,currency:'CAD',businessTimezone:'America/Vancouver',locale:'en-CA',
  invoice:{id:'1',number:'VI-2026-000042',status:'finalized',issueDate:'2026-11-22'},
  servicePeriod:{start:'2026-11-01',end:'2026-11-30'},
  sender:{teacherName:'김민수',businessName:'Kim Violin'},recipient:{studentName:'Lee'},
  lines:[{sourceLessonId:'a',lessonDate:'2026-11-04',minutes:45,chargeCents:6750}],
  subtotalCents:6750,taxCents:0,totalCents:6750,
  render:{fontManifest:{family:'Noto Sans KR',normalFile:'NotoSansKR.ttf',sha256:'194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252',license:'OFL-1.1',licenseFile:'OFL.txt',normalOnly:true},templateVersion:'1.0',rendererName:'pdfmake',rendererVersion:'0.3.15'},
}

describe('invoice PDF contract',()=>{
 it('uses snapshot-only text and deterministic filename',()=>{
  const doc=snapshotToDocument(snapshot)
  expect(JSON.stringify(doc)).toContain('김민수')
  expect(JSON.stringify(doc)).not.toContain('Tax')
  expect(deterministicFilename(snapshot)).toBe('VI-2026-000042_2026-11-01_2026-11-30.pdf')
 })
 it('omits empty optional fields',()=>{
  const doc=snapshotToDocument({...snapshot,sender:{teacherName:'Teacher'},recipient:{studentName:'Student'}})
  expect(JSON.stringify(doc)).not.toContain('recipientName')
  expect(JSON.stringify(doc)).not.toContain('businessName')
 })
 it('renders a genuine PDF fixture for 1, 40, and 100+ lines', async ()=>{
  const fontBytes = await readFile('public/fonts/NotoSansKR.ttf')
  const [{default:PdfPrinter},virtualFsModule,{default:URLResolver}] = await Promise.all([
    import('pdfmake/src/Printer.js'),
    import('pdfmake/src/virtual-fs.js'),
    import('pdfmake/src/URLResolver.js'),
  ])
  const VirtualFileSystem = virtualFsModule.VirtualFileSystem
  const vfs = new VirtualFileSystem()
  vfs.writeFileSync('NotoSansKR.ttf', fontBytes)
  const urlResolver = new URLResolver(vfs, vfs)
  const printer = new PdfPrinter(
    {NotoSansKR:{normal:'NotoSansKR.ttf',bold:'NotoSansKR.ttf',italics:'NotoSansKR.ttf',bolditalics:'NotoSansKR.ttf'}},
    vfs,
    urlResolver,
    ()=>true,
  )
  for (const count of [1,40,100]) {
   const lines = Array.from({length:count},(_,index)=>({sourceLessonId:String(index),lessonDate:'2026-11-04',minutes:60,chargeCents:100}))
   const fixture={...snapshot,lines,subtotalCents:count*100,taxCents:0 as const,totalCents:count*100}
   const doc=snapshotToDocument(fixture)
   const pdfDocument = await printer.createPdfKitDocument(doc)
   const pdf = await new Promise<Uint8Array>((resolve,reject)=>{
    const chunks: Uint8Array[]=[]
    const stream = new PassThrough()
    stream.on('data',(chunk:Uint8Array)=>chunks.push(chunk))
    stream.on('end',()=>resolve(Buffer.concat(chunks)))
    stream.on('error',reject)
    pdfDocument.pipe(stream)
    pdfDocument.end()
   })
   expect(Buffer.from(pdf.subarray(0,5)).toString()).toBe('%PDF-')
   expect(pdf.byteLength).toBeGreaterThan(1000)
  }
 }, 20000)
})
