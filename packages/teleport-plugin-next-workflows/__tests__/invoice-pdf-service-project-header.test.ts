import type { ProjectPluginStructure, UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import { generatePdfServiceClientCode } from '../src/invoice/pdf-service-client-code'
import { generateInvoiceFiles } from '../src/invoice'
import { createEnvFiles } from '../../teleport-project-generator/src/file-handlers'

/**
 * The invoice PDF service checks the key against the project id it comes with
 * (a per-project key the services worker derives at deploy time), so the
 * emitted client sends `PDF_SERVICE_PROJECT_ID` as `X-Pdf-Service-Project`
 * beside `PDF_SERVICE_API_KEY`. Executed against the emitted client.
 */

type CallPdfService = (html: string, invoiceData: unknown) => Promise<Buffer>

interface FetchCall {
  url: string
  init: { headers: Record<string, string> }
}

const loadClient = (env: Record<string, string>, calls: FetchCall[]): CallPdfService => {
  const fakeFetch = async (url: string, init: FetchCall['init']) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/pdf' : null),
      },
      arrayBuffer: async () => new ArrayBuffer(4),
      text: async () => '',
    }
  }
  const noop = (): void => undefined
  const quiet = { info: noop, error: noop, warn: noop }
  // The jest node environment has no AbortController; the client only needs
  // a signal to hand to fetch.
  class FakeAbortController {
    signal = {}
    abort(): void {
      return undefined
    }
  }
  // tslint:disable-next-line:function-constructor
  const factory = new Function(
    'process',
    'fetch',
    'console',
    'AbortController',
    `${generatePdfServiceClientCode()}\nreturn callPdfService;`
  )
  return factory({ env }, fakeFetch, quiet, FakeAbortController) as CallPdfService
}

describe('invoice PDF client sends the project id with its key', () => {
  it('sends X-Pdf-Service-Project from PDF_SERVICE_PROJECT_ID beside the key', async () => {
    const calls: FetchCall[] = []
    const callPdfService = loadClient(
      {
        PDF_SERVICE_URL: 'https://pdf.example/',
        PDF_SERVICE_API_KEY: 'tqpdf_abc',
        PDF_SERVICE_PROJECT_ID: 'project-a',
      },
      calls
    )

    await callPdfService('<p>x</p>', { invoiceNumber: 'INV-1' })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://pdf.example/generate')
    expect(calls[0].init.headers['X-Pdf-Service-Key']).toBe('tqpdf_abc')
    expect(calls[0].init.headers['X-Pdf-Service-Project']).toBe('project-a')
  })

  it('omits the header when the deploy gave no project id (the service then decides)', async () => {
    const calls: FetchCall[] = []
    const callPdfService = loadClient(
      { PDF_SERVICE_URL: 'https://pdf.example', PDF_SERVICE_API_KEY: 'legacy-key' },
      calls
    )

    await callPdfService('<p>x</p>', {})

    expect(calls[0].init.headers['X-Pdf-Service-Key']).toBe('legacy-key')
    expect('X-Pdf-Service-Project' in calls[0].init.headers).toBe(false)
  })

  // The services worker injects the per-project key only into a bundle whose
  // `.env` declares this line (the client that sends the project id); any
  // other bundle keeps the legacy key its client can use.
  it('emits PDF_SERVICE_PROJECT_ID= in the project .env so the deploy fills it', () => {
    const structure = {
      files: new Map(),
      dependencies: {},
      uidl: { components: {}, globals: { settings: { language: 'en' }, assets: [], env: {} } },
    } as unknown as ProjectPluginStructure
    generateInvoiceFiles(
      {
        enabled: true,
        invoicePrefix: 'INV-',
        emailDelivery: { enabled: false },
      } as unknown as UIDLInvoiceSettings,
      structure,
      'postgresql',
      null
    )
    expect(structure.uidl.globals.env).toMatchObject({
      PDF_SERVICE_URL: '',
      PDF_SERVICE_API_KEY: '',
      PDF_SERVICE_PROJECT_ID: '',
    })
    const dotEnv = createEnvFiles(structure.uidl.globals.env).find((f) => f.name === '.env')
    expect(dotEnv?.content.split('\n')).toEqual(
      expect.arrayContaining([
        'PDF_SERVICE_URL=',
        'PDF_SERVICE_API_KEY=',
        'PDF_SERVICE_PROJECT_ID=',
      ])
    )
  })
})
