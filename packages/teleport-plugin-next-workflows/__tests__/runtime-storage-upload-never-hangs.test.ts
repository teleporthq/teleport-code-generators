// An upload must FAIL when it cannot succeed — it must never simply not finish.
//
// The incident: the runtime-storage worker's database connections went
// half-open, so every request that touched the database waited for a reply that
// was never coming. Nothing between the shopper and that socket had a deadline
// — not the generated `/api/runtime-storage/upload` proxy, not the
// `file-storage-upload` node — so the browser request stayed PENDING
// indefinitely. The workflow never reached its error branch (there was no
// error), the submitting flag was never cleared, and the review form was simply
// dead with no message.
//
// Both halves are pinned here, including the relationship between them: the
// proxy must give up FIRST, so the shopper is told what went wrong by the side
// that knows, rather than by the client abandoning a request that was still
// alive.

import { Blob as NodeBlob } from 'buffer'
import { nodeRegistry } from '../src'
import {
  UPLOAD_PROXY_TIMEOUT_MS,
  generateRuntimeStorageUploadRoute,
} from '../src/runtime-storage-generator'
import { loadHandler, HandlerFn } from './_helpers/load-handler'
import { installUploadGlobals, removeUploadGlobals } from './_helpers/abort-controller-stub'

class FormDataStub {
  public appended: Array<{ key: string; value: unknown; fileName?: string }> = []
  public append(key: string, value: unknown, fileName?: string): void {
    this.appended.push({ key, value, fileName })
  }
}

const PICKED_FILE = {
  name: 'photo.png',
  size: 9,
  type: 'image/png',
  lastModified: 1,
  dataURL: `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`,
}

/** The literal timeout the generated client handler carries. */
const clientTimeoutMs = (): number => {
  const handlerSource = nodeRegistry['file-storage-upload'].generateHandler()
  const match = /UPLOAD_TIMEOUT_MS\s*=\s*(\d+)/.exec(handlerSource)
  if (!match) {
    throw new Error('the file-storage-upload handler declares no UPLOAD_TIMEOUT_MS')
  }
  return Number(match[1])
}

describe('the generated upload proxy route', () => {
  const route = generateRuntimeStorageUploadRoute()

  it('aborts the upstream fetch on a deadline instead of awaiting it forever', () => {
    expect(route).toContain('new AbortController()')
    expect(route).toContain('signal: controller.signal')
    expect(route).toContain(`var UPLOAD_TIMEOUT_MS = ${UPLOAD_PROXY_TIMEOUT_MS}`)
    expect(route).toContain('clearTimeout(timer)')
  })

  it('answers a stalled upstream with a 504 the workflow can report', () => {
    // A pending request tells the shopper nothing. A status does.
    expect(route).toContain('res.status(504)')
    expect(route).toContain("error: 'UPLOAD_TIMEOUT'")
  })

  it('survives an upstream that answers with something other than JSON', () => {
    // A gateway 502 is an HTML page; parsing it as JSON used to throw inside the
    // handler and be reported as a generic proxy failure, losing the status that
    // explains it.
    expect(route).toContain('await storageRes.text()')
    expect(route).toContain('UPLOAD_UPSTREAM_INVALID_RESPONSE')
  })

  it('gives up BEFORE the client does, so the 504 is what the shopper sees', () => {
    expect(UPLOAD_PROXY_TIMEOUT_MS).toBeLessThan(clientTimeoutMs())
  })
})

describe('file-storage-upload: an upstream that never answers', () => {
  let handler: HandlerFn

  beforeEach(() => {
    jest.useFakeTimers()
    handler = loadHandler('file-storage-upload')
    installUploadGlobals({
      FormData: FormDataStub,
      Blob: NodeBlob,
      atob: (encoded: string) => Buffer.from(encoded, 'base64').toString('binary'),
    })
  })

  afterEach(() => {
    jest.useRealTimers()
    removeUploadGlobals(['fetch', 'FormData', 'Blob', 'atob'])
  })

  it('settles with a timeout error rather than never settling', async () => {
    // The exact shape of the incident: a fetch that neither resolves nor
    // rejects until something aborts it.
    ;(globalThis as any).fetch = jest.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const abortError = new Error('The operation was aborted.')
            abortError.name = 'AbortError'
            reject(abortError)
          })
        })
    )

    const pending = handler({ file: [PICKED_FILE] }, {}) as Promise<{
      files: unknown[]
      error: string
      statusCode?: number
    }>

    jest.advanceTimersByTime(clientTimeoutMs())

    const result = await pending
    expect(result.files).toEqual([])
    expect(result.statusCode).toBe(504)
    expect(result.error.toLowerCase()).toContain('timed out')
  })

  it('passes an abort signal to the fetch at all', async () => {
    const fetchMock = jest.fn(async (_url: string, _init: { signal?: { aborted: boolean } }) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ files: [] }),
    }))
    ;(globalThis as any).fetch = fetchMock

    await handler({ file: [PICKED_FILE] }, {})

    const init = fetchMock.mock.calls[0][1]
    expect(init.signal).toBeDefined()
    expect(typeof init.signal!.aborted).toBe('boolean')
  })

  it('reports the upstream status when the body is not JSON', async () => {
    ;(globalThis as any).fetch = jest.fn(async () => ({
      ok: false,
      status: 502,
      text: async () => '<html><body>Bad Gateway</body></html>',
    }))

    const result = (await handler({ file: [PICKED_FILE] }, {})) as {
      error: string
      statusCode: number
    }

    expect(result.statusCode).toBe(502)
    // Never "Unexpected token <".
    expect(result.error).toContain('502')
  })

  it('reports the readable message, not the machine code', async () => {
    // Whatever this returns is toasted verbatim at the shopper. "Upload would
    // exceed storage limit" is an explanation; "STORAGE_LIMIT_EXCEEDED" is not.
    ;(globalThis as any).fetch = jest.fn(async () => ({
      ok: false,
      status: 413,
      text: async () =>
        JSON.stringify({
          error: 'STORAGE_LIMIT_EXCEEDED',
          message: 'Upload would exceed storage limit',
          storageLimit: 20971520,
        }),
    }))

    const result = (await handler({ file: [PICKED_FILE] }, {})) as {
      error: string
      statusCode: number
      storageLimit: number
    }

    expect(result.error).toBe('Upload would exceed storage limit')
    expect(result.statusCode).toBe(413)
    // …and the numbers a "you need more room" message would want survive.
    expect(result.storageLimit).toBe(20971520)
  })

  it('clears its timer on the happy path, so the tab is not held awake', async () => {
    ;(globalThis as any).fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ files: [{ url: 'https://cdn/a.png' }] }),
    }))

    await handler({ file: [PICKED_FILE] }, {})

    expect(jest.getTimerCount()).toBe(0)
  })
})
