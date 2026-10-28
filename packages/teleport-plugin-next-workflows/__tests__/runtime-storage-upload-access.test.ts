/* tslint:disable:function-constructor */
import { Readable } from 'stream'
import {
  SITE_VISITOR_FILES_PER_DAY,
  UPLOAD_ACCESS_HEADER,
  VISITOR_MAX_FILE_BYTES,
  VISITOR_MAX_FILES,
  VISITOR_UPLOAD_LIMITS,
  VISITOR_UPLOAD_MB_PER_DAY,
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
  // The part's raw header lines, replacing the quoted disposition built from
  // name/filename (an unquoted or RFC 5987 filename, a folded header…).
  rawHeaders?: string[]
}

function multipart(parts: Part[], boundary = BOUNDARY): Buffer {
  const chunks: Buffer[] = []
  for (const part of parts) {
    const disposition =
      'Content-Disposition: form-data; name="' +
      part.name +
      '"' +
      (part.filename !== undefined ? '; filename="' + part.filename + '"' : '')
    const lines = part.rawHeaders || [
      disposition,
      ...(part.type ? ['Content-Type: ' + part.type] : []),
    ]
    const header = '--' + boundary + '\r\n' + lines.map((line) => line + '\r\n').join('') + '\r\n'
    chunks.push(Buffer.from(header), Buffer.from(part.data), Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from('--' + boundary + '--\r\n'))
  return Buffer.concat(chunks)
}

/** The parts of a form as the forwarded body spells them: raw header text + data. */
function forwardedParts(body: Buffer, contentType: string): Array<{ head: string; data: string }> {
  const boundary = /boundary=(.+)$/.exec(contentType)![1]
  return body
    .toString('latin1')
    .split('--' + boundary)
    .slice(1, -1)
    .map((chunk) => {
      const end = chunk.indexOf('\r\n\r\n')
      return { head: chunk.slice(2, end), data: chunk.slice(end + 4, -2) }
    })
}

interface Upstream {
  url: string
  headers: Record<string, string>
  body: unknown
}

interface LimitCall {
  scope?: string
  key?: string
  limit: number
  windowSeconds: number
}

function bootRoute(session: { role?: string } | null, refuseScope?: string) {
  const code = generateRuntimeStorageUploadRoute()
  const moduleObj: { exports: any } = { exports: {} }
  const limitCalls: LimitCall[] = []
  const security = {
    rateLimitRequest: async (_req: unknown, res: any, options: LimitCall) => {
      limitCalls.push(options)
      if (options.scope === refuseScope) {
        res.status(429).json({ error: 'Too many requests. Try again later.' })
        return false
      }
      return true
    },
    rateLimit: async (options: LimitCall) => {
      limitCalls.push(options)
      return { allowed: options.key !== refuseScope, retryAfter: 60 }
    },
  }
  const fakeRequire = (name: string): any => {
    if (name === '../../../utils/security-runtime') {
      return security
    }
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
    limitCalls.length = 0
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
      setHeader: (): void => undefined,
    }
    await handler(req, res)
    return { status, payload, upstream: upstream.slice(), limits: limitCalls.slice() }
  }
}

describe('/api/runtime-storage/upload — what a visitor may store', () => {
  it('forwards a visitor’s images and PDFs as the form it checked, marked as a visitor’s', async () => {
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
    const sent = result.upstream[0]
    expect(sent.url).toBe('https://storage.test/project/p1/upload')
    expect(sent.headers.Authorization).toBe('Bearer key')
    expect(sent.headers[UPLOAD_ACCESS_HEADER]).toBe('visitor')
    // Written afresh under a boundary of the route's own, one quoted
    // disposition per part, each file typed by its bytes.
    expect(sent.headers['content-type']).toMatch(
      /^multipart\/form-data; boundary=----tqupload[0-9a-f]{32}$/
    )
    const forwarded = sent.body as Buffer
    expect(sent.headers['content-length']).toBe(String(forwarded.length))
    expect(forwardedParts(forwarded, sent.headers['content-type'])).toEqual([
      {
        head: 'Content-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: image/png',
        data: PNG.toString('latin1'),
      },
      {
        head: 'Content-Disposition: form-data; name="file"; filename="photo.jpg"\r\nContent-Type: image/jpeg',
        data: JPEG.toString('latin1'),
      },
      {
        head: 'Content-Disposition: form-data; name="file"; filename="print.pdf"\r\nContent-Type: application/pdf',
        data: PDF.toString('latin1'),
      },
      { head: 'Content-Disposition: form-data; name="folder"', data: 'product-options' },
    ])
  })

  // A8-02: the storage worker's parser (busboy) takes an unquoted or an RFC
  // 5987 filename as a file. This route used to read only the quoted form, so
  // such a part passed as a plain field — no type check, no size cap — and
  // was stored as an HTML page or an SVG at a public URL.
  it('checks a file whose filename is unquoted or RFC 5987 like any other file', async () => {
    const upload = bootRoute(null)
    for (const disposition of [
      'Content-Disposition: form-data; name="file"; filename=x.html',
      'Content-Disposition: form-data; name=file; filename=x.html',
      'Content-Disposition: form-data; name="file"; filename*=UTF-8\'\'x.html',
      'Content-Disposition: form-data; name="file"; filename="x.png"; filename*=utf-8\'\'x.html',
    ]) {
      const result = await upload(
        multipart([
          { name: 'file', rawHeaders: [disposition, 'Content-Type: text/html'], data: HTML },
        ])
      )
      expect([disposition, result.status]).toEqual([disposition, 415])
      expect(result.upstream).toEqual([])
    }
  })

  it('takes an unquoted private flag for what it is', async () => {
    const upload = bootRoute(null)
    const result = await upload(
      multipart([
        { name: 'file', filename: 'a.png', type: 'image/png', data: PNG },
        {
          name: 'private',
          rawHeaders: ['Content-Disposition: form-data; name=private'],
          data: 'true',
        },
      ])
    )
    expect(result.status).toBe(403)
    expect(result.upstream).toEqual([])
  })

  it('refuses a part two parsers could read differently', async () => {
    const upload = bootRoute(null)
    for (const rawHeaders of [
      // Which disposition counts depends on the parser.
      [
        'Content-Disposition: form-data; name="note"',
        'Content-Disposition: form-data; name="file"; filename="x.html"',
      ],
      // A folded line continues the disposition for busboy.
      ['Content-Disposition: form-data; name="note"', ' ; filename="x.html"'],
      ['Content-Disposition: attachment; name="file"; filename="x.png"'],
      ['Content-Disposition: form-data; name="file"; filename="x.png'],
      ['Content-Type: text/html'],
    ]) {
      const result = await upload(multipart([{ name: 'x', rawHeaders, data: HTML }]))
      expect([rawHeaders, result.status]).toEqual([rawHeaders, 400])
      expect(result.upstream).toEqual([])
    }
  })

  it('forwards an unquoted filename it accepted, quoted and reduced to its base name', async () => {
    const upload = bootRoute(null)
    const result = await upload(
      multipart([
        {
          name: 'file',
          rawHeaders: [
            "Content-Disposition: form-data; name=file; filename*=UTF-8''..%2Fevil%22.png",
            'Content-Type: image/png',
          ],
          data: PNG,
        },
      ])
    )
    expect(result.status).toBe(200)
    const sent = result.upstream[0]
    expect(forwardedParts(sent.body as Buffer, sent.headers['content-type'])[0].head).toBe(
      'Content-Disposition: form-data; name="file"; filename="evil_.png"\r\nContent-Type: image/png'
    )
  })

  it('limits a visitor’s requests, its bytes per file, and the site’s visitor files', async () => {
    const upload = bootRoute(null)
    const threeMb = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 1)])
    const ok = await upload(
      multipart([
        { name: 'file', filename: 'a.png', type: 'image/png', data: PNG },
        { name: 'file', filename: 'b.png', type: 'image/png', data: threeMb },
      ])
    )
    expect(ok.status).toBe(200)
    const mb = {
      scope: 'runtime-storage-upload-mb',
      limit: VISITOR_UPLOAD_MB_PER_DAY,
      windowSeconds: 86400,
    }
    const siteFile = {
      key: 'site:visitor-uploads',
      limit: SITE_VISITOR_FILES_PER_DAY,
      windowSeconds: 86400,
    }
    expect(ok.limits).toEqual([
      ...VISITOR_UPLOAD_LIMITS.map(([limit, windowSeconds]) => ({
        scope: 'runtime-storage-upload',
        limit,
        windowSeconds,
      })),
      // A small file counts 1 MB, a file just over 2 MB counts 3.
      mb,
      mb,
      mb,
      mb,
      siteFile,
      siteFile,
    ])

    const overBudget = await bootRoute(
      null,
      'runtime-storage-upload-mb'
    )(multipart([{ name: 'file', filename: 'a.png', type: 'image/png', data: PNG }]))
    expect(overBudget.status).toBe(429)
    expect(overBudget.upstream).toEqual([])

    const perVisitor = await bootRoute(
      null,
      'runtime-storage-upload'
    )(multipart([{ name: 'file', filename: 'a.png', type: 'image/png', data: PNG }]))
    expect(perVisitor.status).toBe(429)
    expect(perVisitor.upstream).toEqual([])

    const perSite = await bootRoute(
      null,
      'site:visitor-uploads'
    )(multipart([{ name: 'file', filename: 'a.png', type: 'image/png', data: PNG }]))
    expect(perSite.status).toBe(429)
    expect(perSite.payload.error).toBe('UPLOAD_LIMIT_REACHED')
    expect(perSite.upstream).toEqual([])
  })

  it('counts nothing against the visitor’s bytes or the site for a form it refused', async () => {
    const refused = await bootRoute(null)(
      multipart([{ name: 'file', filename: 'x.html', type: 'text/html', data: HTML }])
    )
    expect(refused.status).toBe(415)
    expect(refused.limits.map((entry) => entry.scope || entry.key)).toEqual([
      'runtime-storage-upload',
      'runtime-storage-upload',
    ])
  })

  it('refuses every form of the private flag the storage worker reads', async () => {
    for (const flag of ['1', 'YES', ' yes ', 'True']) {
      const result = await bootRoute(null)(
        multipart([
          { name: 'file', filename: 'a.png', type: 'image/png', data: PNG },
          { name: 'private', data: flag },
        ])
      )
      expect([flag, result.status]).toEqual([flag, 403])
      expect(result.upstream).toEqual([])
    }
  })

  it('stores a file under the extension its bytes proved', async () => {
    for (const [given, stored] of [
      ['x.html', 'x.png'],
      ['x.png.html', 'x.png'],
      ['photo', 'photo.png'],
      ['shot.PNG', 'shot.PNG'],
    ]) {
      const result = await bootRoute(null)(
        multipart([{ name: 'file', filename: given, type: 'image/png', data: PNG }])
      )
      const sent = result.upstream[0]
      expect([
        given,
        forwardedParts(sent.body as Buffer, sent.headers['content-type'])[0].head,
      ]).toEqual([
        given,
        'Content-Disposition: form-data; name="file"; filename="' +
          stored +
          '"\r\nContent-Type: image/png',
      ])
    }
    const jpeg = await bootRoute(null)(
      multipart([{ name: 'file', filename: 'me.jpeg', type: 'image/jpeg', data: JPEG }])
    )
    const sentJpeg = jpeg.upstream[0]
    expect(
      forwardedParts(sentJpeg.body as Buffer, sentJpeg.headers['content-type'])[0].head
    ).toContain('filename="me.jpeg"')
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
    expect(result.upstream[0].headers[UPLOAD_ACCESS_HEADER]).toBe('trusted')
    expect(result.upstream[0].headers['content-type']).toBe(
      'multipart/form-data; boundary=' + BOUNDARY
    )
    // The store's own uploads are not counted against visitors.
    expect(result.limits).toEqual([])
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
