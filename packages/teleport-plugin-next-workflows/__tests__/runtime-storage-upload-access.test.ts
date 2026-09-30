/* tslint:disable:function-constructor */
import { Readable } from 'stream'
import {
  VISITOR_MAX_FILE_BYTES,
  VISITOR_MAX_FILES,
  generateRuntimeStorageUploadRoute,
} from '../src/runtime-storage-generator'
import { AbortControllerStub } from './_helpers/abort-controller-stub'

/**
 * `/api/runtime-storage/upload` stores files on the merchant's quota at a
 * public URL. It used to forward anything — any type, any size, a `private`
 * flag — and the storage worker checked the file against limits the same
 * request supplied. Executed here against the emitted route with a fake
 * upstream: what a visitor may upload is decided by the route, by each file's
 * own bytes; the store's server code and its admins upload as before.
 */

const SECRET = 'app-secret'
const BOUNDARY = '----tqboundary'

const PNG = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from('rest-of-png'),
])
const JPEG = Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.from('jfif')])
const PDF = Buffer.from('%PDF-1.7 a print file')
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
const HTML = Buffer.from('<html><body>phish</body></html>')

interface Part {
  name: string
  filename?: string
  type?: string
  data: Buffer | string
}

function multipart(parts: Part[]): Buffer {
  const chunks: Buffer[] = []
  for (const part of parts) {
    const disposition =
      'Content-Disposition: form-data; name="' +
      part.name +
      '"' +
      (part.filename !== undefined ? '; filename="' + part.filename + '"' : '')
    const header =
      '--' +
      BOUNDARY +
      '\r\n' +
      disposition +
      '\r\n' +
      (part.type ? 'Content-Type: ' + part.type + '\r\n' : '') +
      '\r\n'
    chunks.push(Buffer.from(header), Buffer.from(part.data), Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from('--' + BOUNDARY + '--\r\n'))
  return Buffer.concat(chunks)
}

interface Upstream {
  url: string
  headers: Record<string, string>
  body: unknown
}

function bootRoute(session: { role?: string } | null) {
  const code = generateRuntimeStorageUploadRoute()
  const moduleObj: { exports: any } = { exports: {} }
  const fakeRequire = (name: string): any => {
    if (name === 'next-auth/jwt') {
      return { getToken: async () => (session ? { sub: 'u1', role: session.role } : null) }
    }
    if (name === 'crypto') {
      return require('crypto')
    }
    throw new Error('unexpected require: ' + name)
  }
  const upstream: Upstream[] = []
  const fakeFetch = async (
    url: string,
    init: { headers: Record<string, string>; body: unknown }
  ) => {
    upstream.push({ url, headers: init.headers, body: init.body })
    return { status: 200, text: async () => JSON.stringify({ files: [{ url: 'https://cdn/x' }] }) }
  }
  const quiet = (): void => undefined
  new Function(
    'require',
    'module',
    'exports',
    'process',
    'console',
    'fetch',
    'AbortController',
    code
  )(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    {
      env: {
        NEXTAUTH_SECRET: SECRET,
        RUNTIME_STORAGE_URL: 'https://storage.test',
        RUNTIME_STORAGE_API_KEY: 'key',
        RUNTIME_STORAGE_PROJECT_ID: 'p1',
      },
    },
    { error: quiet, warn: quiet, log: quiet },
    fakeFetch,
    AbortControllerStub
  )
  const handler = moduleObj.exports
  return async (body: Buffer, headers: Record<string, string> = {}) => {
    upstream.length = 0
    const req = Object.assign(Readable.from([body]), {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=' + BOUNDARY,
        'content-length': String(body.length),
        ...(session ? { cookie: 'next-auth.session-token=signed' } : {}),
        ...headers,
      },
    })
    let status = 0
    let payload: any = null
    const res = {
      status(statusCode: number) {
        status = statusCode
        return res
      },
      json(value: any) {
        payload = value
        return res
      },
    }
    await handler(req, res)
    return { status, payload, upstream: upstream.slice() }
  }
}

describe('/api/runtime-storage/upload — what a visitor may store', () => {
  it('forwards a visitor’s images and PDFs, byte for byte', async () => {
    const upload = bootRoute(null)
    const body = multipart([
      { name: 'file', filename: 'photo.png', type: 'image/png', data: PNG },
      { name: 'file', filename: 'photo.jpg', type: 'image/jpg', data: JPEG },
      { name: 'file', filename: 'print.pdf', type: 'application/pdf', data: PDF },
      { name: 'folder', data: 'product-options' },
    ])
    const result = await upload(body)
    expect(result.status).toBe(200)
    expect(result.upstream).toHaveLength(1)
    expect(result.upstream[0].url).toBe('https://storage.test/project/p1/upload')
    expect(Buffer.compare(result.upstream[0].body as Buffer, body)).toBe(0)
    expect(result.upstream[0].headers['content-length']).toBe(String(body.length))
    expect(result.upstream[0].headers.Authorization).toBe('Bearer key')
  })

  it('refuses a file that is not what it claims, an SVG, or a page — by its bytes', async () => {
    const upload = bootRoute({ role: 'user' })
    for (const part of [
      { name: 'file', filename: 'x.png', type: 'image/png', data: HTML },
      { name: 'file', filename: 'x.svg', type: 'image/svg+xml', data: SVG },
      { name: 'file', filename: 'x.html', type: 'text/html', data: HTML },
      // Declared as a PDF, but the bytes are a PNG.
      { name: 'file', filename: 'x.pdf', type: 'application/pdf', data: PNG },
    ]) {
      const result = await upload(multipart([part]))
      expect(result.status).toBe(415)
      expect(result.payload.error).toBe('FILE_TYPE_NOT_ALLOWED')
      expect(result.upstream).toEqual([])
    }
  })

  it('caps each file and the count, whatever limits the request states', async () => {
    const upload = bootRoute(null)
    const tooBig = Buffer.concat([PNG, Buffer.alloc(VISITOR_MAX_FILE_BYTES)])
    const big = await upload(
      multipart([
        { name: 'file', filename: 'big.png', type: 'image/png', data: tooBig },
        { name: 'maxFileSize', data: String(1024 * 1024 * 1024) },
      ])
    )
    expect(big.status).toBe(413)
    expect(big.upstream).toEqual([])

    const many = await upload(
      multipart(
        Array.from({ length: VISITOR_MAX_FILES + 1 }, (_value, index) => ({
          name: 'file',
          filename: index + '.png',
          type: 'image/png',
          data: PNG,
        }))
      )
    )
    expect(many.status).toBe(413)
    expect(many.upstream).toEqual([])
  })

  it('refuses a request whose declared size is over the cap before reading it', async () => {
    const upload = bootRoute(null)
    const result = await upload(multipart([{ name: 'file', filename: 'a.png', data: PNG }]), {
      'content-length': String(VISITOR_MAX_FILES * VISITOR_MAX_FILE_BYTES * 2),
    })
    expect(result.status).toBe(413)
    expect(result.upstream).toEqual([])
  })

  it('never stores a private file for a visitor', async () => {
    const upload = bootRoute({ role: 'user' })
    const result = await upload(
      multipart([
        { name: 'file', filename: 'a.pdf', type: 'application/pdf', data: PDF },
        { name: 'private', data: 'true' },
      ])
    )
    expect(result.status).toBe(403)
    expect(result.upstream).toEqual([])
  })

  it('refuses a body that is not a file form', async () => {
    const upload = bootRoute(null)
    const result = await upload(Buffer.from('{"file":"x"}'), { 'content-type': 'application/json' })
    expect(result.status).toBe(400)
    expect(result.upstream).toEqual([])
  })
})

describe("/api/runtime-storage/upload — the store's own uploads", () => {
  const PRIVATE_ZIP = multipart([
    { name: 'file', filename: 'course.zip', type: 'application/zip', data: 'PK..zip' },
    { name: 'private', data: 'true' },
  ])

  it("streams an admin's upload through untouched — any type, private included", async () => {
    const upload = bootRoute({ role: 'admin' })
    const result = await upload(PRIVATE_ZIP)
    expect(result.status).toBe(200)
    expect(result.upstream).toHaveLength(1)
    // The request stream itself, not a buffered copy.
    expect(Buffer.isBuffer(result.upstream[0].body)).toBe(false)
  })

  it('serves server code presenting the app secret (the invoice PDF upload)', async () => {
    const upload = bootRoute(null)
    const result = await upload(PRIVATE_ZIP, { 'x-internal-data-secret': SECRET })
    expect(result.status).toBe(200)
    expect(result.upstream).toHaveLength(1)

    const forged = await upload(PRIVATE_ZIP, { 'x-internal-data-secret': 'guess' })
    expect(forged.status).toBe(415)
    expect(forged.upstream).toEqual([])
  })
})
