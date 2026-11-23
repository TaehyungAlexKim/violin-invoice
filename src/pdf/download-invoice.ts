import type { InvoiceSnapshot } from '../domain/invoice-snapshot'
import { deterministicFilename } from '../domain/invoice-snapshot'
import { snapshotToDocument } from './invoice-document'
import { FONT_REGISTRY } from './font-registry'

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('')
}

export async function downloadInvoice(snapshot: InvoiceSnapshot): Promise<void> {
  if (snapshot.schemaVersion !== 1) throw new Error('Unsupported snapshot schema version.')
  if (snapshot.render.templateVersion !== '1.0') throw new Error('Unsupported PDF template version.')
  if (snapshot.render.rendererName !== 'pdfmake' || snapshot.render.rendererVersion !== '0.3.15') {
    throw new Error('Unsupported PDF renderer version.')
  }
  const font = FONT_REGISTRY['1.0']
  if (snapshot.render.fontManifest.family !== font.family ||
      snapshot.render.fontManifest.normalFile !== font.normalFile ||
      snapshot.render.fontManifest.sha256 !== font.sha256 ||
      snapshot.render.fontManifest.normalOnly !== true) {
    throw new Error('The snapshot font manifest is incompatible with this PDF template.')
  }
  const [{ default: pdfMake }] = await Promise.all([
    import('pdfmake/build/pdfmake'),
  ])
  const fontResponse = await fetch(`${import.meta.env.BASE_URL}fonts/${font.normalFile}`)
  if (!fontResponse.ok) throw new Error('The embedded Korean/Latin font could not be loaded.')
  const bytes = await fontResponse.arrayBuffer()
  if (await sha256(bytes) !== font.sha256) throw new Error('The embedded font failed SHA-256 verification.')
  let binary = ''
  const chunk = new Uint8Array(bytes)
  for (let i = 0; i < chunk.length; i += 8192) {
    binary += String.fromCharCode(...chunk.subarray(i, i + 8192))
  }
  const base64 = btoa(binary)
  ;(pdfMake as unknown as { vfs: Record<string, string>; fonts: Record<string, unknown> }).vfs = {
    [font.normalFile]: base64,
  }
  ;(pdfMake as unknown as { fonts: Record<string, unknown> }).fonts = {
    NotoSansKR: { normal: font.normalFile, bold: font.normalFile, italics: font.normalFile, bolditalics: font.normalFile },
  }
  const blob = await pdfMake.createPdf(snapshotToDocument(snapshot)).getBlob()
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = deterministicFilename(snapshot)
  anchor.style.display = 'none'
  document.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  }
}
