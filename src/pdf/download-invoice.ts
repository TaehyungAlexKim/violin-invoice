import type { InvoiceSnapshot } from '../domain/invoice-snapshot'
import { deterministicFilename } from '../domain/invoice-snapshot'
import { snapshotToDocument } from './invoice-document'
import { FONT_REGISTRY } from './font-registry'

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('')
}

export function pdfDownloadErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message.startsWith('PDF_RENDERER:')) return 'The PDF renderer could not be loaded. Refresh the page and try again.'
  if (message.startsWith('PDF_FONT:')) return 'The PDF font could not be loaded. Refresh the page and try again.'
  if (message.startsWith('PDF_FONT_VALIDATION:')) return 'The embedded PDF font failed validation. Contact the administrator.'
  if (message.startsWith('PDF_GENERATION:')) return 'The invoice PDF could not be generated. The finalized invoice remains available; try again.'
  if (message.startsWith('PDF_BROWSER_DOWNLOAD:')) return 'The browser blocked the PDF download. Check download permissions and try again.'
  return 'The PDF could not be downloaded. Check browser download permissions and try again.'
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
  let pdfMake
  try {
    ;[{ default: pdfMake }] = await Promise.all([
      import('pdfmake/build/pdfmake'),
    ])
  } catch {
    throw new Error('PDF_RENDERER: module load failed')
  }

  let fontResponse: Response
  let bytes: ArrayBuffer
  try {
    fontResponse = await fetch(`${import.meta.env.BASE_URL}fonts/${font.normalFile}`)
    if (!fontResponse.ok) throw new Error('HTTP error')
    bytes = await fontResponse.arrayBuffer()
  } catch {
    throw new Error('PDF_FONT: asset load failed')
  }
  if (await sha256(bytes).catch(() => '') !== font.sha256) {
    throw new Error('PDF_FONT_VALIDATION: checksum mismatch')
  }

  let blob: Blob
  try {
    let binary = ''
    const chunk = new Uint8Array(bytes)
    for (let i = 0; i < chunk.length; i += 8192) {
      binary += String.fromCharCode(...chunk.subarray(i, i + 8192))
    }
    const base64 = btoa(binary)
    const browserPdfMake = pdfMake as unknown as {
      addVirtualFileSystem(vfs: Record<string, string>): void
      addFonts(fonts: Record<string, unknown>): void
      createPdf(documentDefinition: ReturnType<typeof snapshotToDocument>): { getBlob(): Promise<Blob> }
    }
    browserPdfMake.addVirtualFileSystem({ [font.normalFile]: base64 })
    browserPdfMake.addFonts({
      NotoSansKR: { normal: font.normalFile, bold: font.normalFile, italics: font.normalFile, bolditalics: font.normalFile },
    })
    blob = await browserPdfMake.createPdf(snapshotToDocument(snapshot)).getBlob()
  } catch {
    throw new Error('PDF_GENERATION: render failed')
  }

  try {
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = deterministicFilename(snapshot)
    anchor.style.display = 'none'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  } catch {
    throw new Error('PDF_BROWSER_DOWNLOAD: download blocked')
  }
}
