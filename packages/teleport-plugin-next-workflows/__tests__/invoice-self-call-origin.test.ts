import { Blob as NodeBlob } from 'buffer'
import type { UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import { createInvoiceRouteRequire } from './_helpers/load-invoice-route'

/**
 * The invoice routes upload the rendered PDF through the store's own
 * `/api/runtime-storage/upload`, presenting the app secret. The origin used to
 * be built from the request's Host header, which outside Vercel is whatever the
 * caller sent — so a forged Host sent the PDF, and NEXTAUTH_SECRET, to the
 * caller's server. It now follows the server runtime's trustedBaseUrl rule.
 * Executed against the emitted `utils/invoices/invoice-assembly.js`.
 */

const SETTINGS = {
  enabled: true,
  invoicePrefix: 'INV-',
  emailDelivery: { enabled: false },
} as unknown as UIDLInvoiceSettings

interface Assembly {
  requestBaseUrl: (req: unknown) => string
  uploadInvoicePdfToRuntimeStorage: (
    pdf: Buffer,
    fileName: string,
    baseUrl: string
  ) => Promise<{ storageUrl: string }>
}

const ENV_KEYS = ['NEXTAUTH_URL', 'VERCEL', 'NEXTAUTH_SECRET']

describe('invoice self-calls go to the store, never to a host the request named', () => {
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => {
    ENV_KEYS.forEach((key) => {
      saved[key] = process.env[key]
      delete process.env[key]
    })
  })
  afterEach(() => {
    ENV_KEYS.forEach((key) => {
      if (saved[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = saved[key]
      }
    })
  })

  const assembly = (): Assembly =>
    createInvoiceRouteRequire(SETTINGS, { dataAccess: {}, pdfGenerator: {} })(
      '../../../utils/invoices/invoice-assembly'
    ) as Assembly

  it("takes NEXTAUTH_URL's origin over a forged Host header", () => {
    process.env.NEXTAUTH_URL = 'https://shop.example/any/path'
    const { requestBaseUrl } = assembly()
    expect(requestBaseUrl({ headers: { host: 'evil.test' } })).toBe('https://shop.example')
    expect(requestBaseUrl({ headers: { host: 'evil.test', 'x-forwarded-proto': 'http' } })).toBe(
      'https://shop.example'
    )
  })

  it("keeps the routed host on Vercel, and a local server's own port", () => {
    process.env.NEXTAUTH_URL = 'https://shop.example'
    process.env.VERCEL = '1'
    expect(assembly().requestBaseUrl({ headers: { host: 'shop.vercel.app' } })).toBe(
      'https://shop.vercel.app'
    )

    delete process.env.VERCEL
    process.env.NEXTAUTH_URL = 'http://localhost:3000'
    expect(assembly().requestBaseUrl({ headers: { host: 'localhost:3001' } })).toBe(
      'http://localhost:3001'
    )
  })

  it('sends the upload, secret included, to the trusted origin', async () => {
    process.env.NEXTAUTH_URL = 'https://shop.example'
    process.env.NEXTAUTH_SECRET = 'app-secret'
    const { requestBaseUrl, uploadInvoicePdfToRuntimeStorage } = assembly()
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const globals = globalThis as any
    const original = { fetch: globals.fetch, Blob: globals.Blob, FormData: globals.FormData }
    // The upload builds a multipart form; the jest environment lacks Node's own.
    globals.Blob = globals.Blob || NodeBlob
    globals.FormData =
      globals.FormData ||
      class {
        public append(): void {
          return
        }
      }
    globals.fetch = async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers })
      return {
        ok: true,
        status: 200,
        json: async () => ({ files: [{ url: 'https://cdn.test/inv.pdf', id: 'f1' }] }),
      }
    }
    try {
      const result = await uploadInvoicePdfToRuntimeStorage(
        Buffer.from('%PDF-1.4'),
        'INV-0001.pdf',
        requestBaseUrl({ headers: { host: 'evil.test' } })
      )
      expect(result.storageUrl).toBe('https://cdn.test/inv.pdf')
    } finally {
      globals.fetch = original.fetch
      globals.Blob = original.Blob
      globals.FormData = original.FormData
    }
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://shop.example/api/runtime-storage/upload')
    expect(calls[0].headers['x-internal-data-secret']).toBe('app-secret')
  })
})
