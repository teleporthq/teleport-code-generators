import * as nodeCrypto from 'crypto'
import * as net from 'net'
import { generateServerSegmentAPIRoute } from '../src/api-route-generator'
import { generateSecurityRuntimeCode } from '../src/security-runtime'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'

// The checkout's public steps carry the per-visitor limits the editor declares
// on them (apps/gui/.../ecommerce/code-lookup-rate-limit.ts):
//   - the voucher / gift-card code lookup: 30 every 15 minutes, then SKIPPED
//     (the code reads as not valid — a 429 would leave the Apply button
//     checking);
//   - the order INSERT: 30 every 15 minutes, then REFUSED with a 429 that
//     carries the step's own public message.
// These run the GENERATED segment route for each step, called directly the way
// a crafted client would, with the real shared security runtime (no database:
// it counts per instance).

const VOUCHER_LOOKUP = {
  id: 'lookup',
  type: 'data-raw-query',
  label: 'Look Up Voucher By Code',
  stepNumber: 1,
  executionEnv: 'server',
  config: {
    dataSourceId: 'ds-1',
    query: 'SELECT v.id FROM teleport_vouchers v WHERE v.code = $1::text LIMIT 1',
    params: ['SAVE10'],
    visitorLimit: { limit: 30, windowSeconds: 900, onLimit: 'skip' },
  },
}
const ORDER_LIMIT_MESSAGE =
  'Too many orders were placed from your network in the last few minutes. Please wait a little and try again.'
const ORDER_INSERT = {
  id: 'create-order',
  type: 'data-create-item',
  label: 'Create Order Record In Database',
  stepNumber: 1,
  executionEnv: 'server',
  config: {
    dataSourceId: 'ds-1',
    tableName: 'teleport_orders',
    columnMappings: [{ column: 'status', value: 'pending' }],
    visitorLimit: {
      limit: 30,
      windowSeconds: 900,
      onLimit: 'refuse',
      message: ORDER_LIMIT_MESSAGE,
    },
  },
}

const segmentOf = (node: Record<string, unknown>): WorkflowSegment =>
  ({
    id: 'server-1',
    env: 'server',
    nodeIds: [node.id],
    nodes: [node],
    edges: [],
    entryNodeIds: [node.id],
  } as unknown as WorkflowSegment)

function loadSecurityRuntime() {
  const requireShim = (id: string): unknown => {
    if (id === 'crypto') {
      return nodeCrypto
    }
    if (id === 'net') {
      return net
    }
    throw new Error("Cannot find module '" + id + "'")
  }
  const module = { exports: {} as any }
  const quiet = { warn: (): undefined => undefined, error: (): undefined => undefined }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
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

function bootRoute(segment: WorkflowSegment) {
  const runtime = loadServerRuntime()
  const security = loadSecurityRuntime()
  const requireStub = (id: string) =>
    id.endsWith('server-runtime') ? runtime : id.endsWith('security-runtime') ? security : {}
  const routeModule: { exports: any } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(
    'module',
    'exports',
    'require',
    'console',
    generateServerSegmentAPIRoute(segment, 'Checkout')
  )(routeModule, routeModule.exports, requireStub, {
    log: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  })
  return async (address: string) => {
    const reply = { status: 0, body: null as any, headers: {} as Record<string, string> }
    await routeModule.exports(
      {
        method: 'POST',
        body: { context: {} },
        headers: { host: 'localhost:3000' },
        socket: { remoteAddress: address },
      },
      {
        setHeader(name: string, value: string) {
          reply.headers[name] = value
        },
        status(code: number) {
          reply.status = code
          return this
        },
        json(payload: unknown) {
          reply.body = payload
          return this
        },
      }
    )
    return reply
  }
}

describe('the public checkout steps behind their per-visitor limits', () => {
  const savedSecret = process.env.NEXTAUTH_SECRET
  const savedFetch = (globalThis as any).fetch
  const dataCalls: string[] = []
  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = 'checkout-limits-test-secret'
    ;(globalThis as any).fetch = async (url: string) => {
      dataCalls.push(url)
      return {
        ok: true,
        status: 200,
        json: async () => ({ rows: [{ id: 'v-1' }], success: true, item: { id: 'order-1' } }),
      }
    }
  })
  beforeEach(() => {
    dataCalls.length = 0
  })
  afterAll(() => {
    ;(globalThis as any).fetch = savedFetch
    if (savedSecret === undefined) {
      delete process.env.NEXTAUTH_SECRET
    } else {
      process.env.NEXTAUTH_SECRET = savedSecret
    }
  })

  it('a code lookup past 30 in 15 minutes from one visitor is skipped, the route still answers', async () => {
    const call = bootRoute(segmentOf(VOUCHER_LOOKUP))
    for (let i = 0; i < 30; i++) {
      expect((await call('203.0.113.7')).status).toBe(200)
    }
    expect(dataCalls).toHaveLength(30)
    const limited = await call('203.0.113.7')
    expect(limited.status).toBe(200)
    expect(dataCalls).toHaveLength(30)
    // Another visitor still gets an answer.
    expect((await call('203.0.113.8')).status).toBe(200)
    expect(dataCalls).toHaveLength(31)
  })

  it('a crafted client writing orders past 30 in 15 minutes is refused with a 429 and the order message, nothing written', async () => {
    const call = bootRoute(segmentOf(ORDER_INSERT))
    for (let i = 0; i < 30; i++) {
      expect((await call('198.51.100.4')).status).toBe(200)
    }
    const writes = dataCalls.length
    expect(writes).toBeGreaterThanOrEqual(30)
    const refused = await call('198.51.100.4')
    expect(refused.status).toBe(429)
    expect(refused.body).toEqual({ error: ORDER_LIMIT_MESSAGE })
    expect(Number(refused.headers['Retry-After'])).toBeGreaterThan(0)
    expect(Number(refused.headers['Retry-After'])).toBeLessThanOrEqual(900)
    expect(dataCalls).toHaveLength(writes)
  })
})
