declare module 'pdfmake/src/Printer.js' {
  export default class PdfPrinter {
    constructor(fontDescriptors: object, virtualfs: object, urlResolver?: object, localAccessPolicy?: (url: string) => boolean)
    createPdfKitDocument(document: unknown): Promise<{
      pipe(stream: unknown): unknown
      end(): void
    }>
  }
}

declare module 'pdfmake/src/virtual-fs.js' {
  export class VirtualFileSystem {
    writeFileSync(filename: string, content: Uint8Array | Buffer): void
  }
}

declare module 'pdfmake/src/URLResolver.js' {
  export default class URLResolver {
    constructor(fs: object, sharedFs: object)
  }
}
