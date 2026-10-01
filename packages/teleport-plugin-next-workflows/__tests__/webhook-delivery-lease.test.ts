import { generateWebhookDeliveryLeaseCode } from '../src/webhook-delivery-lease/webhook-delivery-lease-code'
import { generateWebhookWorkflowAPIRoute } from '../src/api-route-generator'
import { loadServerRuntime } from './_helpers/load-server-runtime'
import { withFetch } from './_helpers/fake-fetch'

/**
 * One payment webhook delivery at a time. The lease module and the route that
 * uses it are EXECUTED: the module against a stubbed `pg`, the route with a
 * stubbed lease, so a twin delivery is proven to be turned away while the
 * first runs and every claim to be released before the route replies.
 */

interface StubQuery {
  sql: string
  values: unknown[]
}

const noop = (): void => undefined
const silentConsole = { warn: noop, error: noop, log: noop, info: noop }

const loadLease = (options: {
  queryImpl?: (sql: string, values: unknown[]) => Promise<unknown>
  pgAvailable?: boolean
  pgSupported?: boolean
}) => {
  const queries: StubQuery[] = []
  const queryImpl =
    options.queryImpl ||
    (async (sql: string, values: unknown[]) =>
      sql.startsWith('INSERT') ? { rows: [{ claim_token: values[1] }] } : { rows: [] })
  class Client {
    async connect(): Promise<void> {
      return undefined
    }
    async query(sql: string, values: unknown[]) {
      queries.push({ sql, values })
      return queryImpl(sql, values)
    }
    async end(): Promise<void> {
      return undefined
    }
  }
  const requireShim = (id: string) => {
    if (id === 'pg') {
      if (options.pgAvailable === false) {
        throw new Error("Cannot find module 'pg'")
      }
      return { Client }
    }
    if (id === 'crypto') {
      return require('crypto')
    }
    throw new Error('unexpected require: ' + id)
  }
  const savedConnection = process.env.TELEPORT_DB_CONNECTION_STRING
  process.env.TELEPORT_DB_CONNECTION_STRING = 'postgresql://u:p@localhost:5432/db'
  const module = { exports: {} as any }
  // eslint-disable-next-line no-new-func
  new Function(
    'module',
    'exports',
    'require',
    'process',
    'console',
    'Buffer',
    generateWebhookDeliveryLeaseCode({ pgSupported: options.pgSupported !== false })
  )(module, module.exports, requireShim, process, silentConsole, Buffer)
  const restore = () => {
    if (savedConnection === undefined) {
      delete process.env.TELEPORT_DB_CONNECTION_STRING
    } else {
      process.env.TELEPORT_DB_CONNECTION_STRING = savedConnection
    }
  }
  return { claim: module.exports.claimWebhookDelivery, queries, restore }
}

describe('webhook delivery lease module', () => {
  it('creates its table once, claims with a fresh token and releases only its own claim', async () => {
    const lease = loadLease({})
    try {
      const first = await lease.claim('webhooks/stripe-payment', Buffer.from('{"id":"evt_1"}'), {
        id: 'evt_1',
      })
      expect(first.claimed).toBe(true)
      expect(lease.queries[0].sql).toMatch(
        /^CREATE TABLE IF NOT EXISTS "teleport_webhook_deliveries"/
      )
      const claim = lease.queries[1]
      expect(claim.sql).toContain('ON CONFLICT (delivery_key) DO UPDATE')
      expect(claim.sql).toContain('WHERE d.claimed_at < NOW() - make_interval(secs => $3::int)')
      expect(claim.values[0]).toMatch(/^[0-9a-f]{64}$/)
      expect(claim.values[2]).toBe(300)
      await first.release()
      const release = lease.queries[2]
      expect(release.sql).toMatch(
        /^DELETE FROM "teleport_webhook_deliveries" WHERE \(delivery_key = \$1 AND claim_token = \$2\)/
      )
      expect(release.values).toEqual([claim.values[0], claim.values[1]])
      // The table is not created again by the next delivery.
      await lease.claim('webhooks/stripe-payment', Buffer.from('{"id":"evt_2"}'), { id: 'evt_2' })
      expect(lease.queries[3].sql).toMatch(/^INSERT INTO/)
    } finally {
      lease.restore()
    }
  })

  it('reports a delivery whose twin holds the claim as not claimed', async () => {
    const lease = loadLease({ queryImpl: async () => ({ rows: [] }) })
    try {
      const twin = await lease.claim('webhooks/paddle-payment', Buffer.from('{}'), {})
      expect(twin.claimed).toBe(false)
      await twin.release()
      expect(lease.queries.filter((query) => query.sql.startsWith('DELETE'))).toHaveLength(0)
    } finally {
      lease.restore()
    }
  })

  it('keys a delivery on the webhook, the body and the state it was verified as', async () => {
    const lease = loadLease({})
    try {
      const keyOf = async (scope: string, raw: string, verified: unknown) => {
        await lease.claim(scope, Buffer.from(raw), verified)
        return lease.queries.filter((query) => query.sql.startsWith('INSERT')).pop()!.values[0]
      }
      const paid = await keyOf('webhooks/mollie-payment', 'id=tr_1', { status: 'paid' })
      expect(await keyOf('webhooks/mollie-payment', 'id=tr_1', { status: 'paid' })).toBe(paid)
      // Mollie posts the same id for every change: the fetched state tells them apart.
      expect(await keyOf('webhooks/mollie-payment', 'id=tr_1', { status: 'expired' })).not.toBe(
        paid
      )
      expect(await keyOf('webhooks/coingate-payment', 'id=tr_1', { status: 'paid' })).not.toBe(paid)
    } finally {
      lease.restore()
    }
  })

  it('lets every delivery run when it cannot hold a lease', async () => {
    const noDriver = loadLease({ pgAvailable: false })
    try {
      expect((await noDriver.claim('w', Buffer.from('{}'), {})).claimed).toBe(true)
      expect(noDriver.queries).toHaveLength(0)
    } finally {
      noDriver.restore()
    }
    const failing = loadLease({
      queryImpl: async () => {
        throw Object.assign(new Error('permission denied'), { code: '42501' })
      },
    })
    try {
      expect((await failing.claim('w', Buffer.from('{}'), {})).claimed).toBe(true)
      // Disabled for the process after a privilege error: nothing is tried again.
      const tried = failing.queries.length
      expect((await failing.claim('w', Buffer.from('{}'), {})).claimed).toBe(true)
      expect(failing.queries).toHaveLength(tried)
    } finally {
      failing.restore()
    }
    const otherDatabase = loadLease({ pgSupported: false })
    try {
      expect((await otherDatabase.claim('w', Buffer.from('{}'), {})).claimed).toBe(true)
      expect(otherDatabase.queries).toHaveLength(0)
    } finally {
      otherDatabase.restore()
    }
  })
})

const ECHO_URL = 'https://echo.test/received'

const workflow = (webhookConfig: Record<string, unknown>, failing = false) =>
  ({
    id: 'wf-1',
    name: 'Payment webhook',
    trigger: { type: 'event-webhook-triggered', nodeId: 't', scope: 'global', config: {} },
    nodes: [
      {
        id: 'echo',
        type: 'general-http-request',
        config: {
          url: failing ? 'https://echo.test/fails' : ECHO_URL,
          method: 'POST',
          body: { type: 'workflowContext', nodeId: 't', path: ['body'] },
        },
        stepNumber: 1,
        label: 'Echo',
      },
    ],
    edges: [{ id: 'e1', source: 't', target: 'echo' }],
    webhookConfig: { httpMethod: 'POST', ...webhookConfig },
  } as any)

interface LeaseLog {
  claims: Array<{ scope: string; body: unknown }>
  releases: number
  events: string[]
}

const loadRoute = (source: string, claimed: boolean, log: LeaseLog) => {
  const runtime = { exports: loadServerRuntime() }
  const requireShim = (id: string) => {
    if (id.endsWith('/utils/workflows/server-runtime')) {
      return runtime.exports
    }
    if (id.endsWith('/utils/payments')) {
      return {
        get: () => ({
          verifyWebhook: async (input: { body: unknown }) => ({ ok: true, body: input.body }),
        }),
      }
    }
    if (id.endsWith('/utils/workflows/webhook-delivery-lease')) {
      return {
        claimWebhookDelivery: async (scope: string, _raw: Buffer, body: unknown) => {
          log.claims.push({ scope, body })
          log.events.push('claim')
          return {
            claimed,
            release: async () => {
              log.releases += 1
              log.events.push('release')
            },
          }
        },
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id)
  }
  const module = { exports: null as any }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', source)(module, {}, requireShim)
  return module.exports as (req: unknown, res: unknown) => Promise<void>
}

const post = async (handler: (req: unknown, res: unknown) => Promise<void>, log: LeaseLog) => {
  const reply = { status: 0, body: null as unknown, headers: {} as Record<string, string> }
  const res = {
    setHeader(name: string, value: string) {
      reply.headers[name] = value
    },
    status(code: number) {
      reply.status = code
      return {
        json(payload: unknown) {
          log.events.push('reply ' + code)
          reply.body = payload
        },
      }
    },
  }
  const req = {
    method: 'POST',
    url: '/api/webhooks/paddle-payment',
    query: {},
    headers: { host: 'shop.test', 'content-type': 'application/json' },
    body: Buffer.from('{"event_id":"evt_1"}'),
  }
  const ran: unknown[] = []
  await withFetch(
    (call) => {
      if (call.url === ECHO_URL) {
        ran.push(call.json)
        return { status: 200, body: {} }
      }
      throw new Error('network down')
    },
    () => handler(req, res)
  )
  return { reply, ran }
}

describe('generated payment webhook route — delivery lease', () => {
  const paymentSource = generateWebhookWorkflowAPIRoute(
    workflow({ urlPath: 'webhooks/paddle-payment', verifySignature: true })
  )

  it('runs a claimed delivery and releases the claim before replying', async () => {
    const log: LeaseLog = { claims: [], releases: 0, events: [] }
    const { reply, ran } = await post(loadRoute(paymentSource, true, log), log)
    expect(reply.status).toBe(200)
    expect(ran).toEqual([{ event_id: 'evt_1' }])
    expect(log.claims).toEqual([{ scope: 'webhooks/paddle-payment', body: { event_id: 'evt_1' } }])
    expect(log.events).toEqual(['claim', 'release', 'reply 200'])
  })

  it('turns a twin away while the first delivery runs, asking the provider to come back', async () => {
    const log: LeaseLog = { claims: [], releases: 0, events: [] }
    const { reply, ran } = await post(loadRoute(paymentSource, false, log), log)
    expect(reply.status).toBe(503)
    expect(reply.headers['Retry-After']).toBe('60')
    expect(ran).toEqual([])
    expect(log.releases).toBe(0)
  })

  it('releases the claim of a run that failed, so the retry runs', async () => {
    const failingSource = generateWebhookWorkflowAPIRoute(
      workflow({ urlPath: 'webhooks/paddle-payment', verifySignature: true }, true)
    )
    const log: LeaseLog = { claims: [], releases: 0, events: [] }
    const { reply } = await post(loadRoute(failingSource, true, log), log)
    expect(reply.status).toBe(500)
    expect(log.events).toEqual(['claim', 'release', 'reply 500'])
  })

  it('leaves every other webhook without a lease', () => {
    const other = generateWebhookWorkflowAPIRoute(
      workflow({ urlPath: 'webhooks/orders', verifySignature: false })
    )
    expect(other).not.toContain('webhook-delivery-lease')
    expect(other).not.toContain('__delivery')
    expect(paymentSource).toContain("require('../../../utils/workflows/webhook-delivery-lease')")
  })
})
