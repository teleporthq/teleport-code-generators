/* tslint:disable:function-constructor */
import { TableAccess } from '@teleporthq/teleport-shared'
import { generateDataAPIRoute } from '../src/data-api-route-generator'
import {
  generateServerSegmentAPIRoute,
  generateStreamingServerSegmentAPIRoute,
} from '../src/api-route-generator'
import { generateSharedRuntimeUtilsCode } from '../src/executor-generator'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'

/**
 * The auth users table's credentials — the password hash and the OAuth tokens
 * (`TableAccess.AUTH_CREDENTIAL_COLUMNS`) — never leave the server in a row.
 * A browser read of the data route was already served without them; a create
 * or an update answered the whole row it wrote, and a server segment replied
 * its data nodes' rows to the browser as they came.
 */

const SECRET = 'server-secret'

const USER_ROW = {
  id: 'u-1',
  email: 'member@example.com',
  name: 'Member',
  password: '$2a$10$hash',
  access_token: 'oauth-access',
  refresh_token: 'oauth-refresh',
  id_token: 'oauth-id',
  session_state: 'state',
  token_type: 'Bearer',
  scope: 'openid email',
  expires_at: 1767225600,
}

const PROFILE = { id: 'u-1', email: 'member@example.com', name: 'Member' }

function bootDataRoute(rows: Array<Record<string, unknown>>) {
  const code = generateDataAPIRoute({ authUsersTableName: 'users' })
  class FakeClient {
    public async connect(): Promise<void> {
      return
    }
    public async end(): Promise<void> {
      return
    }
    public async query(sql: string): Promise<{ rows: unknown[]; rowCount: number }> {
      if (/information_schema/i.test(sql)) {
        return { rows: [], rowCount: 0 }
      }
      return { rows, rowCount: rows.length }
    }
  }
  const moduleObj: { exports: any } = { exports: {} }
  const fakeRequire = (name: string): unknown => {
    if (name === 'pg') {
      return { Client: FakeClient }
    }
    if (name === 'next-auth/jwt') {
      return { getToken: async () => ({ id: 'u-1' }) }
    }
    throw new Error('unexpected require: ' + name)
  }
  new Function('require', 'module', 'exports', 'process', 'console', code)(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    { env: { NEXTAUTH_SECRET: SECRET, TELEPORT_DB_CONNECTION_STRING: 'postgresql://x' } },
    { error: (): void => undefined, warn: (): void => undefined, log: (): void => undefined }
  )
  return async (operation: string, body: Record<string, unknown>, headers = {}) => {
    let status = 0
    let payload: any = null
    const res = {
      status(statusCode: number) {
        status = statusCode
        return this
      },
      json(value: unknown) {
        payload = value
        return this
      },
    }
    await moduleObj.exports(
      { method: 'POST', query: { params: ['ds-1', operation] }, headers, body },
      res
    )
    return { status, body: payload }
  }
}

const internal = { 'x-internal-data-secret': SECRET }

describe('data route — the row a create or update answers with', () => {
  it('leaves the credentials out of a created users row, for the server caller too', async () => {
    const route = bootDataRoute([USER_ROW])
    const reply = await route(
      'create',
      { tableName: 'users', columnMappings: [{ column: 'email', value: 'member@example.com' }] },
      internal
    )
    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ item: PROFILE, id: 'u-1' })
  })

  it('leaves them out of an updated users row, however the table is spelled', async () => {
    const route = bootDataRoute([USER_ROW])
    for (const tableName of ['users', 'public.users', '"users"']) {
      const reply = await route(
        'update',
        {
          tableName,
          filters: [{ field: 'id', operator: '=', value: 'u-1' }],
          columnMappings: [{ column: 'name', value: 'Member' }],
        },
        internal
      )
      expect(reply.status).toBe(200)
      expect(reply.body).toEqual({ updatedCount: 1, item: PROFILE, id: 'u-1' })
    }
  })

  it("keeps another table's columns, even ones named like a credential elsewhere", async () => {
    const card = { id: 'g-1', code: 'GIFT', expires_at: '2027-01-01', scope: 'store' }
    const route = bootDataRoute([card])
    const reply = await route(
      'create',
      { tableName: 'teleport_gift_cards', columnMappings: [{ column: 'code', value: 'GIFT' }] },
      internal
    )
    expect(reply.body).toEqual({ item: card, id: 'g-1' })
  })
})

interface SegmentReply {
  status: number
  body: { success: boolean; results?: Record<string, any>; error?: string }
}

function bootSegment(segment: WorkflowSegment, dataReplies: Record<string, unknown>) {
  const source = generateServerSegmentAPIRoute(segment, 'Credentials')
  const runtime = loadServerRuntime()
  const routeModule: { exports: unknown } = { exports: {} }
  new Function('module', 'exports', 'require', source)(
    routeModule,
    routeModule.exports,
    (id: string) => (id.endsWith('server-runtime') ? runtime : {})
  )
  const handler = routeModule.exports as (req: unknown, res: unknown) => Promise<void>
  return async (): Promise<SegmentReply> => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => dataReplies[String(url).split('/').pop() as string],
    })) as unknown as typeof fetch
    try {
      const reply: SegmentReply = { status: 0, body: { success: false } }
      const res = {
        status(code: number) {
          reply.status = code
          return this
        },
        json(payload: SegmentReply['body']) {
          reply.body = payload
          return this
        },
      }
      await handler(
        { method: 'POST', body: { context: {} }, headers: { host: 'shop.example' } },
        res
      )
      return reply
    } finally {
      globalThis.fetch = originalFetch
    }
  }
}

const step = (id: string, type: string, stepNumber: number, config: Record<string, unknown>) => ({
  id,
  type,
  label: id,
  executionEnv: 'server' as const,
  stepNumber,
  config,
})

const segmentOf = (nodes: Array<ReturnType<typeof step>>): WorkflowSegment => ({
  id: 'server-1',
  env: 'server',
  nodeIds: nodes.map((node) => node.id),
  nodes,
  edges: nodes.slice(1).map((node, index) => ({
    id: `e${index}`,
    source: nodes[index].id,
    target: node.id,
  })) as WorkflowSegment['edges'],
  entryNodeIds: [nodes[0].id],
})

describe('server segment — the rows it replies to the browser with', () => {
  const secret = process.env.NEXTAUTH_SECRET
  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = SECRET
  })
  afterAll(() => {
    process.env.NEXTAUTH_SECRET = secret
  })

  it('replies a data node of the users table without its credentials', async () => {
    const segment = segmentOf([
      step('read', 'data-select', 1, { dataSourceId: 'ds-1', tableName: 'users' }),
      step('save', 'data-update-item', 2, {
        dataSourceId: 'ds-1',
        tableName: 'users',
        filters: [{ field: 'id', operator: '=', value: 'u-1' }],
        columnMappings: [{ column: 'name', value: 'Member' }],
      }),
    ])
    const reply = await bootSegment(segment, {
      select: { rows: [USER_ROW], count: 1 },
      update: { item: USER_ROW, id: 'u-1', updatedCount: 1 },
    })()
    expect(reply.status).toBe(200)
    const results = reply.body.results || {}
    expect(results.read).toEqual({ rows: [PROFILE], count: 1 })
    expect(results.save).toEqual({ ...PROFILE, updatedCount: 1, affected: 1 })
    expect(JSON.stringify(results)).not.toMatch(/hash|oauth-/)
  })

  it("strips a raw statement's rows of the credentials no other table uses", async () => {
    const segment = segmentOf([
      step('raw', 'data-raw-query', 1, { dataSourceId: 'ds-1', query: 'SELECT * FROM users' }),
    ])
    const reply = await bootSegment(segment, { 'raw-query': { rows: [USER_ROW] } })()
    const row = { ...PROFILE, scope: 'openid email', expires_at: 1767225600 }
    expect(reply.body.results?.raw).toEqual({ rows: [row], result: [row] })
  })

  it("leaves another table's rows, and every node that reads no rows, as they are", async () => {
    const card = { id: 'g-1', expires_at: '2027-01-01', scope: 'store' }
    const segment = segmentOf([
      step('cards', 'data-select', 1, { dataSourceId: 'ds-1', tableName: 'teleport_gift_cards' }),
      step('form', 'general-custom-js', 2, {
        code: 'function customHandler(params) { return { password: "typed" } }',
        context: 'server',
      }),
    ])
    const reply = await bootSegment(segment, { select: { rows: [card], count: 1 } })()
    expect(reply.body.results?.cards).toEqual({ rows: [card], count: 1 })
    expect(reply.body.results?.form).toEqual({ password: 'typed' })
  })

  it('signs the result it replies, so a later segment can verify what the browser holds', async () => {
    const segment = segmentOf([
      step('read', 'data-select', 1, { dataSourceId: 'ds-1', tableName: 'users' }),
    ])
    const reply = await bootSegment(segment, { select: { rows: [USER_ROW], count: 1 } })()
    const later = loadServerRuntime()
    const context: Record<string, unknown> = { ...reply.body.results }
    later.claimSegmentContext({ signedNodeIds: ['read'], nodes: [], edges: [] }, context)
    expect(context.read).toEqual({ rows: [PROFILE], count: 1 })
  })
})

describe('one credential list', () => {
  it('is the shared AUTH_CREDENTIAL_COLUMNS, in the runtime and in a streamed node result', () => {
    const runtime = generateSharedRuntimeUtilsCode()
    expect(runtime).toContain(JSON.stringify(TableAccess.AUTH_CREDENTIAL_COLUMNS))
    expect(runtime).toContain(JSON.stringify(TableAccess.UNAMBIGUOUS_CREDENTIAL_COLUMNS))
    const streaming = generateStreamingServerSegmentAPIRoute(
      segmentOf([step('ai', 'ai-custom-prompt', 1, { streaming: true })])
    )
    expect(streaming).toContain('utils.withoutCredentialColumns(kept, result)')
  })

  it('strips a streamed data node the same way the reply does', () => {
    const utils = loadServerRuntime()
    const node = { id: 'read', type: 'data-select', config: { tableName: 'users' } }
    expect(utils.withoutCredentialColumns(node, { rows: [USER_ROW], count: 1 })).toEqual({
      rows: [PROFILE],
      count: 1,
    })
  })
})
