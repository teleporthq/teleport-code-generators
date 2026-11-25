/* tslint:disable:function-constructor max-classes-per-file no-any */
import { createHash, createHmac } from 'crypto'
import { UIDLAIAssistantChat } from '@teleporthq/teleport-types'
import { SameOriginRequest, SessionCookieResolver } from '@teleporthq/teleport-shared'
import { generateCartApiRoute } from '../src/ecommerce/cart-api-routes-generator'
import {
  AI_CHAT_VISITOR_COOKIE_SECURE,
  generateConversationByIdRouteCode,
  generateConversationMessagesRouteCode,
  generateConversationsRouteCode,
  generateMessageRouteCode,
} from '../src/ai-chat/api-route-generator'
import { buildForumNotificationsRouteSource } from '../src/forum/notifications-route'
import { buildForumFilesRouteSource } from '../src/forum/files-route'
import { buildForumRepliesRouteSource, FORUM_ROUTE_ROOT } from '../src/forum/replies-route'
import { buildSendRouteSource, buildSubscriptionsRouteSource } from '../src/web-push/routes-source'
import {
  browserKey,
  callRoute,
  fakeDatabase,
  PUBLIC_KEY,
  pushEnv,
} from './_helpers/load-push-server'

/**
 * The cart, the AI chat, the forum and push subscriptions change something for
 * the visitor whose cookie the request carries. Each answers only the site's
 * own pages (Sec-Fetch-Site same-origin, or without it an Origin naming the
 * host) and requests that name no page at all (the site's own server), on the
 * site's custom domain and on its teleporthq.app address alike. Any other page
 * gets 403 and nothing is read or changed. Every route emits the one check
 * teleport-shared exports.
 */

type Row = Record<string, any>

const { SAME_ORIGIN_REQUEST_FUNCTION, SAME_ORIGIN_REQUEST_SOURCE } = SameOriginRequest

const SITE_ADDRESSES = ['www.shop-example.com', 'shop-example.teleporthq.app']
const OTHER_SITE = 'https://other-site.teleporthq.app'

const ownPages = (host: string): Row[] => [
  { host, origin: `https://${host}`, 'sec-fetch-site': 'same-origin' },
  { host, origin: `https://${host}` },
]
const otherSitePages = (host: string): Row[] => [
  { host, origin: OTHER_SITE, 'sec-fetch-site': 'same-site' },
  { host, origin: OTHER_SITE },
]
const serverCall = (host: string): Row => ({ host })

const eachAddress = (headersOf: (host: string) => Row[]): Row[] =>
  SITE_ADDRESSES.flatMap((host) => headersOf(host))

const OTHER_SITE_PAGES = eachAddress(otherSitePages)
const OWN_PAGES = eachAddress(ownPages)
const SERVER_CALLS = SITE_ADDRESSES.map(serverCall)

const recordingResponse = () => {
  const res: Row = { statusCode: 0, body: undefined, headers: {} as Row, written: [] as string[] }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (body: unknown) => {
    res.body = body
    return res
  }
  res.setHeader = (name: string, value: unknown) => {
    res.headers[name.toLowerCase()] = value
  }
  res.getHeader = (name: string) => res.headers[name.toLowerCase()]
  res.write = (chunk: string) => {
    res.written.push(chunk)
    return true
  }
  res.end = () => res
  return res
}

const asCommonJs = (source: string): string =>
  source.replace(
    /^export default async function handler/m,
    'module.exports = async function handler'
  )

describe('every route emits the one shared check', () => {
  const chat = {
    enabled: true,
    tables: {
      knowledgeSourcesTable: 'ks',
      documentsTable: 'docs',
      conversationsTable: 'convs',
      messagesTable: 'msgs',
    },
    chatSettings: { unknownInformationMessage: 'I do not know.' },
    ragConfig: {
      embeddingModel: 'text-embedding-3-small',
      searchTopK: 3,
      conversationHistoryLimit: 10,
      rephrase: { temperature: 0.1, maxTokens: 50, systemMessage: 'rephrase' },
      answer: { temperature: 0.2, maxTokens: 100, streaming: false, systemMessage: 'answer' },
    },
  } as unknown as UIDLAIAssistantChat

  const ROUTES: Array<[string, string]> = [
    ['the cart', generateCartApiRoute('postgresql', { connectionString: 'env:DATABASE_URL' })!],
    ['an AI chat message', generateMessageRouteCode(chat)],
    ['the AI chat conversations', generateConversationsRouteCode(chat)],
    ['one AI chat conversation', generateConversationByIdRouteCode(chat)],
    ['the forum notifications', buildForumNotificationsRouteSource()],
    ['the forum pictures', buildForumFilesRouteSource()],
    ['push subscriptions', buildSubscriptionsRouteSource()],
  ]

  it.each(ROUTES)('%s carries the shared check once, and no other', (_route, source) => {
    expect(source.split(SAME_ORIGIN_REQUEST_SOURCE).length - 1).toBe(1)
    expect(source.split(`function ${SAME_ORIGIN_REQUEST_FUNCTION}(req)`).length - 1).toBe(1)
    expect(source.match(/sec-fetch-site/g)).toHaveLength(1)
  })

  it.each([
    ['the AI chat messages of a conversation', generateConversationMessagesRouteCode(chat)],
    ['the forum replies', buildForumRepliesRouteSource()],
    ['the push send route (its own token)', buildSendRouteSource()],
  ])('%s only reads, or takes no browser: no check', (_route, source) => {
    expect(source).not.toContain('sec-fetch-site')
  })
})

describe('the cart answers the site’s own pages and its server', () => {
  const SIGNED_IN = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
  const PRODUCT = '11111111-2222-4333-8444-555555555555'
  const MINTED = 'internal-call-token'
  const SESSION_COOKIE = '__Host-next-auth.session-token=signed'

  const bootCart = () => {
    const queries: string[] = []
    let sessionReads = 0
    const record = async (sql: string) => {
      queries.push(sql)
      return { rows: [] as Row[], rowCount: 1 }
    }
    class FakePool {
      public query = record
      public async connect() {
        return { query: record, release: (): undefined => undefined }
      }
    }
    const module = { exports: {} as any }
    new Function(
      'require',
      'module',
      'exports',
      'process',
      generateCartApiRoute('postgresql', { connectionString: 'env:DATABASE_URL' })!
    )(
      (name: string): any => {
        if (name === 'pg') {
          return { Pool: FakePool }
        }
        if (name === 'crypto') {
          return require('crypto')
        }
        if (name === 'next-auth/jwt') {
          return {
            getToken: async () => {
              sessionReads += 1
              return { id: SIGNED_IN }
            },
          }
        }
        if (name === '../../../utils/email/email-locale') {
          return { normalizeEmailLocale: (): null => null }
        }
        if (name === '../../../utils/workflows/server-runtime') {
          return { isInternalCall: (req: Row) => req.headers['x-teleport-internal'] === MINTED }
        }
        throw new Error("Cannot find module '" + name + "'")
      },
      module,
      module.exports,
      { env: { NEXTAUTH_SECRET: 'secret', DATABASE_URL: 'postgresql://x' } }
    )
    return async (op: string, headers: Row, body: Row) => {
      queries.length = 0
      sessionReads = 0
      const res = recordingResponse()
      await module.exports({ method: 'POST', query: { op }, headers, body }, res)
      return { status: res.statusCode, body: res.body, queries: queries.slice(), sessionReads }
    }
  }

  const fromPage = (headers: Row): Row => ({
    'x-forwarded-proto': 'https',
    'content-type': 'application/json',
    cookie: SESSION_COOKIE,
    ...headers,
  })

  const OPERATIONS: Array<[string, Row]> = [
    ['load', { sessionId: 'guest-session-1' }],
    ['sync', { items: [{ productId: PRODUCT, quantity: 2 }], sessionId: 'guest-session-1' }],
    ['merge', { sessionId: 'guest-session-1' }],
    ['mark-ordered', { sessionId: 'guest-session-1' }],
  ]

  it.each(OPERATIONS)(
    '%s: a page of another site gets 403, and no session or cart is read or changed',
    async (op, body) => {
      const call = bootCart()
      for (const headers of OTHER_SITE_PAGES) {
        const answer = await call(op, fromPage(headers), body)
        expect([headers, answer.status]).toEqual([headers, 403])
        expect(answer.queries).toEqual([])
        expect(answer.sessionReads).toBe(0)
      }
    }
  )

  it('sync: the site’s own page stores the cart, on either of its addresses', async () => {
    const call = bootCart()
    for (const headers of OWN_PAGES) {
      const answer = await call('sync', fromPage(headers), OPERATIONS[1][1])
      expect([headers, answer.status, answer.body.ok]).toEqual([headers, 200, true])
      expect(answer.queries.some((sql) => sql.startsWith('INSERT INTO teleport_cart_items'))).toBe(
        true
      )
    }
  })

  it('mark-ordered: the site’s own server retires the buyer’s cart', async () => {
    const call = bootCart()
    for (const headers of SERVER_CALLS) {
      const answer = await call(
        'mark-ordered',
        { ...headers, 'x-teleport-internal': MINTED },
        { anonymousUserId: SIGNED_IN }
      )
      expect([headers, answer.status, answer.body]).toEqual([
        headers,
        200,
        { ok: true, updated: 1 },
      ])
      expect(answer.queries.filter((sql) => sql.includes("SET status = 'ordered'"))).toHaveLength(1)
    }
  })
})

describe('the AI chat answers the site’s own pages and its server', () => {
  const SECRET = 'app-secret'
  const VISITOR_KEY = 'a'.repeat(32)
  const VISITOR_COOKIE =
    AI_CHAT_VISITOR_COOKIE_SECURE +
    '=' +
    VISITOR_KEY +
    '.' +
    createHmac('sha256', SECRET)
      .update('teleport-ai-chat-visitor:v1:' + VISITOR_KEY)
      .digest('hex')
  const CONVERSATION = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f'

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

  const chat = {
    enabled: true,
    tables: {
      knowledgeSourcesTable: 'ks',
      documentsTable: 'docs',
      conversationsTable: 'convs',
      messagesTable: 'msgs',
    },
    chatSettings: { unknownInformationMessage: 'I do not know.' },
    ragConfig: {
      embeddingModel: 'text-embedding-3-small',
      searchTopK: 3,
      conversationHistoryLimit: 10,
      rephrase: { temperature: 0.1, maxTokens: 50, systemMessage: 'rephrase' },
      answer: { temperature: 0.2, maxTokens: 100, streaming: false, systemMessage: 'answer' },
    },
  } as unknown as UIDLAIAssistantChat

  const boot = (code: string) => {
    const tables: Record<string, Row[]> = {
      docs: [{ id: 'd1', content: 'We ship worldwide.', embedding_json: '[1,0]' }],
      convs: [{ id: CONVERSATION, user_id: visitorUuid(VISITOR_KEY), title: 'Shipping' }],
      msgs: [],
    }
    const spent: string[] = []
    const matches = (row: Row, where: Row = {}) =>
      Object.keys(where).every((key) => String(row[key]) === String(where[key]))
    const db = {
      selectMany: async (table: string, options: Row = {}) =>
        tables[table].filter((row) => matches(row, options.where)),
      selectOne: async (table: string, where: Row) =>
        tables[table].find((row) => matches(row, where)) || null,
      insert: async (table: string, data: Row) => {
        tables[table].push({ ...data })
        return data
      },
      update: async (table: string, id: string, data: Row) => {
        const row = tables[table].find((entry) => entry.id === id)
        Object.assign(row || {}, data)
        return row || null
      },
      remove: async (table: string, id: string) => {
        tables[table] = tables[table].filter((row) => row.id !== id)
      },
      removeWhere: async (table: string, where: Row) => {
        tables[table] = tables[table].filter((row) => !matches(row, where))
      },
    }
    const provider = {
      chatCompletion: async () => {
        spent.push('completion')
        return { content: 'We ship worldwide.' }
      },
      generateEmbedding: async () => {
        spent.push('embedding')
        return [1, 0]
      },
    }
    const security = {
      rateLimitRequest: async () => {
        spent.push('visitor limit')
        return true
      },
      rateLimit: async () => {
        spent.push('site budget')
        return { allowed: true }
      },
      safeEqual: (a: string, b: string) => a === b,
    }
    const module = { exports: {} as any }
    new Function('require', 'module', 'exports', 'process', asCommonJs(code))(
      (name: string) => {
        if (name === 'crypto') {
          return require('crypto')
        }
        if (/lib\/ai-chat\/provider$/.test(name)) {
          return provider
        }
        if (/lib\/ai-chat\/db$/.test(name)) {
          return db
        }
        if (/utils\/security-runtime$/.test(name)) {
          return security
        }
        throw new Error('unexpected require: ' + name)
      },
      module,
      module.exports,
      { env: { NEXTAUTH_SECRET: SECRET } }
    )
    const call = async (method: string, headers: Row, body: Row = {}) => {
      const res = recordingResponse()
      await module.exports(
        {
          method,
          body,
          query: { id: CONVERSATION },
          headers: { 'x-forwarded-proto': 'https', cookie: VISITOR_COOKIE, ...headers },
        },
        res
      )
      return { status: res.statusCode, body: res.body }
    }
    return { call, tables: () => tables, spent }
  }

  it('a message from a page of another site gets 403: nothing is stored, counted or asked of the model', async () => {
    for (const headers of OTHER_SITE_PAGES) {
      const chatRoute = boot(generateMessageRouteCode(chat))
      const answer = await chatRoute.call('POST', headers, { message: 'Do you ship?' })
      expect([headers, answer.status]).toEqual([headers, 403])
      expect(chatRoute.tables().msgs).toEqual([])
      expect(chatRoute.spent).toEqual([])
    }
  })

  it('a message from the site’s own page or a request naming no page is answered', async () => {
    for (const headers of [...OWN_PAGES, ...SERVER_CALLS]) {
      const chatRoute = boot(generateMessageRouteCode(chat))
      const answer = await chatRoute.call('POST', headers, { message: 'Do you ship?' })
      expect([headers, answer.status, answer.body.message]).toEqual([
        headers,
        200,
        'We ship worldwide.',
      ])
      expect(chatRoute.tables().msgs).toHaveLength(2)
    }
  })

  it('starting a conversation: another site’s page gets 403, the site’s own pages and server get it', async () => {
    for (const headers of OTHER_SITE_PAGES) {
      const route = boot(generateConversationsRouteCode(chat))
      const answer = await route.call('POST', headers, { title: 'Returns' })
      expect([headers, answer.status]).toEqual([headers, 403])
      expect(route.tables().convs).toHaveLength(1)
    }
    for (const headers of [...OWN_PAGES, ...SERVER_CALLS]) {
      const route = boot(generateConversationsRouteCode(chat))
      const answer = await route.call('POST', headers, { title: 'Returns' })
      expect([headers, answer.status]).toEqual([headers, 201])
      expect(route.tables().convs).toHaveLength(2)
    }
  })

  it('renaming or deleting a conversation: another site’s page gets 403 and the conversation stays as it was', async () => {
    for (const headers of OTHER_SITE_PAGES) {
      const route = boot(generateConversationByIdRouteCode(chat))
      expect((await route.call('PATCH', headers, { title: 'Renamed' })).status).toBe(403)
      expect((await route.call('DELETE', headers)).status).toBe(403)
      expect(route.tables().convs).toEqual([
        { id: CONVERSATION, user_id: visitorUuid(VISITOR_KEY), title: 'Shipping' },
      ])
    }
  })

  it('renaming or deleting a conversation from the site’s own page or its server is done', async () => {
    for (const headers of [...OWN_PAGES, ...SERVER_CALLS]) {
      const renamed = boot(generateConversationByIdRouteCode(chat))
      expect((await renamed.call('PATCH', headers, { title: 'Renamed' })).status).toBe(200)
      expect(renamed.tables().convs[0].title).toBe('Renamed')

      const deleted = boot(generateConversationByIdRouteCode(chat))
      expect((await deleted.call('DELETE', headers)).status).toBe(200)
      expect(deleted.tables().convs).toEqual([])
    }
  })

  it('reading the visitor’s own conversations stays open to any request the route admits', async () => {
    for (const headers of [...OWN_PAGES, ...OTHER_SITE_PAGES]) {
      const route = boot(generateConversationByIdRouteCode(chat))
      expect([headers, (await route.call('GET', headers)).status]).toEqual([headers, 200])
    }
  })
})

describe('the forum answers the site’s own pages and its server', () => {
  const PICTURE = 'aaaaaaaa-0000-4000-8000-000000000001'

  const boot = (source: string) => {
    const resolver = SessionCookieResolver.generateCommonJsSessionTokenResolverCode(
      FORUM_ROUTE_ROOT,
      { withRevocation: false }
    )
    expect(source).toContain(resolver)
    const marked: unknown[] = []
    const storage: string[] = []
    const forum = {
      markNotificationsRead: async (_session: unknown, ids: unknown) => {
        marked.push(ids)
        return 1
      },
      filesStillShown: async (): Promise<string[]> => [],
    }
    const fetch = async (url: string, init: { method: string }) => {
      storage.push(init.method + ' ' + url)
      return {
        ok: true,
        status: 200,
        json: async () => ({ files: [{ id: PICTURE, folder: 'forum' }] }),
      }
    }
    const module = { exports: {} as any }
    new Function(
      'require',
      'module',
      'exports',
      'process',
      'fetch',
      asCommonJs(
        source.replace(resolver, 'async function __tqSessionToken(req) { return req.session; }')
      )
    )(
      (name: string) =>
        name.includes('security') ? { rateLimitRequest: async () => true } : forum,
      module,
      module.exports,
      {
        env: {
          RUNTIME_STORAGE_URL: 'https://storage.example',
          RUNTIME_STORAGE_API_KEY: 'storage-key',
          RUNTIME_STORAGE_PROJECT_ID: 'project-1',
        },
      },
      fetch
    )
    const call = async (headers: Row, body: Row) => {
      const res = recordingResponse()
      await module.exports({ method: 'POST', headers, body, session: { id: 'member-1' } }, res)
      return res.statusCode
    }
    return { call, marked, storage }
  }

  it('marking notifications read: another site’s page gets 403 and nothing is marked', async () => {
    const route = boot(buildForumNotificationsRouteSource({ withSessionRevocation: false }))
    for (const headers of OTHER_SITE_PAGES) {
      expect([headers, await route.call(headers, { ids: null })]).toEqual([headers, 403])
    }
    expect(route.marked).toEqual([])
    for (const headers of [...OWN_PAGES, ...SERVER_CALLS]) {
      expect([headers, await route.call(headers, { ids: null })]).toEqual([headers, 200])
    }
    expect(route.marked).toHaveLength(OWN_PAGES.length + SERVER_CALLS.length)
  })

  it('removing pictures: another site’s page gets 403 and storage is never asked', async () => {
    const route = boot(buildForumFilesRouteSource({ withSessionRevocation: false }))
    for (const headers of OTHER_SITE_PAGES) {
      expect([headers, await route.call(headers, { files: [PICTURE] })]).toEqual([headers, 403])
    }
    expect(route.storage).toEqual([])
    for (const headers of [...OWN_PAGES, ...SERVER_CALLS]) {
      expect([headers, await route.call(headers, { files: [PICTURE] })]).toEqual([headers, 200])
    }
    expect(route.storage.filter((call) => call.startsWith('DELETE'))).toHaveLength(
      OWN_PAGES.length + SERVER_CALLS.length
    )
  })
})

describe('push subscriptions answer the site’s own pages and its server', () => {
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    expirationTime: null as number | null,
    keys: { p256dh: browserKey(), auth: Buffer.alloc(16, 3).toString('base64url') },
  }
  const writes = (database: { queries: Array<{ text: string }> }) =>
    database.queries.filter((query) => /teleport_push_subscriptions/.test(query.text))

  it('saving or forgetting a subscription: another site’s page gets 403 and nothing is written', async () => {
    for (const headers of OTHER_SITE_PAGES) {
      for (const method of ['POST', 'DELETE']) {
        const database = fakeDatabase()
        const answer = await callRoute(
          'subscriptions',
          {
            method,
            headers,
            body: {
              subscription,
              applicationServerKey: PUBLIC_KEY,
              endpoint: subscription.endpoint,
            },
          },
          { env: pushEnv({ NEXTAUTH_SECRET: 'secret' }), database, session: { id: 'member-1' } }
        )
        expect([headers, method, answer.statusCode]).toEqual([headers, method, 403])
        expect(writes(database)).toEqual([])
      }
    }
  })

  it('saving a subscription from the site’s own page or its server is done', async () => {
    for (const headers of [...OWN_PAGES, ...SERVER_CALLS]) {
      const database = fakeDatabase()
      const answer = await callRoute(
        'subscriptions',
        { method: 'POST', headers, body: { subscription, applicationServerKey: PUBLIC_KEY } },
        { env: pushEnv({ NEXTAUTH_SECRET: 'secret' }), database, session: { id: 'member-1' } }
      )
      expect([headers, answer.statusCode, answer.body]).toEqual([headers, 200, { saved: true }])
      expect(writes(database).length).toBeGreaterThan(0)
    }
  })
})
