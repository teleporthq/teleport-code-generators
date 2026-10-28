/* tslint:disable:function-constructor */
import { createHash, createHmac } from 'crypto'
import {
  collectSiteRealtimeChannels,
  projectCallsRealtimeRoute,
  generateRealtimeChannelsMembersRoute,
  generateRealtimeEventRoute,
  generateRealtimeJoinRoute,
  generateRealtimeMessageRoute,
  generateRealtimeServerHelperCode,
  generateRealtimeTokenRoute,
  REALTIME_ANON_COOKIE,
  REALTIME_ANON_COOKIE_SECURE,
  REALTIME_IDENTITY_HEADER,
} from '../src/realtime-generator'
import { nodeRegistry } from '../src'
import { loadHandler } from './_helpers/load-handler'

const SECRET = 'secret'
// The session cookie a signed-in visitor's browser holds on http (getToken is stubbed).
const SESSION_COOKIE = 'next-auth.session-token=signed'
const signed = (key: string): string =>
  key +
  '.' +
  createHmac('sha256', SECRET)
    .update('teleport-realtime-anon:v1:' + key)
    .digest('hex')
const anonIdOf = (key: string): string =>
  'anon_' +
  createHash('sha256')
    .update('teleport-realtime-anon:' + key)
    .digest('hex')
    .slice(0, 32)

/**
 * The site's `/api/realtime/*` routes hold the project's realtime key. They
 * used to forward the browser's body — `userId`, `senderId`, `senderName` —
 * so any visitor published as anyone and took a token for any user (A5-H1,
 * A5-H2, A8-03). Executed here against the emitted helper and routes with a
 * fake worker: the identity is the route's (the session user, or an opaque id
 * from an httpOnly cookie), sent as the `x-realtime-identity` claim, and the
 * body can name nobody.
 */

const WORKFLOWS: any = {
  workflows: {
    chat: {
      trigger: { type: 'realtime-on-channel-message', config: { channelName: 'lobby' } },
      nodes: [
        { type: 'realtime-on-channel-message', config: { channelName: 'lobby' } },
        { type: 'realtime-join-channel', config: { channelName: 'joined-not-subscribed' } },
      ],
    },
    presence: {
      trigger: { type: 'realtime-on-user-joined-channel', config: { channelName: 'room.main' } },
      nodes: [],
    },
    bound: {
      trigger: {
        type: 'realtime-on-channel-event',
        config: { channelName: { type: 'workflowContext', nodeId: 'n', path: ['id'] } },
      },
      nodes: [],
    },
    invalid: {
      trigger: { type: 'realtime-on-channel-message', config: { channelName: 'bad:name' } },
      nodes: [],
    },
  },
}

interface Upstream {
  url: string
  method: string
  headers: Record<string, string>
  body: any
}

interface Limit {
  scope: string
  limit: number
  windowSeconds: number
}

function boot(
  options: { session?: Record<string, unknown> | null; refuse?: string; secret?: string } = {}
) {
  const upstream: Upstream[] = []
  const limits: Limit[] = []
  const security = {
    rateLimitRequest: async (_req: unknown, res: any, opts: Limit) => {
      limits.push(opts)
      if (options.refuse === opts.scope) {
        res.status(429).json({ error: 'Too many requests. Try again later.' })
        return false
      }
      return true
    },
    sendClientError: (res: any, status: number, message: string) => {
      res.status(status).json({ error: message, id: 'x' })
    },
    safeEqual: (a: string, b: string) => typeof a === 'string' && a.length > 0 && a === b,
  }
  const fakeFetch = async (url: string, init: any) => {
    upstream.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    })
    return { ok: true, status: 200, json: async () => ({ tokenRequest: { keyName: 'k' } }) }
  }
  const helper: { exports: any } = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    'process',
    'fetch',
    'Buffer',
    generateRealtimeServerHelperCode(WORKFLOWS)
  )(
    (name: string) => {
      if (name === 'crypto') {
        return require('crypto')
      }
      if (name === '../security-runtime') {
        return security
      }
      if (name === 'next-auth/jwt') {
        return { getToken: async () => options.session || null }
      }
      throw new Error('unexpected require: ' + name)
    },
    helper,
    helper.exports,
    {
      env: {
        NEXTAUTH_SECRET: options.secret === undefined ? SECRET : options.secret,
        REALTIME_SERVER_URL: 'https://rt.test',
        REALTIME_SERVER_API_KEY: 'project-key',
      },
    },
    fakeFetch,
    Buffer
  )

  const load = (code: string) => {
    const route: { exports: any } = { exports: {} }
    new Function('require', 'module', 'exports', code)(
      (name: string) => {
        if (/\/utils\/realtime\/server$/.test(name)) {
          return helper.exports
        }
        throw new Error('unexpected require: ' + name)
      },
      route,
      route.exports
    )
    return route.exports
  }

  const call = async (code: string, body: unknown, cookie?: string, https = false) => {
    upstream.length = 0
    limits.length = 0
    const headers: Record<string, unknown> = {}
    const res: any = {
      statusCode: 0,
      payload: undefined,
      status(statusCode: number) {
        res.statusCode = statusCode
        return res
      },
      json(value: unknown) {
        res.payload = value
        return res
      },
      setHeader(name: string, value: unknown) {
        headers[name.toLowerCase()] = value
      },
      getHeader(name: string) {
        return headers[name.toLowerCase()]
      },
    }
    const requestHeaders: Record<string, string> = https ? { 'x-forwarded-proto': 'https' } : {}
    if (cookie) {
      requestHeaders.cookie = cookie
    }
    await load(code)({ method: 'POST', body, headers: requestHeaders }, res)
    const identityHeader = upstream[0] && upstream[0].headers[REALTIME_IDENTITY_HEADER]
    return {
      status: res.statusCode,
      payload: res.payload,
      upstream: upstream.slice(),
      limits: limits.slice(),
      setCookie: headers['set-cookie'] as string[] | undefined,
      identity: identityHeader
        ? JSON.parse(Buffer.from(identityHeader, 'base64url').toString('utf8'))
        : undefined,
    }
  }
  return { call }
}

const cookieOf = (setCookie: string[] | undefined): string => {
  const first = (setCookie || [])[0] || ''
  return first.split(';')[0]
}

describe('/api/realtime/* — who the visitor is, decided by the route', () => {
  it('sends a message as the visitor, never as the sender the body names', async () => {
    const site = boot()
    const result = await site.call(generateRealtimeMessageRoute(), {
      channelName: 'lobby',
      message: 'hi',
      senderId: 'admin',
      senderName: 'Support team',
    })
    expect(result.status).toBe(200)
    expect(result.upstream).toHaveLength(1)
    expect(result.upstream[0].url).toBe('https://rt.test/api/realtime/channels/message')
    expect(result.upstream[0].headers.Authorization).toBe('Bearer project-key')
    expect(result.identity.id).toMatch(/^anon_[0-9a-f]{32}$/)
    expect(result.identity.name).toBe('Anonymous')
    // The old-shape fields carry the same identity, for a worker not yet updated.
    expect(result.upstream[0].body).toEqual({
      channelName: 'lobby',
      message: 'hi',
      userId: result.identity.id,
      userName: 'Anonymous',
      senderId: result.identity.id,
      senderName: 'Anonymous',
    })
  })

  it('gives an anonymous visitor an opaque id from a signed httpOnly cookie, the same on every call', async () => {
    const site = boot()
    const first = await site.call(generateRealtimeEventRoute(), {
      channelName: 'c',
      eventName: 'e',
    })
    const setCookie = (first.setCookie || [])[0]
    expect(setCookie).toMatch(
      new RegExp(
        '^' +
          REALTIME_ANON_COOKIE +
          '=[0-9a-f]{32}\\.[0-9a-f]{64}; Path=/api/realtime; HttpOnly; SameSite=Lax$'
      )
    )
    const cookie = cookieOf(first.setCookie)
    const key = cookie.split('=')[1].split('.')[0]
    expect(cookie.split('=')[1]).toBe(signed(key))
    // The id is a one-way hash of the key: knowing an id does not give the cookie.
    expect(first.identity.id).not.toContain(key)
    expect(first.identity.id).toBe(anonIdOf(key))

    const again = await site.call(
      generateRealtimeEventRoute(),
      { channelName: 'c', eventName: 'e' },
      cookie
    )
    expect(again.identity.id).toBe(first.identity.id)
    expect(again.setCookie).toBeUndefined()
  })

  it('replaces a cookie value it did not issue instead of adopting it', async () => {
    const site = boot()
    const planted = 'a'.repeat(32)
    for (const value of [planted, planted + '.' + 'b'.repeat(64), anonIdOf(planted)]) {
      const result = await site.call(
        generateRealtimeEventRoute(),
        { channelName: 'c', eventName: 'e' },
        REALTIME_ANON_COOKIE + '=' + value
      )
      expect(result.identity.id).not.toBe(anonIdOf(planted))
      expect(result.setCookie).toHaveLength(1)
    }
  })

  it('uses a __Host- cookie on https, and ignores the plain name a sibling site could set', async () => {
    const site = boot()
    const key = 'c'.repeat(32)
    // A sibling *.teleporthq.app site can set the plain name for the parent domain.
    const tossed = await site.call(
      generateRealtimeEventRoute(),
      { channelName: 'c', eventName: 'e' },
      REALTIME_ANON_COOKIE + '=' + signed(key),
      true
    )
    expect(tossed.identity.id).not.toBe(anonIdOf(key))
    expect((tossed.setCookie || [])[0]).toMatch(
      new RegExp(
        '^' +
          REALTIME_ANON_COOKIE_SECURE.replace('-', '\\-') +
          '=[0-9a-f]{32}\\.[0-9a-f]{64}; Path=/; Secure; HttpOnly; SameSite=Lax$'
      )
    )
    const own = await site.call(
      generateRealtimeEventRoute(),
      { channelName: 'c', eventName: 'e' },
      REALTIME_ANON_COOKIE_SECURE + '=' + signed(key),
      true
    )
    expect(own.identity.id).toBe(anonIdOf(key))
    expect(own.setCookie).toBeUndefined()
  })

  it('refuses an anonymous visitor when the app has no secret to sign the cookie with', async () => {
    const result = await boot({ secret: '' }).call(generateRealtimeEventRoute(), {
      channelName: 'c',
      eventName: 'e',
    })
    expect(result.status).toBe(502)
    expect(result.upstream).toEqual([])
    expect(result.setCookie).toBeUndefined()
  })

  it("takes a signed-in visitor's identity from the site's session", async () => {
    const site = boot({ session: { id: 'user-42', name: 'Ana' } })
    const result = await site.call(
      generateRealtimeTokenRoute(),
      { userId: 'victim' },
      SESSION_COOKIE
    )
    expect(result.identity).toEqual({ id: 'user-42', name: 'Ana' })
    expect(result.setCookie).toBeUndefined()
    // The body can name no user; the token is asked for the site's own channels.
    expect(result.upstream[0].body).toEqual({
      channels: ['lobby', 'room.main'],
      userId: 'user-42',
      userName: 'Ana',
      senderId: 'user-42',
      senderName: 'Ana',
    })
    // The browser learns who the server says it is.
    expect(result.payload.identity).toEqual({ id: 'user-42', name: 'Ana' })
  })

  it('maps a session id the worker cannot take as an id (an email) to an opaque one', async () => {
    const site = boot({ session: { sub: 'ana@example.com' } })
    const result = await site.call(generateRealtimeTokenRoute(), {}, SESSION_COOKIE)
    expect(result.identity.id).toMatch(/^u_[0-9a-f]{32}$/)
  })

  it('joins under the visitor’s identity and keeps the site channels in the new token', async () => {
    const site = boot()
    const result = await site.call(generateRealtimeJoinRoute(), {
      channelName: 'room-1',
      userId: 'victim',
      userName: 'Victim',
      userData: { seat: 3 },
    })
    expect(result.identity.id).toMatch(/^anon_/)
    expect(result.upstream[0].body).toEqual({
      channelName: 'room-1',
      userData: { seat: 3 },
      channels: ['lobby', 'room.main'],
      userId: result.identity.id,
      userName: 'Anonymous',
      senderId: result.identity.id,
      senderName: 'Anonymous',
    })
  })

  it('rate-limits every route per visitor, and a refused call never reaches the worker', async () => {
    const site = boot({ refuse: 'realtime-message' })
    const refused = await site.call(generateRealtimeMessageRoute(), {
      channelName: 'lobby',
      message: 'x',
    })
    expect(refused.status).toBe(429)
    expect(refused.upstream).toEqual([])

    const ok = await boot().call(generateRealtimeMessageRoute(), {
      channelName: 'lobby',
      message: 'x',
    })
    expect(ok.limits).toEqual([
      { scope: 'realtime-message', limit: 20, windowSeconds: 60 },
      { scope: 'realtime-message', limit: 300, windowSeconds: 86400 },
    ])
  })

  it('refuses a members lookup without a channel before calling the worker', async () => {
    const result = await boot().call(generateRealtimeChannelsMembersRoute(), {})
    expect(result.status).toBe(400)
    expect(result.upstream).toEqual([])
  })
})

describe('collectSiteRealtimeChannels', () => {
  it('takes the fixed channel names the realtime triggers subscribe to', () => {
    expect(collectSiteRealtimeChannels(WORKFLOWS)).toEqual(['lobby', 'room.main'])
    expect(collectSiteRealtimeChannels(undefined)).toEqual([])
  })
})

describe('projectCallsRealtimeRoute (the browser-facing message / event routes)', () => {
  const withNode = (config: unknown): any => ({
    workflows: {
      w: {
        trigger: { type: 'event-page-loaded', config: {} },
        nodes: [{ type: 'custom-js', config }],
      },
    },
  })

  it('is false for a project whose sends all run server-side', () => {
    expect(projectCallsRealtimeRoute(WORKFLOWS, 'message')).toBe(false)
    const sendsServerSide: any = {
      workflows: {
        w: {
          trigger: { type: 'event-element-clicked', config: {} },
          nodes: [
            {
              type: 'realtime-send-channel-message',
              config: { channelName: 'lobby', message: 'hi' },
            },
          ],
        },
      },
    }
    expect(projectCallsRealtimeRoute(sendsServerSide, 'message')).toBe(false)
  })

  it('is true only for the route a node names, in a workflow or a custom node', () => {
    expect(
      projectCallsRealtimeRoute(withNode({ code: "fetch('/api/realtime/message', o)" }), 'message')
    ).toBe(true)
    expect(
      projectCallsRealtimeRoute(withNode({ code: "fetch('/api/realtime/message', o)" }), 'event')
    ).toBe(false)
    expect(projectCallsRealtimeRoute(withNode({ url: '/api/realtime/messages' }), 'message')).toBe(
      false
    )
    expect(
      projectCallsRealtimeRoute(
        {
          workflows: {},
          customNodes: {
            n: {
              nodes: [{ type: 'general-http-request', config: { url: '/api/realtime/event' } }],
            },
          },
        } as any,
        'event'
      )
    ).toBe(true)
  })
})

describe('realtime-send-channel-message (server-side)', () => {
  const env = process.env
  const sent: any[] = []
  beforeEach(() => {
    sent.length = 0
    process.env = { ...env, REALTIME_SERVER_URL: 'https://rt.test', REALTIME_SERVER_API_KEY: 'k' }
    ;(global as any).fetch = async (_url: string, init: any) => {
      sent.push(JSON.parse(init.body))
      return { ok: true, json: async () => ({ messageId: 'm1', timestamp: 1 }) }
    }
  })
  afterEach(() => {
    process.env = env
    delete (global as any).fetch
  })

  it('sends as the signed-in visitor the segment verified, whatever the config names', async () => {
    const send = loadHandler('realtime-send-channel-message')
    await send(
      { channelName: 'lobby', message: 'hi', senderId: 'admin', senderName: 'Support' },
      { __sessionUserId: 'user-42', __sessionUser: { id: 'user-42', name: 'Ana' } }
    )
    expect(sent[0]).toMatchObject({ senderId: 'user-42', senderName: 'Ana' })
  })

  it('sends as the author configured, or System, when no visitor is signed in', async () => {
    const send = loadHandler('realtime-send-channel-message')
    await send({ channelName: 'lobby', message: 'hi' }, { __sessionUserId: null })
    expect(sent[0]).toMatchObject({ senderId: 'system', senderName: 'System' })
  })
})

describe('realtime-join-channel', () => {
  it('sends no user to the join route and enters presence as the identity the server returned', () => {
    const handler = nodeRegistry['realtime-join-channel'].generateHandler()
    const bodyStart = handler.indexOf('JSON.stringify(')
    const body = handler.slice(bodyStart, handler.indexOf('})', bodyStart))
    expect(body).not.toMatch(/userId|userName/)
    expect(handler).toMatch(/joinData\.identity/)
  })
})
