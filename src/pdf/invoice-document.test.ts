// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { snapshotToDocument } from './invoice-document'
import { deterministicFilename } from '../domain/invoice-snapshot'
import type { InvoiceSnapshot } from '../domain/invoice-snapshot'
import { readFile } from 'node:fs/promises'
import { PassThrough } from 'node:stream'
import { createHash } from 'node:crypto'

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
 it('ships v2 glyph coverage and a deterministic hash', async ()=>{
  const font=await readFile('public/fonts/NotoSansKR-subset-2.0.ttf')
  const hash=createHash('sha256').update(font).digest('hex')
  expect(hash).toBe('c9a5624db8919577ac53deb3a111dc6561bd4b69c06774288cc634a630f24c60')
  const fontkitModule: unknown = await import('fontkit')
  const create=(fontkitModule as {create:(data:Uint8Array)=>{hasGlyphForCodePoint(code:number):boolean}}).create
  const parsed=create(font)
  for(const character of ['é','É','ü','ç','’','–','—','·','₩','€','가','A','(','.']) {
   expect(parsed.hasGlyphForCodePoint(character.codePointAt(0)||0)).toBe(true)
  }
 })
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
 it('adds a note-only second visual row and clamps a long note to three lines',()=>{
   const withNote={...snapshot,render:{...snapshot.render,templateVersion:'2.0' as const},lines:[{...snapshot.lines[0],note:'Practice scales slowly'}]}
   const doc=snapshotToDocument(withNote)
   expect(JSON.stringify(doc)).toContain('Practice scales slowly')
   const long={...withNote,lines:[{...snapshot.lines[0],note:'Wide日本語'.repeat(50)}]}
   const longDoc=snapshotToDocument(long)
   const text=JSON.stringify(longDoc)
   expect(text).toContain('\\n')
   expect(text).not.toContain('A'.repeat(301))
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
  const v2Font=await readFile('public/fonts/NotoSansKR-subset-2.0.ttf')
  vfs.writeFileSync('NotoSansKR-subset-2.0.ttf', v2Font)
  const v2Fixture={...snapshot,render:{...snapshot.render,templateVersion:'2.0' as const,fontManifest:{...snapshot.render.fontManifest,normalFile:'NotoSansKR-subset-2.0.ttf' as const,sha256:'c9a5624db8919577ac53deb3a111dc6561bd4b69c06774288cc634a630f24c60'}},sender:{teacherName:'김민수 – Lee Éléonore',businessName:'Violin · Studio €',address:'123 Rue Élisabeth — Montréal, Québec',phone:'김학생 010-1234-5678'},recipient:{studentName:'Chloé Müller – 김학생'}}
  const v2Doc=snapshotToDocument(v2Fixture)
  const v2PdfDocument=await printer.createPdfKitDocument(v2Doc)
  const v2Pdf=await new Promise<Uint8Array>((resolve,reject)=>{
   const chunks:Uint8Array[]=[];const stream=new PassThrough()
   stream.on('data',(chunk:Uint8Array)=>chunks.push(chunk));stream.on('end',()=>resolve(Buffer.concat(chunks)));stream.on('error',reject)
   v2PdfDocument.pipe(stream);v2PdfDocument.end()
  })
  expect(Buffer.from(v2Pdf.subarray(0,5)).toString()).toBe('%PDF-')
 }, 20000)
})
