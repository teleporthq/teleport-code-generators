/* tslint:disable:function-constructor max-classes-per-file */
import { createHash, createHmac } from 'crypto'
import { UIDLAIAssistantChat } from '@teleporthq/teleport-types'
import {
  AI_CHAT_MAX_LABEL_CHARS,
  AI_CHAT_MAX_MESSAGE_CHARS,
  AI_CHAT_VISITOR_COOKIE,
  AI_CHAT_VISITOR_COOKIE_SECURE,
  AI_SITE_BUDGET_KEY,
  AI_SITE_CALLS_PER_DAY,
  generateConversationByIdRouteCode,
  generateConversationMessagesRouteCode,
  generateConversationsRouteCode,
  generateMessageRouteCode,
} from '../src/ai-chat/api-route-generator'
import { NextAIChatProjectPlugin } from '../src/ai-chat/project-plugin'
import {
  AI_SITE_CALLS_KEY,
  AI_SITE_CALLS_PER_DAY as WORKFLOW_AI_SITE_CALLS_PER_DAY,
} from '@teleporthq/teleport-plugin-next-workflows'

const SECRET = 'app-secret'
const signed = (key: string): string =>
  key +
  '.' +
  createHmac('sha256', SECRET)
    .update('teleport-ai-chat-visitor:v1:' + key)
    .digest('hex')

/**
 * A5-H3: the site's AI chat routes were open to anyone, unthrottled, with no
 * message cap, each call spending the merchant's own model key; an anonymous
 * visitor's conversation belonged to whoever presented its id. Executed here
 * against the emitted routes with a scripted model, an in-memory database and
 * a scripted security runtime.
 */

const TABLES = {
  knowledgeSourcesTable: 'ks',
  documentsTable: 'docs',
  conversationsTable: 'convs',
  messagesTable: 'msgs',
}

const buildChat = (streaming = false, requiresAuth = false): UIDLAIAssistantChat =>
  ({
    enabled: true,
    tables: TABLES,
    chatSettings: { unknownInformationMessage: 'I do not know.' },
    ragConfig: {
      embeddingModel: 'text-embedding-3-small',
      searchTopK: 3,
      conversationHistoryLimit: 10,
      rephrase: { temperature: 0.1, maxTokens: 50, systemMessage: 'rephrase' },
      answer: { temperature: 0.2, maxTokens: 100, streaming, systemMessage: 'answer' },
    },
    ...(requiresAuth ? { authProtection: { requiresAuth: true, allowedRoles: [] } } : {}),
  } as unknown as UIDLAIAssistantChat)

type Row = Record<string, any>

class FakeDb {
  public tables: Record<string, Row[]> = { docs: [], convs: [], msgs: [] }

  public matches(row: Row, where: Row = {}): boolean {
    return Object.keys(where).every((key) => String(row[key]) === String(where[key]))
  }

  public api() {
    return {
      selectMany: async (table: string, options: Row = {}) => {
        let rows = this.tables[table].filter((row) => this.matches(row, options.where))
        if (options.whereIn) {
          rows = rows.filter((row) => options.whereIn.values.includes(row[options.whereIn.column]))
        }
        return rows.slice(0, options.limit || rows.length)
      },
      selectOne: async (table: string, where: Row) =>
        this.tables[table].find((row) => this.matches(row, where)) || null,
      insert: async (table: string, data: Row) => {
        this.tables[table].push({ ...data })
        return data
      },
      update: async (table: string, id: string, data: Row) => {
        const row = this.tables[table].find((entry) => entry.id === id)
        if (row) {
          Object.assign(row, data)
        }
        return row || null
      },
      remove: async (table: string, id: string) => {
        this.tables[table] = this.tables[table].filter((row) => row.id !== id)
      },
      removeWhere: async (table: string, where: Row) => {
        this.tables[table] = this.tables[table].filter((row) => !this.matches(row, where))
      },
    }
  }
}

interface Harness {
  db: FakeDb
  providerCalls: string[]
  limits: Array<Record<string, unknown>>
  budget: { allowed: boolean }
  refuseScope?: string
  streamError?: Error
  secret?: string
  // What next-auth's getToken decodes, when it is asked for a cookie at all.
  session?: Row | null
  tokenRequests?: Array<{ cookieName?: string }>
}

function harness(): Harness {
  const db = new FakeDb()
  db.tables.docs.push({ id: 'd1', content: 'We ship worldwide.', embedding_json: '[1,0]' })
  return { db, providerCalls: [], limits: [], budget: { allowed: true } }
}

function load(code: string, h: Harness) {
  const moduleObj: { exports: any } = { exports: {} }
  const provider = {
    chatCompletion: async (options: { userMessage: string }) => {
      h.providerCalls.push('completion:' + options.userMessage)
      return { content: 'an answer' }
    },
    streamChatCompletion: async (_options: unknown, onChunk: (c: string, a: string) => void) => {
      h.providerCalls.push('stream')
      if (h.streamError) {
        throw h.streamError
      }
      await onChunk('an', 'an answer')
    },
    generateEmbedding: async () => {
      h.providerCalls.push('embedding')
      return [1, 0]
    },
  }
  const security = {
    rateLimitRequest: async (_req: unknown, res: any, options: Record<string, unknown>) => {
      h.limits.push(options)
      if (options.scope === h.refuseScope) {
        res.status(429).json({ error: 'Too many requests. Try again later.' })
        return false
      }
      return true
    },
    rateLimit: async (options: Record<string, unknown>) => {
      h.limits.push(options)
      return { allowed: h.budget.allowed, retryAfter: 60 }
    },
    safeEqual: (a: string, b: string) => typeof a === 'string' && a.length > 0 && a === b,
  }
  const body = code.replace(
    'export default async function handler',
    'module.exports = async function handler'
  )
  new Function('require', 'module', 'exports', 'process', body)(
    (name: string) => {
      if (name === 'crypto') {
        return require('crypto')
      }
      if (/lib\/ai-chat\/provider$/.test(name)) {
        return provider
      }
      if (/lib\/ai-chat\/db$/.test(name)) {
        return h.db.api()
      }
      if (/utils\/security-runtime$/.test(name)) {
        return security
      }
      if (name === 'next-auth/jwt') {
        return {
          getToken: async (params: { cookieName?: string }) => {
            ;(h.tokenRequests = h.tokenRequests || []).push({ cookieName: params.cookieName })
            return h.session || null
          },
        }
      }
      throw new Error('unexpected require: ' + name)
    },
    moduleObj,
    moduleObj.exports,
    { env: { NEXTAUTH_SECRET: h.secret === undefined ? SECRET : h.secret } }
  )
  return moduleObj.exports
}

async function call(
  handler: any,
  request: { method?: string; body?: unknown; query?: Row; cookie?: string; https?: boolean }
) {
  const headers: Record<string, unknown> = {}
  const res: any = {
    statusCode: 200,
    payload: undefined,
    written: [] as string[],
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(value: unknown) {
      res.payload = value
      return res
    },
    write(chunk: string) {
      res.written.push(chunk)
    },
    end() {
      return res
    },
    setHeader(name: string, value: unknown) {
      headers[name.toLowerCase()] = value
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()]
    },
  }
  await handler(
    {
      method: request.method || 'POST',
      body: request.body || {},
      query: request.query || {},
      headers: {
        ...(request.cookie ? { cookie: request.cookie } : {}),
        ...(request.https ? { 'x-forwarded-proto': 'https' } : {}),
      },
    },
    res
  )
  return { status: res.statusCode, payload: res.payload, written: res.written, headers }
}

const visitorUuid = (key: string): string => {
  const h = createHash('sha256')
    .update('teleport-ai-chat-visitor:' + key)
    .digest('hex')
  return (
    h.slice(0, 8) +
    '-' +
    h.slice(8, 12) +
    '-4' +
    h.slice(13, 16) +
    '-' +
    // tslint:disable-next-line:no-bitwise
    ((parseInt(h[16], 16) & 3) | 8).toString(16) +
    h.slice(17, 20) +
    '-' +
    h.slice(20, 32)
  )
}

const ANA = AI_CHAT_VISITOR_COOKIE + '=' + signed('a'.repeat(32))
const BOB = AI_CHAT_VISITOR_COOKIE + '=' + signed('b'.repeat(32))

describe('/api/ai-chat/message — limits', () => {
  it('limits each visitor to 20 a minute and 200 a day; a refused call spends nothing', async () => {
    const h = harness()
    h.refuseScope = 'ai-chat-message'
    const route = load(generateMessageRouteCode(buildChat()), h)
    const result = await call(route, { body: { message: 'hello' }, cookie: ANA })
    expect(result.status).toBe(429)
    expect(h.providerCalls).toEqual([])
    expect(h.db.tables.msgs).toEqual([])

    const ok = harness()
    await call(load(generateMessageRouteCode(buildChat()), ok), {
      body: { message: 'hi' },
      cookie: ANA,
    })
    expect(ok.limits.filter((entry) => entry.scope === 'ai-chat-message')).toEqual([
      { scope: 'ai-chat-message', limit: 20, windowSeconds: 60 },
      { scope: 'ai-chat-message', limit: 200, windowSeconds: 86400 },
    ])
  })

  it('refuses a message over 4,000 characters before any model call', async () => {
    const h = harness()
    const route = load(generateMessageRouteCode(buildChat()), h)
    const tooLong = await call(route, {
      body: { message: 'x'.repeat(AI_CHAT_MAX_MESSAGE_CHARS + 1) },
      cookie: ANA,
    })
    expect(tooLong.status).toBe(400)
    expect(h.providerCalls).toEqual([])
    expect(h.db.tables.msgs).toEqual([])

    const atCap = await call(route, {
      body: { message: 'x'.repeat(AI_CHAT_MAX_MESSAGE_CHARS) },
      cookie: ANA,
    })
    expect(atCap.status).toBe(200)
  })

  it('uses the workflow AI nodes’ own budget key and size, so both count against one budget', () => {
    expect(AI_SITE_BUDGET_KEY).toBe(AI_SITE_CALLS_KEY)
    expect(AI_SITE_CALLS_PER_DAY).toBe(WORKFLOW_AI_SITE_CALLS_PER_DAY)
  })

  it('counts every model call against the site’s daily AI budget, shared with the workflow AI nodes', async () => {
    const h = harness()
    const route = load(generateMessageRouteCode(buildChat()), h)
    await call(route, { body: { message: 'do you ship?' }, cookie: ANA })
    // rephrase + embedding + answer
    expect(h.providerCalls).toHaveLength(3)
    expect(h.limits.filter((entry) => entry.key === AI_SITE_BUDGET_KEY)).toEqual(
      Array(3).fill({ key: 'site:ai-calls', limit: AI_SITE_CALLS_PER_DAY, windowSeconds: 86400 })
    )
  })

  it('refuses cleanly once the site’s budget is spent, before storing or calling anything', async () => {
    for (const streaming of [false, true]) {
      const h = harness()
      h.budget.allowed = false
      const route = load(generateMessageRouteCode(buildChat(streaming)), h)
      const result = await call(route, { body: { message: 'hello' }, cookie: ANA })
      expect(result.status).toBe(429)
      expect(result.payload.error).toBe(
        'The assistant is unavailable right now. Please try again later.'
      )
      expect(h.providerCalls).toEqual([])
      expect(h.db.tables.msgs).toEqual([])
    }
  })

  it('never streams the provider’s own error message to the visitor', async () => {
    const h = harness()
    h.streamError = new Error('Incorrect API key provided: sk-live-1234')
    const route = load(generateMessageRouteCode(buildChat(true)), h)
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await call(route, { body: { message: 'hello' }, cookie: ANA })
    spy.mockRestore()
    expect(result.written.join('')).not.toContain('sk-live')
    expect(result.written.join('')).toContain('"error":"Stream error"')
  })
})

describe('/api/ai-chat/* — a conversation belongs to the visitor who started it', () => {
  it('stores an anonymous visitor under a uuid derived from its httpOnly cookie, whatever the body says', async () => {
    const h = harness()
    const route = load(generateMessageRouteCode(buildChat()), h)
    const first = await call(route, { body: { message: 'hello', userId: 'victim-uuid' } })
    const setCookie = (first.headers['set-cookie'] as string[])[0]
    expect(setCookie).toMatch(
      new RegExp(
        '^' +
          AI_CHAT_VISITOR_COOKIE +
          '=[0-9a-f]{32}\\.[0-9a-f]{64}; Path=/api/ai-chat; HttpOnly; SameSite=Lax; Max-Age=31536000$'
      )
    )
    const value = setCookie.split(';')[0].split('=')[1]
    const key = value.split('.')[0]
    expect(value).toBe(signed(key))
    expect(h.db.tables.msgs[0].user_id).toBe(visitorUuid(key))

    await call(route, { body: { message: 'again' }, cookie: ANA })
    expect(h.db.tables.msgs[2].user_id).toBe(visitorUuid('a'.repeat(32)))
  })

  it('replaces a cookie value it did not issue instead of adopting it', async () => {
    const h = harness()
    const route = load(generateMessageRouteCode(buildChat()), h)
    const planted = 'd'.repeat(32)
    for (const value of [planted, planted + '.' + 'e'.repeat(64)]) {
      const result = await call(route, {
        body: { message: 'hi' },
        cookie: AI_CHAT_VISITOR_COOKIE + '=' + value,
      })
      expect(result.headers['set-cookie']).toHaveLength(1)
    }
    expect(h.db.tables.msgs.map((row) => row.user_id)).not.toContain(visitorUuid(planted))
  })

  it('uses a __Host- cookie on https, and ignores the plain name a sibling site could set', async () => {
    const h = harness()
    const route = load(generateMessageRouteCode(buildChat()), h)
    // A sibling *.teleporthq.app site can set the plain name for the parent domain.
    const tossed = await call(route, { body: { message: 'hi' }, cookie: ANA, https: true })
    expect((tossed.headers['set-cookie'] as string[])[0]).toMatch(
      new RegExp(
        '^' +
          AI_CHAT_VISITOR_COOKIE_SECURE.replace('-', '\\-') +
          '=[0-9a-f]{32}\\.[0-9a-f]{64}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=31536000$'
      )
    )
    expect(h.db.tables.msgs[0].user_id).not.toBe(visitorUuid('a'.repeat(32)))

    const own = await call(route, {
      body: { message: 'hi' },
      cookie: AI_CHAT_VISITOR_COOKIE_SECURE + '=' + signed('a'.repeat(32)),
      https: true,
    })
    expect(own.headers['set-cookie']).toBeUndefined()
    expect(h.db.tables.msgs[2].user_id).toBe(visitorUuid('a'.repeat(32)))
  })

  it('refuses an anonymous visitor when the app has no secret to sign the cookie with', async () => {
    const h = harness()
    h.secret = ''
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await call(load(generateMessageRouteCode(buildChat()), h), {
      body: { message: 'hi' },
    })
    spy.mockRestore()
    expect(result.status).toBe(503)
    expect(h.providerCalls).toEqual([])
    expect(h.db.tables.msgs).toEqual([])
  })

  it('caps a stored title and username, and limits the read routes per visitor', async () => {
    const h = harness()
    const route = load(generateConversationsRouteCode(buildChat()), h)
    await call(route, {
      method: 'POST',
      body: { title: 't'.repeat(5000), username: 'u'.repeat(5000) },
      cookie: ANA,
    })
    expect(h.db.tables.convs[0].title).toHaveLength(AI_CHAT_MAX_LABEL_CHARS)
    expect(h.db.tables.convs[0].username).toHaveLength(AI_CHAT_MAX_LABEL_CHARS)

    h.limits.length = 0
    await call(route, { method: 'GET', cookie: ANA })
    const byId = load(generateConversationByIdRouteCode(buildChat()), h)
    await call(byId, { method: 'GET', query: { id: h.db.tables.convs[0].id }, cookie: ANA })
    const messages = load(generateConversationMessagesRouteCode(buildChat()), h)
    await call(messages, { method: 'GET', query: { id: h.db.tables.convs[0].id }, cookie: ANA })
    expect(h.limits).toEqual(
      Array(3).fill({ scope: 'ai-chat-read', limit: 120, windowSeconds: 60 })
    )
  })

  it("starts a new conversation instead of continuing someone else's", async () => {
    const h = harness()
    const route = load(generateMessageRouteCode(buildChat()), h)
    const ana = await call(route, { body: { message: 'my order is 4711' }, cookie: ANA })
    const anaConversation = ana.payload.conversationId

    h.providerCalls.length = 0
    const bob = await call(route, {
      body: { message: 'what did I say?', conversationId: anaConversation },
      cookie: BOB,
    })
    expect(bob.payload.conversationId).not.toBe(anaConversation)
    // Ana's history never reaches Bob's prompt.
    expect(h.providerCalls.join('\n')).not.toContain('4711')

    const anaAgain = await call(route, {
      body: { message: 'thanks', conversationId: anaConversation },
      cookie: ANA,
    })
    expect(anaAgain.payload.conversationId).toBe(anaConversation)
  })

  it("answers someone else's conversation with a 404 — read, rename, delete, messages", async () => {
    const h = harness()
    const anaId = visitorUuid('a'.repeat(32))
    const conversation = '11111111-1111-4111-8111-111111111111'
    h.db.tables.convs.push({ id: conversation, user_id: anaId, title: 'mine' })
    h.db.tables.msgs.push({
      id: 'm1',
      conversation_id: conversation,
      user_id: anaId,
      message: 'secret',
    })
    const byId = load(generateConversationByIdRouteCode(buildChat()), h)
    const messages = load(generateConversationMessagesRouteCode(buildChat()), h)

    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const result = await call(byId, {
        method,
        query: { id: conversation },
        body: { title: 'pwned' },
        cookie: BOB,
      })
      expect([method, result.status]).toEqual([method, 404])
    }
    expect(
      (await call(messages, { method: 'GET', query: { id: conversation }, cookie: BOB })).status
    ).toBe(404)
    expect(h.db.tables.convs[0].title).toBe('mine')
    expect(h.db.tables.msgs).toHaveLength(1)

    const own = await call(messages, { method: 'GET', query: { id: conversation }, cookie: ANA })
    expect(own.payload.messages).toHaveLength(1)
    expect(
      (await call(byId, { method: 'GET', query: { id: conversation }, cookie: ANA })).status
    ).toBe(200)
    expect(
      (await call(byId, { method: 'DELETE', query: { id: conversation }, cookie: ANA })).status
    ).toBe(200)
    expect(h.db.tables.msgs).toEqual([])
  })

  it('lists and creates conversations for the cookie’s visitor, never for a userId the request names', async () => {
    const h = harness()
    h.db.tables.convs.push({ id: 'c1', user_id: visitorUuid('a'.repeat(32)) })
    const route = load(generateConversationsRouteCode(buildChat()), h)
    const asBob = await call(route, {
      method: 'GET',
      query: { userId: visitorUuid('a'.repeat(32)) },
      cookie: BOB,
    })
    expect(asBob.payload.conversations).toEqual([])
    const asAna = await call(route, { method: 'GET', cookie: ANA })
    expect(asAna.payload.conversations).toHaveLength(1)

    await call(route, { method: 'POST', body: { userId: 'victim' }, cookie: BOB })
    expect(h.db.tables.convs[1].user_id).toBe(visitorUuid('b'.repeat(32)))
    expect(h.limits.filter((entry) => entry.scope === 'ai-chat-conversation')).toHaveLength(2)
  })

  it('reads the session through the shared reader, from the project root, in an auth-protected chat', () => {
    const code = generateConversationMessagesRouteCode(buildChat(false, true))
    expect(code).toContain('await __tqSessionToken(req)')
    expect(code).toContain("require('../../../../../utils/auth/session-revocation')")
    expect(code).not.toContain('getServerSession')
  })

  it('COOKIE TOSSING: ignores a plain session cookie on https, reading only the __Host- one', async () => {
    const h = harness()
    h.session = { id: 'planter', email: 'evil@x.test' }
    const route = load(generateConversationsRouteCode(buildChat(false, true)), h)

    const planted = await call(route, {
      method: 'GET',
      cookie: 'next-auth.session-token=planted',
      https: true,
    })
    expect(planted.status).toBe(401)
    expect(h.tokenRequests || []).toEqual([])

    const own = await call(route, {
      method: 'GET',
      cookie: '__Host-next-auth.session-token=mine',
      https: true,
    })
    expect(own.status).not.toBe(401)
    expect(h.tokenRequests).toEqual([{ cookieName: '__Host-next-auth.session-token' }])
  })
})

describe('NextAIChatProjectPlugin', () => {
  it('writes the shared security runtime the chat routes require', async () => {
    const structure: any = {
      uidl: {
        name: 'Shop',
        globals: { settings: { title: 'Shop', language: 'en' }, env: {} },
        root: { name: 'Root', stateDefinitions: {}, node: { type: 'element', content: {} } },
        aiAssistantChat: buildChat(),
      },
      files: new Map(),
      dependencies: {},
      devDependencies: {},
    }
    await new NextAIChatProjectPlugin().runAfter(structure)
    // The visitor cookie is signed with the app secret; a chat-only app gets one.
    expect(structure.uidl.globals.env.NEXTAUTH_SECRET).toMatch(/^[0-9a-f]{64}$/)
    const runtime = structure.files.get('security-runtime')
    expect(runtime.path).toEqual(['utils'])
    expect(runtime.files[0].name).toBe('security-runtime')
    expect(structure.files.get('ai-chat-api-message').files[0].content).toContain(
      "require('../../../utils/security-runtime')"
    )
  })
})
