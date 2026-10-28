import * as crypto from 'crypto'
import * as net from 'net'
import { generateServerSegmentAPIRoute } from '../src/api-route-generator'
import { generateSecurityRuntimeCode } from '../src/security-runtime'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'

// A newsletter signup must not tell a visitor whether an address is already
// on the list. teleport-gui's signup statement answers one constant row, and
// its step keeps its result on the server: whatever the database answered —
// a new row's id, or nothing — the browser receives the same reply.

const signupSegment = {
  id: 'server-1',
  env: 'server',
  nodeIds: ['subscribe'],
  nodes: [
    {
      id: 'subscribe',
      type: 'data-raw-query',
      label: 'Add The Subscriber',
      config: {
        dataSourceId: 'ds',
        query: 'WITH added AS (INSERT INTO users …) SELECT TRUE AS done',
        params: ['someone@example.com', ''],
        visitorLimit: { limit: 5, windowSeconds: 3600, onLimit: 'skip' },
        keepResultOnServer: true,
      },
      executionEnv: 'server',
      stepNumber: 1,
    },
  ],
  edges: [] as unknown[],
} as unknown as WorkflowSegment

const loadRoute = () => {
  const serverRuntime = loadServerRuntime()
  const security = { exports: {} as any }
  const noop = (): undefined => undefined
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
  )(
    security,
    security.exports,
    (id: string): unknown => (id === 'crypto' ? crypto : id === 'net' ? net : {}),
    { env: {} },
    { warn: noop, error: noop, log: noop },
    Buffer,
    Date
  )
  const module = { exports: null as any }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', generateServerSegmentAPIRoute(signupSegment, 'Sub'))(
    module,
    {},
    (id: string): unknown => {
      if (id.endsWith('/utils/workflows/server-runtime')) {
        return serverRuntime
      }
      if (id.endsWith('/utils/security-runtime')) {
        return security.exports
      }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(id)
    }
  )
  return module.exports
}

/** The reply the browser receives when the database answers `rows`. */
const replyWhenTheDatabaseAnswers = async (rows: unknown[]): Promise<unknown> => {
  const handler = loadRoute()
  const previousFetch = (globalThis as any).fetch
  ;(globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ rows }) })
  try {
    const reply = { status: 0, body: null as unknown }
    const res: Record<string, unknown> = {
      status(code: number): unknown {
        reply.status = code
        return res
      },
      json(payload: unknown): unknown {
        reply.body = payload
        return res
      },
      setHeader: noopHeader,
    }
    await handler(
      {
        method: 'POST',
        url: '/api/workflows/sub-seg-1',
        headers: { host: 'shop.test', 'x-forwarded-proto': 'https' },
        socket: { remoteAddress: '203.0.113.7' },
        body: { context: {} },
      },
      res
    )
    expect(reply.status).toBe(200)
    return reply.body
  } finally {
    ;(globalThis as any).fetch = previousFetch
  }
}

const noopHeader = (): undefined => undefined

/**
 * The reply without what differs on EVERY request whatever it did: the run's
 * own id and time, and the MAC over them (the signed hand-off, Task 2a).
 */
const withoutPerRequestValues = (reply: any): unknown => {
  const results = { ...reply.results }
  delete results.__sigRun
  results.__sigOrder = { keys: results.__sigOrder && results.__sigOrder.keys }
  return { ...reply, results }
}

describe('a newsletter signup’s reply', () => {
  const previousSecret = process.env.NEXTAUTH_SECRET
  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = 'test-app-secret'
  })
  afterAll(() => {
    process.env.NEXTAUTH_SECRET = previousSecret
  })

  it('is the same whether the address was new or already on the list', async () => {
    const added = await replyWhenTheDatabaseAnswers([{ id: 'c01f44db-new-row' }])
    const known = await replyWhenTheDatabaseAnswers([])
    const constant = await replyWhenTheDatabaseAnswers([{ done: true }])
    expect(JSON.stringify(added)).not.toContain('c01f44db-new-row')
    expect(withoutPerRequestValues(added)).toEqual(withoutPerRequestValues(known))
    expect(withoutPerRequestValues(constant)).toEqual(withoutPerRequestValues(known))
    expect((known as any).results).not.toHaveProperty('subscribe')
  })
})
