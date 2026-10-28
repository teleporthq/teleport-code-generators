import * as nodeCrypto from 'crypto'
import { EventEmitter } from 'events'
import * as net from 'net'
import { Readable } from 'stream'
import * as zlib from 'zlib'
import { generateSecurityRuntimeCode, securityRuntimeSpecifier } from '../src/security-runtime'
import { generateSharedRuntimeUtilsCode } from '../src/executor-generator'
import {
  SEGMENT_PUBLIC_ERROR,
  generateServerSegmentAPIRoute,
  generateWebhookWorkflowAPIRoute,
} from '../src/api-route-generator'
import { buildSegmentTrust, SegmentTrust } from '../src/segment-trust'
import { collectMessageTrust } from '../src/nodes/email/message-trust'
import * as fs from 'fs'
import * as path from 'path'
import { utilitySimilarityScoring } from '../src/nodes/utility/utility-similarity-scoring'
import { loadServerRuntime } from './_helpers/load-server-runtime'
import { generateFillTemplateFn } from '../src/transactional-email-code'
import { resolveHandlerEntryName } from '../src/nodes/types'
import { generalHttpRequest } from '../src/nodes/general/general-http-request'
import { generalRateLimiter } from '../src/nodes/general/general-rate-limiter'
import { emailResend } from '../src/nodes/email/email-resend'
import { smsTwilio } from '../src/nodes/sms/sms-twilio'
import {
  markVisitorBoundMessageNodes,
  TOO_MANY_MESSAGES_MESSAGE,
  MESSAGE_NOT_SENT_MESSAGE,
} from '../src/nodes/email/outbound-message-guard'
import {
  AI_LIMIT_REACHED_MESSAGE,
  AI_PROMPT_TOO_LONG_MESSAGE,
  AI_SITE_CALLS_PER_DAY,
  AI_NOT_CONFIGURED_MESSAGE,
  AI_REFUSED_MESSAGE,
  AI_UNAVAILABLE_MESSAGE,
  generateAIProviderUtils,
  generateAIStreamingProviderUtils,
} from '../src/nodes/ai/ai-provider-utils'
import { aiCustomPrompt } from '../src/nodes/ai/ai-custom-prompt'
import { aiGenerateTextEmbedding } from '../src/nodes/ai/ai-generate-text-embedding'
import type { WorkflowSegment } from '../src/types'

/**
 * The workflow nodes that reach outside the site or spend the owner's money,
 * EXECUTED from the source they emit: the HTTP request node (SSRF), email and
 * SMS (visitor-supplied recipients, escaping, header line breaks), the AI
 * provider call (per-site daily ceiling, prompt cap) and the rate limiter
 * (on the shared durable limiter).
 */

const SEGMENT_ROUTE_RUNTIME = securityRuntimeSpecifier('../../..')

const noop = (): void => undefined

const trust = (signedNodeIds: string[]): SegmentTrust =>
  ({
    signedNodeIds,
    branchGates: [],
    loopBodies: {},
    previousFrom: null,
  } as unknown as SegmentTrust)

/** One app instance's `utils/security-runtime.js`, with no database: it counts in memory. */
const loadSecurityRuntime = (): any => {
  const module = { exports: {} as any }
  const quiet = { warn: noop, error: noop, log: noop }
  const requireShim = (id: string): unknown => {
    if (id === 'crypto') {
      return nodeCrypto
    }
    if (id === 'net') {
      return net
    }
    throw new Error("Cannot find module '" + id + "'")
  }
  // eslint-disable-next-line no-new-func
  new Function(
    'module',
    'exports',
    'require',
    'process',
    'console',
    'Buffer',
    'Date',
    generateSecurityRuntimeCode()
  )(module, module.exports, requireShim, { env: {} }, quiet, Buffer, Date)
  return module.exports
}

/** A handler source evaluated the way a route inlines it, with `require` answered by `modules`. */
const loadHandler = (source: string, nodeType: string, modules: Record<string, unknown>): any => {
  const entry = resolveHandlerEntryName(source.trim(), nodeType)
  const requireShim = (id: string): unknown => {
    if (id in modules) {
      return modules[id]
    }
    throw new Error("Cannot find module '" + id + "'")
  }
  const quiet = { warn: noop, error: noop, log: noop }
  // eslint-disable-next-line no-new-func
  return new Function('require', 'console', `${source}\nreturn ${entry};`)(requireShim, quiet)
}

const wfCtx = (nodeId: string, refPath: string[]) => ({
  type: 'workflowContext',
  nodeId,
  path: [nodeId, ...refPath],
})

// ---------------------------------------------------------------------------
// general-http-request
// ---------------------------------------------------------------------------

interface Route {
  status: number
  headers?: Record<string, string>
  body?: string
  /** Bytes sent as they are (a compressed body). */
  raw?: Buffer
  /** The server never answers. */
  hang?: boolean
}

/**
 * A network the handler can only reach through `dns` and `http(s)`: a name
 * resolves through `dnsTable`, and a connection (to the address the handler's
 * own lookup returned) answers from `routes`. Every connection is recorded.
 */
const fakeNetwork = (dnsTable: Record<string, string[]>, routes: Record<string, Route>) => {
  const connections: Array<{ url: string; address: string }> = []
  const lookups: string[] = []
  const dns = {
    lookup(hostname: string, options: any, callback: any) {
      lookups.push(hostname)
      const addresses = dnsTable[hostname]
      if (!addresses) {
        callback(
          Object.assign(new Error('getaddrinfo ENOTFOUND ' + hostname), { code: 'ENOTFOUND' })
        )
        return
      }
      const list = addresses.map((address) => ({ address, family: net.isIP(address) }))
      if (options && options.all) {
        callback(null, list)
      } else {
        callback(null, list[0].address, list[0].family)
      }
    },
  }
  const transport = (protocol: string) => ({
    request(options: any, onResponse: any) {
      const req: any = new EventEmitter()
      req.write = () => true
      req.destroy = noop
      req.end = () => {
        const url = protocol + '//' + options.hostname + options.path
        const connect = (address: string) => {
          connections.push({ url, address })
          const route = routes[url]
          if (!route) {
            req.emit('error', new Error('connect ECONNREFUSED ' + address))
            return
          }
          if (route.hang) {
            return
          }
          const res: any = Readable.from(
            route.raw ? [route.raw] : route.body ? [Buffer.from(route.body)] : []
          )
          res.statusCode = route.status
          res.statusMessage = route.status === 200 ? 'OK' : 'Found'
          res.headers = route.headers || {}
          onResponse(res)
        }
        if (net.isIP(options.hostname)) {
          setImmediate(() => connect(options.hostname))
          return
        }
        // What net.connect does with a `lookup` option: the socket goes to
        // the address the lookup returns.
        options.lookup(options.hostname, { all: true }, (err: any, list: any) => {
          if (err) {
            req.emit('error', err)
            return
          }
          connect(list[0].address)
        })
      }
      return req
    },
  })
  const handler = loadHandler(generalHttpRequest.generateHandler(), 'general-http-request', {
    net,
    dns,
    http: transport('http:'),
    https: transport('https:'),
    zlib,
  })
  return { handler, connections, lookups }
}

describe('general-http-request connects only to public addresses', () => {
  const PUBLIC_IP = '93.184.216.34'

  it.each([
    ['loopback', 'http://127.0.0.1:3000/api/data/users'],
    ['the cloud metadata service', 'http://169.254.169.254/latest/meta-data/iam/'],
    ['IPv6 loopback', 'http://[::1]/'],
    ['an IPv4-mapped loopback', 'http://[::ffff:127.0.0.1]/'],
    ['a decimal-encoded loopback', 'http://2130706433/'],
    ['a private network', 'http://10.1.2.3/'],
    ['localhost', 'http://localhost:3000/'],
    ['a metadata name', 'http://metadata.google.internal/computeMetadata/v1/'],
    ['a non-http scheme', 'file:///etc/passwd'],
    ['a unique-local IPv6 address', 'http://[fd00::1]/'],
    ['a link-local IPv6 address', 'http://[fe80::1]/'],
    ['an IPv6 multicast address', 'http://[ff02::1]/'],
    ['an SIIT-mapped loopback', 'http://[::ffff:0:7f00:1]/'],
  ])('refuses %s before connecting', async (_label, url) => {
    const { handler, connections } = fakeNetwork({ localhost: ['127.0.0.1'] }, {})
    const result = await handler({ url, method: 'GET' }, {})
    expect(result).toMatchObject({ status: 0, body: null, error: 'The request URL is not allowed' })
    expect(connections).toEqual([])
  })

  it('refuses a name that resolves to a private address', async () => {
    const { handler, connections, lookups } = fakeNetwork(
      { 'intranet.example.com': ['10.0.0.12'] },
      { 'http://intranet.example.com/admin': { status: 200, body: 'secret' } }
    )
    const result = await handler({ url: 'http://intranet.example.com/admin' }, {})
    expect(result.error).toBe('The request URL is not allowed')
    expect(lookups).toEqual(['intranet.example.com'])
    expect(connections).toEqual([])
  })

  it('refuses a name with any private address among its records', async () => {
    const { handler, connections } = fakeNetwork(
      { 'mixed.example.com': [PUBLIC_IP, '192.168.1.1'] },
      { 'http://mixed.example.com/': { status: 200, body: 'x' } }
    )
    const result = await handler({ url: 'http://mixed.example.com/' }, {})
    expect(result.error).toBe('The request URL is not allowed')
    expect(connections).toEqual([])
  })

  it('refuses a public URL that redirects to a private one', async () => {
    const { handler, connections } = fakeNetwork(
      { 'api.example.com': [PUBLIC_IP] },
      {
        'https://api.example.com/start': {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        },
        'http://169.254.169.254/latest/meta-data/': { status: 200, body: 'credentials' },
      }
    )
    const result = await handler({ url: 'https://api.example.com/start' }, {})
    expect(result.error).toBe('The request URL is not allowed')
    expect(connections.map((c) => c.url)).toEqual(['https://api.example.com/start'])
  })

  it('refuses a redirect to a name that resolves to a private address', async () => {
    const { handler, connections } = fakeNetwork(
      { 'api.example.com': [PUBLIC_IP], 'internal-db.example.com': ['172.20.0.5'] },
      {
        'https://api.example.com/start': {
          status: 307,
          headers: { location: 'https://internal-db.example.com/' },
        },
      }
    )
    const result = await handler({ url: 'https://api.example.com/start' }, {})
    expect(result.error).toBe('The request URL is not allowed')
    expect(connections).toHaveLength(1)
  })

  it('follows a redirect to another public host and returns its JSON body', async () => {
    const { handler, connections } = fakeNetwork(
      { 'api.example.com': [PUBLIC_IP], 'cdn.example.net': ['151.101.1.1'] },
      {
        'https://api.example.com/v1/items?page=2': {
          status: 301,
          headers: { location: 'https://cdn.example.net/v1/items?page=2' },
        },
        'https://cdn.example.net/v1/items?page=2': {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: '{"items":[1,2]}',
        },
      }
    )
    const result = await handler(
      {
        url: 'https://api.example.com/v1/items',
        queryParams: [{ key: 'page', value: '2' }],
      },
      {}
    )
    expect(result).toEqual({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: { items: [1, 2] },
    })
    expect(connections.map((c) => c.address)).toEqual([PUBLIC_IP, '151.101.1.1'])
  })

  it('stops after 3 redirects', async () => {
    const routes: Record<string, Route> = {}
    for (let i = 0; i < 5; i++) {
      routes['https://api.example.com/' + i] = {
        status: 302,
        headers: { location: '/' + (i + 1) },
      }
    }
    const { handler, connections } = fakeNetwork({ 'api.example.com': [PUBLIC_IP] }, routes)
    const result = await handler({ url: 'https://api.example.com/0' }, {})
    expect(result.statusText).toBe('Too Many Redirects')
    expect(connections).toHaveLength(4)
  })

  it('refuses a response larger than 2 MB', async () => {
    const { handler } = fakeNetwork(
      { 'files.example.com': [PUBLIC_IP] },
      { 'https://files.example.com/big': { status: 200, body: 'x'.repeat(2 * 1024 * 1024 + 1) } }
    )
    const result = await handler({ url: 'https://files.example.com/big' }, {})
    expect(result).toMatchObject({ status: 0, error: 'The response is larger than 2 MB' })
  })

  it('refuses a compressed response that inflates past 2 MB', async () => {
    const { handler } = fakeNetwork(
      { 'files.example.com': [PUBLIC_IP] },
      {
        'https://files.example.com/bomb': {
          status: 200,
          headers: { 'content-encoding': 'gzip' },
          raw: zlib.gzipSync(Buffer.alloc(50 * 1024 * 1024)),
        },
      }
    )
    const result = await handler({ url: 'https://files.example.com/bomb' }, {})
    expect(result).toMatchObject({ status: 0, error: 'The response is larger than 2 MB' })
  })

  it('refuses names that resolve to IPv6 unique-local or link-local addresses', async () => {
    const { handler, connections } = fakeNetwork(
      { 'ula.example.com': ['fd12:3456::5'], 'll.example.com': ['fe80::2'] },
      {}
    )
    expect((await handler({ url: 'http://ula.example.com/' }, {})).error).toBe(
      'The request URL is not allowed'
    )
    expect((await handler({ url: 'http://ll.example.com/' }, {})).error).toBe(
      'The request URL is not allowed'
    )
    expect(connections).toEqual([])
  })

  it('gives up when the server does not answer in time', async () => {
    const { handler } = fakeNetwork(
      { 'slow.example.com': [PUBLIC_IP] },
      { 'https://slow.example.com/': { status: 200, hang: true } }
    )
    const result = await handler({ url: 'https://slow.example.com/', timeout: 50 }, {})
    expect(result).toMatchObject({ status: 0, statusText: 'Request Timeout' })
  })
})

// ---------------------------------------------------------------------------
// Email bodies and subjects: values escaped where the template is filled
// ---------------------------------------------------------------------------

const loadResolveConfig = (): ((config: any, context: any) => any) => {
  const module = { exports: {} as any }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'process', generateSharedRuntimeUtilsCode())(
    module,
    module.exports,
    () => ({}),
    { env: {} }
  )
  return module.exports.resolveConfig
}

describe('email templates keep the author HTML and escape every value', () => {
  const resolveConfig = loadResolveConfig()
  const context = {
    form: {
      name: '<a href="https://evil.example">Verify your account</a>',
      topic: 'Hello\r\nBcc: everyone@example.com',
    },
  }

  it('escapes a visitor value in the body and keeps the template markup', () => {
    const resolved = resolveConfig(
      {
        to: 'owner@shop.example',
        subject: 'New message: {{topic}}',
        body: '<p>From <strong>{{name}}</strong></p><a href="{{link}}">Open</a>',
        templateParams: [
          { key: 'name', value: wfCtx('form', ['name']) },
          { key: 'topic', value: wfCtx('form', ['topic']) },
          { key: 'link', value: 'https://shop.example/inbox?a=1&b=2' },
        ],
      },
      context
    )
    expect(resolved.body).toBe(
      '<p>From <strong>&lt;a href=&quot;https://evil.example&quot;&gt;Verify your account&lt;/a&gt;</strong></p>' +
        '<a href="https://shop.example/inbox?a=1&amp;b=2">Open</a>'
    )
    expect(resolved.subject).toBe('New message: Hello Bcc: everyone@example.com')
    expect(resolved.subject).not.toMatch(/[\r\n]/)
  })

  const chip =
    '<span class="context-value-inline" data-ctx-node-id="form" ' +
    'data-ctx-path=\'["form","name"]\'>Name</span>'

  it('escapes a rich-text placeholder value in a body (a text node: quotes stay)', () => {
    const resolved = resolveConfig({ body: '<p>Hi ' + chip + '</p>' }, context)
    expect(resolved.body).toBe(
      '<p>Hi &lt;a href="https://evil.example"&gt;Verify your account&lt;/a&gt;</p>'
    )
  })

  it('puts a placeholder value in a subject or an SMS message as text: no entities, no line breaks', () => {
    const resolved = resolveConfig(
      { subject: 'Hi ' + chip, message: 'Hi ' + chip },
      { form: { name: "O'Brien & Co\r\nBcc: list@example.com" } }
    )
    expect(resolved.subject).toBe("Hi O'Brien & Co Bcc: list@example.com")
    expect(resolved.message).toBe("Hi O'Brien & Co Bcc: list@example.com")
  })

  it('escapes once: an already escaped value, a tracking link and a visitor &lt; stay text', () => {
    const resolved = resolveConfig(
      {
        subject: 'Order from {{shop}}',
        body: '<p>{{shop}} / {{raw}}</p><a href="{{track}}">Track</a><p>{{note}}</p>',
        templateParams: [
          // What the lifecycle token scripts hand over: already escaped.
          { key: 'shop', value: 'Joe&#39;s Coffee &amp; Co' },
          { key: 'raw', value: "Joe's" },
          { key: 'track', value: 'https://track.example/?n=1Z9&amp;lang=en&x=1' },
          { key: 'note', value: '&lt;script>alert(1)</script>' },
        ],
      },
      {}
    )
    expect(resolved.body).toBe(
      '<p>Joe&#39;s Coffee &amp; Co / Joe&#39;s</p>' +
        '<a href="https://track.example/?n=1Z9&amp;lang=en&amp;x=1">Track</a>' +
        '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'
    )
    // A subject is text: an escaped value reads as its characters.
    expect(resolved.subject).toBe("Order from Joe's Coffee & Co")
  })

  it('fills the account emails the same way: body escaped, subject without line breaks', () => {
    // eslint-disable-next-line no-new-func
    const fill = new Function(
      `${generateFillTemplateFn()}\nreturn { fillTemplate: fillTemplate, fillSubjectTemplate: fillSubjectTemplate };`
    )()
    const values = { userName: '<img src=x onerror=alert(1)>\r\nX-Header: 1', siteName: 'Shop' }
    expect(fill.fillTemplate('<p>Hi {{userName}}, welcome to {{siteName}}</p>', values)).toBe(
      '<p>Hi &lt;img src=x onerror=alert(1)&gt;\r\nX-Header: 1, welcome to Shop</p>'
    )
    expect(fill.fillSubjectTemplate('Welcome {{userName}}', values)).toBe(
      'Welcome <img src=x onerror=alert(1)> X-Header: 1'
    )
  })

  describe('the products list of a platform email', () => {
    // The withdrawal / abandoned-cart fallback body: {{productsList}} must show
    // the list, not its markup as text.
    const body = '<div style="padding:16px;">{{productsList}}</div><p>Hi {{customerName}}</p>'
    const lines = [
      { product_name: '<img src=x onerror=alert(1)>Mug', quantity: '2' },
      { product_name: 'Tee', quantity: 1, configuration_label: 'Size <b>L</b>' },
    ]

    it('is built on the server from its lines, as HTML, with every field escaped', () => {
      const resolved = resolveConfig(
        {
          body,
          templateParams: [
            { key: 'products', value: wfCtx('assemble', ['selectedItems']) },
            // What the browser handed over is never used: it may be anything.
            { key: 'productsList', value: wfCtx('assemble', ['productsListHtml']) },
            { key: 'customerName', value: wfCtx('assemble', ['customerName']) },
          ],
        },
        {
          assemble: {
            selectedItems: lines,
            productsListHtml: '<a href="https://evil.example">Refund here</a>',
            customerName: 'Ann',
          },
        }
      )
      expect(resolved.body).toBe(
        '<div style="padding:16px;"><ul style="margin:0;padding-left:18px;">' +
          '<li>2× <strong>&lt;img src=x onerror=alert(1)&gt;Mug</strong></li>' +
          '<li>1× <strong>Tee</strong> — Size &lt;b&gt;L&lt;/b&gt;</li>' +
          '</ul></div><p>Hi Ann</p>'
      )
      expect(resolved.body).not.toContain('evil.example')
    })

    it('escapes a visitor value named productsList when the server built no list', () => {
      const resolved = resolveConfig(
        {
          body,
          templateParams: [
            { key: 'productsList', value: wfCtx('form', ['productsList']) },
            // A list-looking object from the request is not trusted either.
            { key: 'customerName', value: wfCtx('form', ['forged']) },
          ],
        },
        {
          form: {
            productsList: '<ul><li><a href="https://evil.example">x</a></li></ul>',
            forged: { __html: '<b>x</b>' },
          },
        }
      )
      expect(resolved.body).toBe(
        '<div style="padding:16px;">&lt;ul&gt;&lt;li&gt;&lt;a href=&quot;https://evil.example&quot;&gt;x&lt;/a&gt;&lt;/li&gt;&lt;/ul&gt;</div>' +
          '<p>Hi [object Object]</p>'
      )
    })
  })
})

// ---------------------------------------------------------------------------
// Email / SMS sends to visitor-supplied recipients
// ---------------------------------------------------------------------------

const loadEmailNode = (security: unknown, withRuntime = true) => {
  const sent: any[] = []
  class Resend {
    emails = {
      send: async (payload: any) => {
        sent.push(payload)
        return { data: { id: 'msg_' + sent.length } }
      },
    }
  }
  const source = withRuntime
    ? emailResend.generateServerHandler!({})
    : emailResend.generateHandler()
  const handler = loadHandler(source, 'email-resend', {
    resend: { Resend },
    [SEGMENT_ROUTE_RUNTIME]: security,
  })
  return { handler, sent }
}

const visitor = (remoteAddress: string, internal = false) => ({
  __request: { headers: {}, remoteAddress, internal },
})

describe('email nodes', () => {
  const autoReply = (to: string) => ({
    apiKey: 're_test',
    from: 'Shop <hello@shop.example>',
    to,
    subject: 'Thanks for your message',
    body: '<p>We got it.</p>',
    __visitorRecipientFields: ['to'],
  })

  it('takes line breaks out of every header field', async () => {
    const { handler, sent } = loadEmailNode(loadSecurityRuntime())
    const result = await handler(
      {
        apiKey: 're_test',
        from: 'hello@shop.example',
        to: 'owner@shop.example\r\nBcc: list@example.com',
        replyTo: 'visitor@example.com\nX-Injected: 1',
        subject: 'Order\r\n confirmed',
        body: '<p>Body\nkept</p>',
      },
      visitor('203.0.113.7')
    )
    expect(result.success).toBe(true)
    expect(sent[0].to).toEqual(['owner@shop.example Bcc: list@example.com'])
    expect(sent[0].replyTo).toBe('visitor@example.com X-Injected: 1')
    expect(sent[0].subject).toBe('Order  confirmed')
    expect(sent[0].html).toBe('<p>Body\nkept</p>')
  })

  it('sends a visitor-supplied recipient at most 3 times an hour', async () => {
    const { handler, sent } = loadEmailNode(loadSecurityRuntime())
    const results = []
    for (let i = 1; i <= 4; i++) {
      results.push(await handler(autoReply('Victim@Example.com'), visitor('198.51.100.' + i)))
    }
    expect(results.map((r) => r.success)).toEqual([true, true, true, undefined])
    // Skipped, not failed: the visitor's action goes on.
    expect(results[3]).toEqual({ id: '', skipped: true, reason: TOO_MANY_MESSAGES_MESSAGE })
    expect(sent).toHaveLength(3)
  })

  it('counts every address of a list against the recipient cap', async () => {
    const { handler, sent } = loadEmailNode(loadSecurityRuntime())
    for (let i = 1; i <= 3; i++) {
      await handler(autoReply('victim@example.com'), visitor('198.51.100.' + i))
    }
    const result = await handler(
      autoReply('fresh@example.com, VICTIM@example.com'),
      visitor('198.51.100.50')
    )
    expect(result.reason).toBe(TOO_MANY_MESSAGES_MESSAGE)
    expect(sent).toHaveLength(3)
  })

  it('lets one visitor send to at most 5 visitor-supplied addresses an hour', async () => {
    const { handler, sent } = loadEmailNode(loadSecurityRuntime())
    const results = []
    for (let i = 1; i <= 6; i++) {
      results.push(
        await handler(autoReply('person' + i + '@example.com'), visitor('2001:db8:1:2::' + i))
      )
    }
    // Every address in one /64 is one visitor.
    expect(results.map((r) => r.success)).toEqual([true, true, true, true, true, undefined])
    expect(sent).toHaveLength(5)
  })

  it('never limits a recipient the author fixed (a contact form to the owner)', async () => {
    const { handler, sent } = loadEmailNode(loadSecurityRuntime())
    for (let i = 0; i < 10; i++) {
      const result = await handler(
        { ...autoReply('owner@shop.example'), __visitorRecipientFields: undefined },
        visitor('198.51.100.9')
      )
      expect(result.success).toBe(true)
    }
    expect(sent).toHaveLength(10)
  })

  it("does not count this deployment's own server calls", async () => {
    const { handler, sent } = loadEmailNode(loadSecurityRuntime())
    for (let i = 0; i < 5; i++) {
      await handler(autoReply('buyer@example.com'), visitor('10.0.0.2', true))
    }
    expect(sent).toHaveLength(5)
  })

  it('sends a value body as text when it is marked', async () => {
    const { handler, sent } = loadEmailNode(loadSecurityRuntime())
    await handler(
      {
        ...autoReply('friend@example.com'),
        body: '<a href="https://evil.example">Claim your prize</a>',
        __escapeBody: true,
      },
      visitor('198.51.100.20')
    )
    expect(sent[0].html).toBe(
      '&lt;a href=&quot;https://evil.example&quot;&gt;Claim your prize&lt;/a&gt;'
    )
  })

  it('refuses a visitor-supplied recipient when the security runtime is missing', async () => {
    const { handler, sent } = loadEmailNode(null, false)
    const refused = await handler(autoReply('victim@example.com'), visitor('198.51.100.30'))
    expect(refused).toEqual({ id: '', success: false, error: MESSAGE_NOT_SENT_MESSAGE })
    const fixed = await handler(
      { ...autoReply('owner@shop.example'), __visitorRecipientFields: undefined },
      visitor('198.51.100.30')
    )
    expect(fixed.success).toBe(true)
    expect(sent).toHaveLength(1)
  })

  it('caps SMS to a visitor-supplied number the same way', async () => {
    const sent: any[] = []
    const twilio = () => ({
      messages: {
        create: async (payload: any) => {
          sent.push(payload)
          return { sid: 'SM' + sent.length, status: 'queued' }
        },
      },
    })
    const handler = loadHandler(smsTwilio.generateServerHandler!({}), 'sms-twilio', {
      twilio,
      [SEGMENT_ROUTE_RUNTIME]: loadSecurityRuntime(),
    })
    const config = {
      accountSid: 'AC1',
      authToken: 't',
      from: '+15550000000',
      to: '+1 (555) 123-4567',
      message: 'Your booking is confirmed',
      __visitorRecipientFields: ['to'],
    }
    const results = []
    for (let i = 1; i <= 4; i++) {
      results.push(await handler({ ...config }, visitor('198.51.100.' + i)))
    }
    expect(results.map((r) => r.success)).toEqual([true, true, true, undefined])
    expect(sent).toHaveLength(3)
  })
})

describe('which recipients the route marks as visitor-supplied', () => {
  const emailNode = (id: string, config: Record<string, unknown>) => ({
    id,
    type: 'email-resend',
    config,
  })
  const segment = (nodes: any[]): WorkflowSegment =>
    ({ id: 'seg', env: 'server', nodeIds: nodes.map((n) => n.id), nodes, edges: [] } as any)

  it('marks a recipient bound to a browser node, page state or a token', () => {
    const marked = markVisitorBoundMessageNodes(
      segment([
        emailNode('send', {
          to: wfCtx('extractForm', ['email']),
          cc: '{{state.copyTo}}',
          bcc: 'owner@shop.example',
        }),
      ]),
      trust([]),
      undefined
    )
    expect((marked.nodes[0].config as any).__visitorRecipientFields).toEqual(['to', 'cc'])
  })

  it("leaves a recipient read from the owner's settings unmarked, and the segment untouched", () => {
    const settings = { id: 'settings', type: 'ecommerce-get-settings', config: {} }
    const input = segment([
      settings,
      emailNode('send', { to: wfCtx('settings', ['notificationEmail']) }),
      emailNode('notify', { to: wfCtx('ownerPayload', ['recipients']), body: '<p>x</p>' }),
    ])
    const marked = markVisitorBoundMessageNodes(
      input,
      {
        ...trust([]),
        messageTrust: {
          ownerRecipientNodeIds: ['settings', 'ownerPayload'],
          trustedHtmlNodeIds: [],
        },
      } as SegmentTrust,
      undefined
    )
    expect(marked).toBe(input)
  })

  it('counts an address read from any other row (the visitor may just have written it)', () => {
    const marked = markVisitorBoundMessageNodes(
      segment([
        { id: 'lookup', type: 'data-select', config: { tableName: 'orders' } },
        emailNode('send', { to: wfCtx('lookup', ['rows', '0', 'email']), body: '<p>Thanks</p>' }),
      ]),
      undefined,
      undefined
    )
    expect((marked.nodes[1].config as any).__visitorRecipientFields).toEqual(['to'])
  })

  it('leaves a route only an admin or the server itself can call untouched', () => {
    const input = segment([emailNode('send', { to: wfCtx('extractForm', ['email']) })])
    expect(
      markVisitorBoundMessageNodes(input, undefined, {
        requiresAuth: true,
        allowedRoles: ['admin'],
        derivedFrom: 'page',
      })
    ).toBe(input)
    expect(
      markVisitorBoundMessageNodes(input, undefined, {
        requiresAuth: false,
        allowedRoles: [],
        serverOnly: true,
        derivedFrom: 'server-callers',
      })
    ).toBe(input)
    const anyUser = markVisitorBoundMessageNodes(input, undefined, {
      requiresAuth: true,
      allowedRoles: [],
      derivedFrom: 'page',
    })
    expect((anyUser.nodes[0].config as any).__visitorRecipientFields).toEqual(['to'])
  })

  it("never counts the signed-in user's own address, read from the session", () => {
    const session = {
      ...trust([]),
      session: { identityNodes: { me: 'account-get-current' }, identityReads: {} },
    } as unknown as SegmentTrust
    const ownAddress = segment([
      emailNode('token', { to: '{{Current User.email}}', body: '<p>Your receipt</p>' }),
      emailNode('reader', { to: wfCtx('me', ['email']) }),
      { id: 'text', type: 'sms-twilio', config: { to: '{{ currentUser.phone }}' } },
    ])
    expect(markVisitorBoundMessageNodes(ownAddress, session, undefined)).toBe(ownAddress)

    // Where the route binds no session the token is not the session's: counted.
    const unbound = markVisitorBoundMessageNodes(ownAddress, trust([]), undefined)
    expect(unbound.nodes.map((n) => (n.config as any).__visitorRecipientFields)).toEqual([
      ['to'],
      ['to'],
      ['to'],
    ])
    // A value the request supplies is still counted on a session-bound route.
    const fromRequest = markVisitorBoundMessageNodes(
      segment([
        emailNode('send', { to: wfCtx('extractForm', ['email']) }),
        emailNode('state', { to: '{{state.currentUser.email}}' }),
      ]),
      session,
      undefined
    )
    expect(fromRequest.nodes.map((n) => (n.config as any).__visitorRecipientFields)).toEqual([
      ['to'],
      ['to'],
    ])
  })

  it('marks a body that is a visitor value, not a template', () => {
    const marked = markVisitorBoundMessageNodes(
      segment([
        emailNode('send', { to: 'owner@shop.example', body: wfCtx('extractForm', ['message']) }),
      ]),
      undefined,
      undefined
    )
    expect(marked.nodes[0].config).toMatchObject({ __escapeBody: true })
    expect((marked.nodes[0].config as any).__visitorRecipientFields).toBeUndefined()
  })

  it('wires the mark and the visitor request into the generated segment route', () => {
    const route = generateServerSegmentAPIRoute(
      segment([emailNode('send', { to: wfCtx('extractForm', ['email']), body: '<p>Thanks</p>' })]),
      'Contact'
    )
    expect(route).toMatch(/"__visitorRecipientFields": \[\s*"to"\s*\]/)
    expect(route).toContain(
      "context.__request = { headers: req.headers || {}, remoteAddress: (req.socket && req.socket.remoteAddress) || '', internal: utils.isInternalCall(req) };"
    )
    expect(route).toContain(`require('${SEGMENT_ROUTE_RUNTIME}')`)
    expect(route).not.toContain('__getClientIp')

    const plain = generateServerSegmentAPIRoute(
      segment([{ id: 'read', type: 'data-select', config: { tableName: 'posts' } }]),
      'Read'
    )
    expect(plain).not.toContain('context.__request = ')
  })
})

// ---------------------------------------------------------------------------
// AI: per-site daily ceiling and prompt cap in __ai_callProvider
// ---------------------------------------------------------------------------

const fakeOpenAI = () => {
  const calls: any[] = []
  class OpenAI {
    chat = {
      completions: {
        create: async (opts: any) => {
          calls.push(opts)
          if (opts.stream) {
            return (async function* () {
              yield { choices: [{ delta: { content: 'hi' } }] }
            })()
          }
          return { choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 2 } }
        },
      },
    }
    embeddings = {
      create: async (opts: any) => {
        calls.push(opts)
        return { data: [{ embedding: [0.1, 0.2] }], model: opts.model, usage: {} }
      },
    }
  }
  return { module: { default: OpenAI }, calls }
}

const loadAIUtils = (security: unknown, relativePrefix: string | undefined = '../../..') => {
  const openai = fakeOpenAI()
  const source = generateAIStreamingProviderUtils(relativePrefix)
  const requireShim = (id: string): unknown => {
    if (id === 'openai') {
      return openai.module
    }
    if (id === SEGMENT_ROUTE_RUNTIME) {
      return security
    }
    throw new Error("Cannot find module '" + id + "'")
  }
  const quiet = { warn: noop, error: noop, log: noop }
  // eslint-disable-next-line no-new-func
  const utils = new Function(
    'require',
    'console',
    `${source}\nreturn { call: __ai_callProvider, stream: __ai_callProviderStreaming };`
  )(requireShim, quiet)
  return { ...utils, calls: openai.calls }
}

describe('AI calls share one per-site daily ceiling', () => {
  const params = (userMessage: string) => ({
    provider: 'openai',
    model: 'gpt-4o',
    token: 'sk-test',
    userMessage,
    temperature: 0.7,
    maxTokens: 50,
  })

  it(`refuses the call after ${AI_SITE_CALLS_PER_DAY} in a day, before the provider is reached`, async () => {
    const { call, stream, calls } = loadAIUtils(loadSecurityRuntime())
    for (let i = 0; i < AI_SITE_CALLS_PER_DAY; i++) {
      await call(params('question ' + i))
    }
    expect(calls).toHaveLength(AI_SITE_CALLS_PER_DAY)
    await expect(call(params('one more'))).rejects.toThrow(AI_LIMIT_REACHED_MESSAGE)
    // The streaming path counts against the same budget.
    await expect(stream(params('one more'), async (): Promise<void> => undefined)).rejects.toThrow(
      AI_LIMIT_REACHED_MESSAGE
    )
    expect(calls).toHaveLength(AI_SITE_CALLS_PER_DAY)
  })

  it('refuses a prompt over 8,000 characters without counting or sending it', async () => {
    const rateLimit = jest.fn(async () => ({ allowed: true, retryAfter: 0 }))
    const { call, calls } = loadAIUtils({ rateLimit })
    await expect(call(params('x'.repeat(8001)))).rejects.toThrow(AI_PROMPT_TOO_LONG_MESSAGE)
    expect(rateLimit).not.toHaveBeenCalled()
    await call(params('x'.repeat(8000)))
    expect(rateLimit).toHaveBeenCalledWith({
      key: 'site:ai-calls',
      limit: 2000,
      windowSeconds: 86400,
    })
    expect(calls).toHaveLength(1)
  })

  it('refuses every call where the security runtime is missing', async () => {
    const { call, calls } = loadAIUtils(null, undefined)
    await expect(call(params('hello'))).rejects.toThrow(AI_UNAVAILABLE_MESSAGE)
    expect(calls).toHaveLength(0)
    expect(generateAIProviderUtils()).not.toContain('security-runtime')
  })

  it('never lets a provider or secret detail leave the server', async () => {
    const logged: string[] = []
    const log = {
      warn: noop,
      error: (...args: unknown[]) => logged.push(args.join(' ')),
      log: noop,
    }
    class RefusingOpenAI {
      chat = {
        completions: {
          create: async () => {
            throw new Error('401 Incorrect API key provided: OPENAI_A***_KEY')
          },
        },
      }
    }
    const allowing = { rateLimit: async () => ({ allowed: true, retryAfter: 0 }) }
    const source = aiCustomPrompt.generateServerHandler!({})
    const requireShim = (id: string): unknown =>
      id === 'openai'
        ? { default: RefusingOpenAI }
        : id === SEGMENT_ROUTE_RUNTIME
        ? allowing
        : undefined
    // eslint-disable-next-line no-new-func
    const prompt = new Function(
      'require',
      'console',
      'process',
      `${source}\nreturn ${resolveHandlerEntryName(source, 'ai-custom-prompt')};`
    )(requireShim, log, { env: {} })

    // A token set to an env var's NAME is sent as the key, and the provider quotes it.
    const refused = await prompt({ prompt: 'Hi', token: 'OPENAI_API_KEY' }, {})
    expect(refused).toEqual({
      error: true,
      message: AI_REFUSED_MESSAGE,
      code: 'provider_error',
    })
    // A secret that is not set.
    const missing = await prompt({ prompt: 'Hi', token: 'teleporthq.secrets.SHOP_OPENAI_KEY' }, {})
    expect(missing).toEqual({
      error: true,
      message: AI_NOT_CONFIGURED_MESSAGE,
      code: 'authentication_error',
    })
    expect(JSON.stringify([refused, missing])).not.toMatch(/OPENAI|SHOP_OPENAI_KEY|401/)
    // The detail is in the server log.
    expect(logged.join('\n')).toContain('OPENAI_A***_KEY')
    expect(logged.join('\n')).toContain('SHOP_OPENAI_KEY')
  })

  it('answers a refused node with a clean error, and an optional embedding degrades', async () => {
    const refusing = { rateLimit: async () => ({ allowed: false, retryAfter: 3600 }) }
    const openai = fakeOpenAI()
    const prompt = loadHandler(aiCustomPrompt.generateServerHandler!({}), 'ai-custom-prompt', {
      openai: openai.module,
      [SEGMENT_ROUTE_RUNTIME]: refusing,
    })
    expect(await prompt({ prompt: 'Hi', token: 'sk-test' }, {})).toEqual({
      error: true,
      message: AI_LIMIT_REACHED_MESSAGE,
      // The module's own refusal keeps its code, so a workflow can branch on it.
      code: 'ai_limit_reached',
    })
    const embed = loadHandler(
      aiGenerateTextEmbedding.generateServerHandler!({}),
      'ai-generate-text-embedding',
      { openai: openai.module, [SEGMENT_ROUTE_RUNTIME]: refusing }
    )
    expect(await embed({ text: 'hello', token: 'sk-test', optional: true }, {})).toMatchObject({
      embedding: [],
      skipped: true,
      skipReason: AI_LIMIT_REACHED_MESSAGE,
    })
    expect(openai.calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// general-rate-limiter on the shared limiter
// ---------------------------------------------------------------------------

describe('visitor input is derived, not assumed', () => {
  const edge = (source: string, target: string) => ({ id: source + '>' + target, source, target })
  const node = (id: string, type: string, config: Record<string, unknown> = {}) =>
    ({ id, type, label: type, config } as any)

  // A custom-js step exactly as the editor exports it (examples/uidl-samples/
  // project.json): `label` is its type's, the builder's label travels in `name`
  // (in `builderLabel` once the owner renamed the step).
  const sample = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../../examples/uidl-samples/project.json'), 'utf8')
  )
  const sampleCustomJs = (() => {
    const all = [
      ...Object.values(sample.workflows.workflows || {}),
      ...Object.values(sample.workflows.customNodes || {}),
    ] as any[]
    for (const graph of all) {
      const found = (graph.nodes || []).find((n: any) => n.type === 'general-custom-js')
      if (found) {
        return found
      }
    }
    throw new Error('the sample export has no custom-js step')
  })()
  const exported = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    ...sampleCustomJs,
    id,
    name,
    config: { ...sampleCustomJs.config, context: 'server' },
    executionEnv: 'server',
    ...extra,
  })

  it('reads the export shape: the type label, the builder label in name', () => {
    expect(sampleCustomJs.label).toBe('Custom JavaScript')
    expect(typeof sampleCustomJs.name).toBe('string')
  })

  it('trusts owner-settings reads and the owner-notification builders, by name or builderLabel', () => {
    const nodes = [
      node('form', 'general-extract-form-data'),
      node('settings', 'ecommerce-get-settings'),
      node('customer', 'data-select', { tableName: 'orders' }),
      node('bookingSettings', 'data-select', { tableName: 'teleport_booking_settings' }),
      exported('payload', 'Build Order-Notification Email Payload'),
      exported('renamed', 'Tell me about stock', { builderLabel: 'Build Low-Stock Email Payload' }),
      exported('browserPayload', 'Build Order-Notification Email Payload'),
      exported('prepare', 'Prepare Email'),
    ]
    const trustSets = collectMessageTrust({
      nodes,
      edges: [edge('t', 'form'), edge('form', 'prepare'), edge('prepare', 'payload')],
      // The browser runs `browserPayload`: a builder label does not make it the server's.
      serverNodeIds: new Set([
        'settings',
        'customer',
        'bookingSettings',
        'payload',
        'renamed',
        'prepare',
      ]),
    })
    expect(trustSets.ownerRecipientNodeIds.sort()).toEqual([
      'bookingSettings',
      'payload',
      'renamed',
      'settings',
    ])
    expect(trustSets.trustedHtmlNodeIds.sort()).toEqual(['payload', 'renamed'])
  })

  it("trusts the booking alert recipients builder as an owner recipient, never as a body's HTML", () => {
    // The booking sender's notice to the business: a read of the settings row,
    // then the builder that turns its addresses into the list (with the
    // project owner's as the fallback) — after the visitor's booking was read.
    const trustSets = collectMessageTrust({
      nodes: [
        exported('tokens', 'Build Booking Email Tokens'),
        node('alertSettings', 'data-select', { tableName: 'teleport_booking_settings' }),
        exported('alertRecipients', 'Build Booking Alert Recipients'),
        exported('browserRecipients', 'Build Booking Alert Recipients'),
      ],
      edges: [edge('tokens', 'alertSettings'), edge('alertSettings', 'alertRecipients')],
      serverNodeIds: new Set(['tokens', 'alertSettings', 'alertRecipients']),
    })
    expect(trustSets.ownerRecipientNodeIds.sort()).toEqual(['alertRecipients', 'alertSettings'])
    expect(trustSets.trustedHtmlNodeIds).toEqual([])
  })

  it('trusts a server pass-through only when it has inputs and each is an owner read', () => {
    const trustSets = collectMessageTrust({
      nodes: [
        node('settings', 'ecommerce-get-settings'),
        node('when', 'general-if-statement'),
        node('shape', 'general-custom-js'),
        node('root', 'general-custom-js'),
      ],
      edges: [edge('settings', 'when'), edge('when', 'shape')],
      serverNodeIds: new Set(['settings', 'when', 'shape', 'root']),
    })
    // `root` has no inputs: it reads the caller's (a custom node's parameters).
    expect(trustSets.ownerRecipientNodeIds.sort()).toEqual(['settings', 'shape'])
  })

  it("counts a custom node's first step as the caller's: Prepare → email is capped and refused", () => {
    const prepare = exported('prepare', 'Prepare')
    const send = {
      id: 'send',
      type: 'email-resend',
      label: 'Send Email (Resend)',
      name: 'Email The Friend',
      config: { to: wfCtx('prepare', ['email']), body: wfCtx('prepare', ['body']) },
    } as any
    const serverSegment = {
      id: 'seg',
      env: 'server',
      nodeIds: ['prepare', 'send'],
      nodes: [prepare, send],
      edges: [edge('prepare', 'send')],
    } as any
    const graph = {
      id: 'cn',
      nodes: [prepare, send],
      edges: serverSegment.edges,
      segments: [serverSegment],
    } as any
    const segmentTrust = buildSegmentTrust(serverSegment, graph)
    expect(segmentTrust.messageTrust).toEqual({ ownerRecipientNodeIds: [], trustedHtmlNodeIds: [] })
    const warnings: string[] = []
    const saved = console.warn
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '))
    let marked
    try {
      marked = markVisitorBoundMessageNodes(serverSegment, segmentTrust, undefined, 'Share')
    } finally {
      console.warn = saved
    }
    expect((marked.nodes[1].config as any).__visitorRecipientFields).toEqual(['to'])
    expect((marked.nodes[1].config as any).__refuseSend).toBeTruthy()
    // The build log names the step, not only its type.
    expect(warnings[0]).toContain('"Email The Friend"')
  })

  it('counts a recipient laundered through a server step, from the graph the route is built with', () => {
    const nodes = [
      node('form', 'general-extract-form-data'),
      exported('prepare', 'Prepare Email'),
      node('send', 'email-resend', { to: wfCtx('prepare', ['email']), body: '<p>Thanks</p>' }),
    ]
    const serverSegment = {
      id: 'seg',
      env: 'server',
      nodeIds: ['prepare', 'send'],
      nodes: nodes.slice(1),
      edges: [edge('prepare', 'send')],
    } as any
    const graph = {
      id: 'wf',
      nodes,
      edges: [edge('form', 'prepare'), edge('prepare', 'send')],
      segments: [
        { id: 'client', env: 'client', nodeIds: ['form'], nodes: [nodes[0]], edges: [] },
        serverSegment,
      ],
    } as any
    const segmentTrust = buildSegmentTrust(serverSegment, graph)
    expect(segmentTrust.messageTrust!.ownerRecipientNodeIds).toEqual([])
    const marked = markVisitorBoundMessageNodes(serverSegment, segmentTrust, undefined)
    expect((marked.nodes[1].config as any).__visitorRecipientFields).toEqual(['to'])
  })

  it.each([
    [
      'the order notification',
      'Build Order-Notification Email Payload',
      'Send Order-Notification Email',
    ],
    ['the low-stock alert', 'Build Low-Stock Email Payload', 'Send Low-Stock Alert Email'],
  ])(
    'sends %s of a checkout, built in the export shape, to the owner as HTML',
    async (_what, builder, sendName) => {
      // The checkout's tail as the editor exports it: the browser's form, then
      // the server's payload builder (owner addresses baked, HTML from rows) and
      // the send step bound to its output.
      const payload = exported('payload', builder, {
        config: {
          context: 'server',
          code:
            'function customHandler(params) { return { recipients: ["owner@shop.example"], ' +
            'subject: "New order #1001", html: "<p>Order <b>#1001</b> &amp; more</p>" } }',
        },
      })
      const send = {
        id: 'send',
        type: 'email-resend',
        label: 'Send Email (Resend)',
        name: sendName,
        executionEnv: 'server',
        stepNumber: 3,
        config: {
          to: wfCtx('payload', ['recipients']),
          subject: wfCtx('payload', ['subject']),
          body: wfCtx('payload', ['html']),
          from: 'shop@shop.example',
          apiKey: 're_test',
          emailType: 'transactional',
        },
      } as any
      const form = {
        ...node('form', 'general-extract-form-data'),
        executionEnv: 'client',
        stepNumber: 1,
      }
      const serverSegment = {
        id: 'seg-tail',
        env: 'server',
        nodeIds: ['payload', 'send'],
        nodes: [{ ...payload, stepNumber: 2 }, send],
        edges: [edge('payload', 'send')],
        entryNodeIds: ['payload'],
      } as any
      const graph = {
        id: 'wf-checkout',
        nodes: [form, payload, send],
        edges: [edge('form', 'payload'), edge('payload', 'send')],
        segments: [
          { id: 'seg-form', env: 'client', nodeIds: ['form'], nodes: [form], edges: [] },
          serverSegment,
        ],
      } as any
      const route = generateServerSegmentAPIRoute(serverSegment, 'Place Order', undefined, {
        trust: buildSegmentTrust(serverSegment, graph),
      })
      expect(route).not.toContain('"__refuseSend":')
      expect(route).not.toContain('"__visitorRecipientFields":')
      expect(route).not.toContain('"__escapeBody":')

      const sent: any[] = []
      class Resend {
        emails = {
          send: async (message: any) => {
            sent.push(message)
            return { data: { id: 'msg_1' } }
          },
        }
      }
      const savedSecret = process.env.NEXTAUTH_SECRET
      process.env.NEXTAUTH_SECRET = 'checkout-tail-test-secret'
      try {
        const runtime = loadServerRuntime()
        const security = loadSecurityRuntime()
        const requireStub = (id: string): unknown => {
          if (id.endsWith('server-runtime')) {
            return runtime
          }
          if (id.endsWith('security-runtime')) {
            return security
          }
          if (id === 'resend') {
            return { Resend }
          }
          return {}
        }
        const module: { exports: any } = { exports: {} }
        // eslint-disable-next-line no-new-func
        new Function('module', 'exports', 'require', 'console', route)(
          module,
          module.exports,
          requireStub,
          {
            warn: noop,
            error: noop,
            log: noop,
          }
        )
        const reply = { status: 0, body: null as any }
        await module.exports(
          {
            method: 'POST',
            body: { context: { form: { name: 'Ann' } } },
            headers: { host: 'localhost:3000' },
            socket: { remoteAddress: '203.0.113.7' },
          },
          {
            setHeader: noop,
            status(code: number) {
              reply.status = code
              return this
            },
            json(answer: unknown) {
              reply.body = answer
              return this
            },
            end: noop,
          }
        )
        expect(reply.status).toBe(200)
        expect(sent).toHaveLength(1)
        expect(sent[0].to).toEqual(['owner@shop.example'])
        expect(sent[0].html).toBe('<p>Order <b>#1001</b> &amp; more</p>')
      } finally {
        if (savedSecret === undefined) {
          delete process.env.NEXTAUTH_SECRET
        } else {
          process.env.NEXTAUTH_SECRET = savedSecret
        }
      }
    }
  )
})

describe("a send whose whole message is the visitor's, to the visitor's address, never goes out", () => {
  const emailNode = (config: Record<string, unknown>) => ({
    id: 'send',
    type: 'email-resend',
    label: 'Send Message',
    config,
  })
  const one = (n: any): WorkflowSegment =>
    ({ id: 'seg', env: 'server', nodeIds: [n.id], nodes: [n], edges: [] } as any)

  const markQuietly = (n: any) => {
    const warnings: string[] = []
    const saved = console.warn
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '))
    try {
      return {
        marked: markVisitorBoundMessageNodes(one(n), undefined, undefined, 'Contact'),
        warnings,
      }
    } finally {
      console.warn = saved
    }
  }

  it('refuses it when the site is generated, says why in the build log, and the guard never sends', async () => {
    const { marked, warnings } = markQuietly(
      emailNode({ to: wfCtx('form', ['email']), body: wfCtx('form', ['message']) })
    )
    const config = marked.nodes[0].config as any
    expect(config.__refuseSend).toMatch(/only the visitor's input/)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Workflow "Contact"')
    expect(warnings[0]).toContain('"Send Message"')

    const { handler, sent } = loadEmailNode(loadSecurityRuntime())
    const result = await handler(
      { apiKey: 're', from: 'shop@example.com', to: 'x@example.com', body: 'spam', ...config },
      visitor('198.51.100.40')
    )
    expect(result).toEqual({ id: '', success: false, error: MESSAGE_NOT_SENT_MESSAGE })
    expect(sent).toHaveLength(0)
  })

  it("allows the author's template with the visitor's values in it", () => {
    const { marked, warnings } = markQuietly(
      emailNode({
        to: wfCtx('form', ['email']),
        body: '<p>Thanks {{name}}, we got your message.</p>',
        templateParams: [{ key: 'name', value: wfCtx('form', ['name']) }],
      })
    )
    const config = marked.nodes[0].config as any
    expect(config.__refuseSend).toBeUndefined()
    expect(config.__visitorRecipientFields).toEqual(['to'])
    expect(warnings).toEqual([])
  })

  it('refuses a whole-token body that is a visitor templateParam, and a visitor sender', () => {
    const tokenBody = markQuietly(
      emailNode({
        to: wfCtx('form', ['email']),
        body: '{{message}}',
        templateParams: [{ key: 'message', value: wfCtx('form', ['message']) }],
      })
    )
    expect((tokenBody.marked.nodes[0].config as any).__refuseSend).toBeTruthy()
    const sender = markQuietly(
      emailNode({ to: 'owner@shop.example', from: wfCtx('form', ['email']), body: '<p>x</p>' })
    )
    expect((sender.marked.nodes[0].config as any).__refuseSend).toMatch(/takes its sender \(from\)/)
  })

  it("does the same for an SMS whose whole message is the visitor's", () => {
    const sms = (message: unknown) =>
      markQuietly({
        id: 'text',
        type: 'sms-twilio',
        label: 'Text',
        config: { to: wfCtx('form', ['phone']), message },
      })
    expect(
      (sms(wfCtx('form', ['message'])).marked.nodes[0].config as any).__refuseSend
    ).toBeTruthy()
    expect(
      (sms([wfCtx('form', ['message'])]).marked.nodes[0].config as any).__refuseSend
    ).toBeTruthy()
    const template = sms(['Your booking is confirmed, ', wfCtx('form', ['name'])])
    expect((template.marked.nodes[0].config as any).__refuseSend).toBeUndefined()
  })

  it("counts markup around one visitor value as the visitor's whole message", () => {
    const fromVisitor = { to: wfCtx('form', ['email']) }
    const chip =
      '<span class="context-value-inline" data-ctx-node-id="form" ' +
      'data-ctx-path=\'["form","message"]\'>Message</span>'
    const wrapped = [
      {
        ...fromVisitor,
        body: '<p>{{message}}</p>',
        templateParams: [{ key: 'message', value: wfCtx('form', ['message']) }],
      },
      { ...fromVisitor, body: '<div><p>' + chip + '</p><p>&nbsp;</p></div>' },
    ]
    for (const config of wrapped) {
      expect(
        (markQuietly(emailNode(config)).marked.nodes[0].config as any).__refuseSend
      ).toBeTruthy()
    }
    const authored = markQuietly(
      emailNode({ ...fromVisitor, body: '<p>You wrote: ' + chip + '</p>' })
    )
    expect((authored.marked.nodes[0].config as any).__refuseSend).toBeUndefined()
  })

  it('refuses a sender name or SMS sender the visitor supplies', () => {
    const name = markQuietly(
      emailNode({ to: 'owner@shop.example', fromName: wfCtx('form', ['name']), body: '<p>x</p>' })
    )
    expect((name.marked.nodes[0].config as any).__refuseSend).toMatch(
      /takes its sender \(fromName\)/
    )
    const smsSender = markQuietly({
      id: 'text',
      type: 'sms-twilio',
      label: 'Text',
      config: { to: '+15550000000', from: wfCtx('form', ['sender']), message: 'Hi' },
    })
    expect((smsSender.marked.nodes[0].config as any).__refuseSend).toMatch(
      /takes its sender \(from\)/
    )
  })

  it('escapes a whole-value body read from a row, but sends a platform HTML builder as it is', () => {
    const fromRow = markVisitorBoundMessageNodes(
      one(emailNode({ to: 'owner@shop.example', body: wfCtx('lookup', ['rows', 0, 'note']) })),
      undefined,
      undefined
    )
    expect((fromRow.nodes[0].config as any).__escapeBody).toBe(true)
    const fromBuilder = markVisitorBoundMessageNodes(
      one(emailNode({ to: 'owner@shop.example', body: wfCtx('payload', ['html']) })),
      {
        ...({} as SegmentTrust),
        messageTrust: { ownerRecipientNodeIds: ['payload'], trustedHtmlNodeIds: ['payload'] },
      } as SegmentTrust,
      undefined
    )
    expect((fromBuilder.nodes[0].config as any).__escapeBody).toBeUndefined()
  })
})

describe('a capped send is skipped, never aborts; webhooks count per recipient', () => {
  const capped = (extra: Record<string, unknown> = {}) => ({
    apiKey: 're',
    from: 'shop@example.com',
    subject: 's',
    body: '<p>b</p>',
    __visitorRecipientFields: ['to'],
    ...extra,
  })

  it('answers a skipped result the runtime does not treat as a failure', async () => {
    const { handler } = loadEmailNode(loadSecurityRuntime())
    let last: any
    for (let i = 0; i < 4; i++) {
      last = await handler(capped({ to: 'same@example.com' }), visitor('198.51.100.' + (90 + i)))
    }
    expect(last).toEqual({ id: '', skipped: true, reason: TOO_MANY_MESSAGES_MESSAGE })
    expect(loadServerRuntime().isFatalNodeResult(last)).toBeFalsy()
  })

  it('does not count a public webhook caller by its address', async () => {
    const { handler, sent } = loadEmailNode(loadSecurityRuntime())
    for (let i = 1; i <= 7; i++) {
      await handler(
        capped({ to: 'respondent' + i + '@example.com', __noIpCap: true }),
        visitor('203.0.113.50')
      )
    }
    // An integration on one address mails each respondent: 7 sends, no per-IP stop.
    expect(sent).toHaveLength(7)
  })

  it("counts a custom node's sends made for a public webhook, and exempts every other internal call", async () => {
    const { handler, sent } = loadEmailNode(loadSecurityRuntime())
    const internal = (publicCaller: boolean) => ({
      __request: {
        headers: publicCaller ? { 'x-teleport-public-caller': '1' } : {},
        remoteAddress: '10.0.0.2',
        internal: true,
      },
    })
    for (let i = 0; i < 4; i++) {
      await handler(capped({ to: 'cron@example.com' }), internal(false))
    }
    expect(sent).toHaveLength(4)
    const results = []
    for (let i = 0; i < 4; i++) {
      results.push(await handler(capped({ to: 'hooked@example.com' }), internal(true)))
    }
    expect(results.map((r) => r.success)).toEqual([true, true, true, undefined])
  })

  it('marks an unsigned webhook that calls a custom node as a public caller', () => {
    const route = generateWebhookWorkflowAPIRoute({
      id: 'wf-hook-cn',
      name: 'Inbound',
      trigger: { type: 'event-webhook-triggered', nodeId: 't', scope: 'global', config: {} },
      nodes: [
        {
          id: 'call',
          type: 'general-custom-node',
          config: { customNodeId: 'cn-mail' },
          stepNumber: 1,
          label: 'Custom Node',
        },
      ],
      edges: [{ id: 'e1', source: 't', target: 'call' }],
      webhookConfig: { httpMethod: 'POST', urlPath: 'inbound', verifySignature: false },
    } as any)
    expect(route).toContain("context.__internalHeaders['x-teleport-public-caller'] = '1';")
  })
})

describe('the recipient cap counts one mailbox or number however it is written', () => {
  it('folds case and +tags for email, and 00 / + / punctuation for phones', async () => {
    const { handler, sent } = loadEmailNode(loadSecurityRuntime())
    // Gmail also ignores dots in the mailbox name.
    const variants = [
      'Vic.Tim@Gmail.com',
      'victim+1@gmail.com',
      'v.i.c.t.i.m+news@googlemail.com',
      'victim+x@gmail.com',
    ]
    const results = []
    for (let i = 0; i < variants.length; i++) {
      results.push(
        await handler(
          {
            apiKey: 're',
            from: 'shop@example.com',
            to: variants[i],
            subject: 's',
            body: '<p>b</p>',
            __visitorRecipientFields: ['to'],
          },
          visitor('198.51.100.' + (60 + i))
        )
      )
    }
    expect(results.map((r) => r.success)).toEqual([true, true, true, undefined])
    expect(sent).toHaveLength(3)

    const texts: any[] = []
    const twilio = () => ({
      messages: {
        create: async (payload: any) => {
          texts.push(payload)
          return { sid: 'SM', status: 'queued' }
        },
      },
    })
    const sms = loadHandler(smsTwilio.generateServerHandler!({}), 'sms-twilio', {
      twilio,
      [SEGMENT_ROUTE_RUNTIME]: loadSecurityRuntime(),
    })
    const numbers = ['+1 (555) 123-4567', '15551234567', '0015551234567', '+1-555-123-4567']
    const smsResults = []
    for (let i = 0; i < numbers.length; i++) {
      smsResults.push(
        await sms(
          {
            accountSid: 'AC',
            authToken: 't',
            from: '+15550000000',
            to: numbers[i],
            message: 'Hi',
            __visitorRecipientFields: ['to'],
          },
          visitor('198.51.100.' + (70 + i))
        )
      )
    }
    expect(smsResults.map((r) => r.success)).toEqual([true, true, true, undefined])
  })
})

describe('a public webhook is marked like a page route; a signed one is not', () => {
  const webhook = (webhookConfig: Record<string, unknown>) =>
    ({
      id: 'wf-hook',
      name: 'Inbound',
      trigger: { type: 'event-webhook-triggered', nodeId: 't', scope: 'global', config: {} },
      nodes: [
        {
          id: 'reply',
          type: 'email-resend',
          config: { to: wfCtx('t', ['body', 'email']), subject: 'Thanks', body: '<p>Thanks</p>' },
          stepNumber: 1,
          label: 'Reply',
        },
      ],
      edges: [{ id: 'e1', source: 't', target: 'reply' }],
      webhookConfig: { httpMethod: 'POST', urlPath: 'inbound', ...webhookConfig },
    } as any)

  it("counts the payload's recipient and hands the nodes the request when nothing is verified", () => {
    const route = generateWebhookWorkflowAPIRoute(webhook({ verifySignature: false }))
    expect(route).toMatch(/"__visitorRecipientFields": \[\s*"to"\s*\]/)
    expect(route).toContain('context.__request = { headers: req.headers || {}, remoteAddress:')
  })

  it('trusts a payload a verified signature vouches for', () => {
    const route = generateWebhookWorkflowAPIRoute(
      webhook({
        verifySignature: true,
        signatureAlgorithm: 'hmac-sha256',
        signatureSecret: 'HOOK_SECRET',
      })
    )
    expect(route).not.toContain('"__visitorRecipientFields":')
    expect(route).not.toContain('context.__request = { headers: req.headers || {}, remoteAddress:')
  })

  it('treats a custom scheme (left to the workflow) as unverified', () => {
    const route = generateWebhookWorkflowAPIRoute(
      webhook({ verifySignature: true, signatureAlgorithm: 'custom' })
    )
    expect(route).toContain('"__visitorRecipientFields":')
  })
})

describe('the AI output budget of one call has a ceiling', () => {
  it('lowers a maxTokens above 4096 to it and logs why', async () => {
    const warnings: string[] = []
    const openai = fakeOpenAI()
    const source = generateAIStreamingProviderUtils('../../..')
    const requireShim = (id: string): unknown =>
      id === 'openai'
        ? openai.module
        : id === SEGMENT_ROUTE_RUNTIME
        ? { rateLimit: async () => ({ allowed: true, retryAfter: 0 }) }
        : undefined
    // eslint-disable-next-line no-new-func
    const call = new Function('require', 'console', `${source}\nreturn __ai_callProvider;`)(
      requireShim,
      {
        warn: (...args: unknown[]) => warnings.push(args.map(String).join(' ')),
        error: noop,
        log: noop,
      }
    )
    await call({
      provider: 'openai',
      model: 'gpt-4o',
      token: 'sk',
      userMessage: 'Hi',
      maxTokens: 100000,
    })
    expect(openai.calls[0].max_tokens).toBe(4096)
    expect(warnings.join('\n')).toContain('maxTokens 100000 is above the per-call ceiling of 4096')
    await call({
      provider: 'openai',
      model: 'gpt-4o',
      token: 'sk',
      userMessage: 'Hi',
      maxTokens: 300,
    })
    expect(openai.calls[1].max_tokens).toBe(300)
  })
})

describe('similarity-scoring embeddings count against the AI budget', () => {
  it('refuses the semantic score when the budget is spent, without calling the provider', async () => {
    const openai = fakeOpenAI()
    const score = loadHandler(
      utilitySimilarityScoring.generateServerHandler!({}),
      'utility-similarity-scoring',
      {
        openai: openai.module,
        [SEGMENT_ROUTE_RUNTIME]: { rateLimit: async () => ({ allowed: false, retryAfter: 60 }) },
      }
    )
    const result = await score(
      { text1: 'car', text2: 'auto', algorithm: 'semantic', token: 'sk-test' },
      {}
    )
    expect(result).toMatchObject({ score: 0, error: AI_LIMIT_REACHED_MESSAGE })
    expect(openai.calls).toHaveLength(0)
  })
})

describe('a segment route shows the AI refusals that name nothing secret', () => {
  const savedSecret = process.env.NEXTAUTH_SECRET
  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = 'outbound-nodes-test-secret'
  })
  afterAll(() => {
    if (savedSecret === undefined) {
      delete process.env.NEXTAUTH_SECRET
    } else {
      process.env.NEXTAUTH_SECRET = savedSecret
    }
  })

  const askSegment = {
    id: 'seg-ask',
    env: 'server',
    nodeIds: ['ask'],
    nodes: [
      {
        id: 'ask',
        type: 'ai-custom-prompt',
        config: { prompt: wfCtx('form', ['question']), token: 'sk-test', model: 'gpt-4o' },
        stepNumber: 1,
      },
    ],
    edges: [],
  } as unknown as WorkflowSegment

  const ask = async (question: string, aiAllowed: boolean, providerFails = false) => {
    const real = loadSecurityRuntime()
    const security = {
      ...real,
      rateLimit: async (o: { key: string }) =>
        o.key === 'site:ai-calls' ? { allowed: aiAllowed, retryAfter: 3600 } : real.rateLimit(o),
    }
    class OpenAI {
      chat = {
        completions: {
          create: async () => {
            if (providerFails) {
              throw new Error('401 Incorrect API key provided: sk-te**')
            }
            return { choices: [{ message: { content: 'ok' } }], usage: {} }
          },
        },
      }
    }
    const runtime = loadServerRuntime()
    const requireStub = (id: string): unknown => {
      if (id.endsWith('server-runtime')) {
        return runtime
      }
      if (id.endsWith('security-runtime')) {
        return security
      }
      if (id === 'openai') {
        return { default: OpenAI }
      }
      return {}
    }
    const route: { exports: any } = { exports: {} }
    // eslint-disable-next-line no-new-func
    new Function(
      'module',
      'exports',
      'require',
      'console',
      generateServerSegmentAPIRoute(askSegment, 'Ask')
    )(route, route.exports, requireStub, { warn: noop, error: noop, log: noop })
    const reply = { status: 0, body: null as any }
    const res = {
      setHeader: noop,
      status(code: number) {
        reply.status = code
        return this
      },
      json(payload: unknown) {
        reply.body = payload
        return this
      },
      end: noop,
    }
    await route.exports(
      {
        method: 'POST',
        body: { context: { form: { question } } },
        headers: { host: 'localhost:3000' },
        socket: { remoteAddress: '203.0.113.7' },
      },
      res
    )
    return reply
  }

  it('answers a spent daily budget with 429 and its own message', async () => {
    const reply = await ask('Hi', false)
    expect(reply.status).toBe(429)
    expect(reply.body).toMatchObject({ error: AI_LIMIT_REACHED_MESSAGE })
    expect(typeof reply.body.id).toBe('string')
  })

  it('answers a prompt over the cap with 400 and its own message', async () => {
    const reply = await ask('x'.repeat(8001), true)
    expect(reply.status).toBe(400)
    expect(reply.body).toMatchObject({ error: AI_PROMPT_TOO_LONG_MESSAGE })
  })

  it('keeps every other failure generic', async () => {
    const reply = await ask('Hi', true, true)
    expect(reply.status).toBe(500)
    expect(reply.body).toMatchObject({ error: SEGMENT_PUBLIC_ERROR })
    expect(JSON.stringify(reply.body)).not.toMatch(/Incorrect|sk-te|refused/)
  })
})

describe('general-rate-limiter counts in the shared limiter', () => {
  const loadLimiter = (security: unknown) =>
    loadHandler(generalRateLimiter.generateServerHandler!({}), 'general-rate-limiter', {
      [SEGMENT_ROUTE_RUNTIME]: security,
    })

  it('two instances of the route count together, not each in its own memory', async () => {
    const security = loadSecurityRuntime()
    const first = loadLimiter(security)
    const second = loadLimiter(security)
    const config = { strategy: 'ip', maxRequests: 2, windowMs: 60000, __nodeId: 'limit' }
    expect(await first(config, visitor('198.51.100.1'))).toEqual({ allowed: true })
    expect(await second(config, visitor('198.51.100.1'))).toEqual({ allowed: true })
    const refused = await first(config, visitor('198.51.100.1'))
    expect(refused.__earlyResponse.status).toBe(429)
    expect(refused.__earlyResponse.headers['Retry-After']).toMatch(/^\d+$/)
    // Another visitor has its own count.
    expect(await second(config, visitor('198.51.100.2'))).toEqual({ allowed: true })
  })

  it('ignores a forwarded address a visitor wrote and refuses without the runtime', async () => {
    const security = loadSecurityRuntime()
    const limiter = loadLimiter(security)
    const config = { strategy: 'ip', maxRequests: 1, windowMs: 60000, __nodeId: 'limit' }
    const spoofed = (hop: string) => ({
      __request: { headers: { 'x-forwarded-for': hop }, remoteAddress: '198.51.100.77' },
    })
    expect(await limiter(config, spoofed('1.1.1.1'))).toEqual({ allowed: true })
    expect((await limiter(config, spoofed('2.2.2.2'))).__earlyResponse.status).toBe(429)

    const without = loadLimiter(null)
    expect((await without(config, visitor('198.51.100.1'))).__earlyResponse.status).toBe(500)
  })

  it('keys a visitor exactly as the shared runtime does, an IPv4 address inside IPv6 included', async () => {
    const security = loadSecurityRuntime()
    const keyed: string[] = []
    const limiter = loadLimiter({
      ...security,
      rateLimit: async (options: { key: string }) => {
        keyed.push(JSON.parse(options.key)[3])
        return { allowed: true, retryAfter: 0 }
      },
    })
    const config = { strategy: 'ip', maxRequests: 100, windowMs: 60000, __nodeId: 'limit' }
    const addresses = [
      '198.51.100.7',
      // IPv4-mapped: the runtime reads it as the IPv4 visitor it is.
      '::ffff:198.51.100.7',
      '2001:db8:1:2::9',
      // An IPv4 tail fills the last two groups: the /64 is 2001:db8:0:5.
      '2001:db8::5:6:7:198.51.100.7',
    ]
    for (const address of addresses) {
      await limiter(config, visitor(address))
    }
    expect(keyed).toEqual([
      '198.51.100.7',
      '198.51.100.7',
      '2001:db8:1:2::/64',
      '2001:db8:0:5::/64',
    ])
    expect(keyed).toEqual(
      addresses.map((address) =>
        security.visitorKey(security.clientIp({ headers: {}, socket: { remoteAddress: address } }))
      )
    )
    await limiter(config, { __request: undefined })
    expect(keyed[keyed.length - 1]).toBe('unknown')
  })
})
