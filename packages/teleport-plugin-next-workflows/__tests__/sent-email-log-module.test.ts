// The sent-email ledger module is emitted as a runtime string; these tests
// EXECUTE it against a stubbed `pg` so the row it writes, its allow-list, its
// disable rules and its drain contract are proven on the code that ships.
import { generateSentEmailLogCode } from '../src/sent-email-log/sent-email-log-code'

interface StubQuery {
  sql: string
  values: unknown[]
}

const loadModule = (options: {
  queryImpl?: (sql: string, values: unknown[]) => Promise<unknown>
  pgAvailable?: boolean
  env?: Record<string, string>
}) => {
  const queries: StubQuery[] = []
  const connects: number[] = []
  const ends: number[] = []
  const queryImpl = options.queryImpl || (async () => ({ rowCount: 1 }))

  class Client {
    async connect() {
      connects.push(1)
    }
    async query(sql: string, values: unknown[]) {
      queries.push({ sql, values })
      return queryImpl(sql, values)
    }
    async end() {
      ends.push(1)
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

  const savedEnv = { ...process.env }
  process.env.TELEPORT_DB_CONNECTION_STRING = 'postgresql://u:p@localhost:5432/db'
  Object.assign(process.env, options.env || {})

  const module = { exports: {} as any }
  const code = generateSentEmailLogCode({ pgSupported: true })
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'process', 'console', code)(
    module,
    module.exports,
    requireShim,
    process,
    silentConsole
  )

  const restore = () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key]
      }
    }
    Object.assign(process.env, savedEnv)
  }

  return { api: module.exports, queries, connects, ends, restore }
}

const noop = (): void => undefined
const silentConsole = { warn: noop, error: noop, log: noop, info: noop }

const rowOf = (query: StubQuery): Record<string, unknown> => {
  const columns = /\(([^)]+)\) VALUES/
    .exec(query.sql)![1]
    .split(',')
    .map((c) => c.trim().replace(/"/g, ''))
  const row: Record<string, unknown> = {}
  columns.forEach((column, index) => {
    row[column] = query.values[index]
  })
  return row
}

describe('sent-email-log runtime module', () => {
  it('writes one parameterized row per attempt, with a fresh id and the allow-listed fields only', async () => {
    const { api, queries, connects, ends, restore } = loadModule({})
    try {
      const landed = await api.recordSentEmail({
        emailType: 'order-shipped',
        audience: 'customer',
        to: 'jane@example.com',
        cc: 'ops@example.com, boss@example.com',
        from: 'Acme Store <shop@acme.com>',
        subject: 'Your parcel is on its way',
        html: '<p>Hi Jane</p>',
        payload: [
          { key: 'customerName', value: 'Jane' },
          { key: 'items', value: [{ name: 'Mug', qty: 2 }] },
        ],
        provider: 'resend',
        providerMessageId: 'msg_1',
        status: 'sent',
        source: 'workflow',
        sourceRef: 'email-resend',
        orderId: '5f2b1a1e-8d7f-4c2e-9a1b-2c3d4e5f6a7b',
        userId: 'not-a-uuid',
        apiKey: 'sk_live_secret',
      })
      expect(landed).toBe(true)
      expect(queries).toHaveLength(1)
      expect(connects).toHaveLength(1)
      expect(ends).toHaveLength(1)
      expect(queries[0].sql).toMatch(/^INSERT INTO "teleport_sent_emails" \(/)
      expect(queries[0].sql).not.toContain('sk_live_secret')
      const row = rowOf(queries[0])
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(row.email_type).toBe('order-shipped')
      expect(row.audience).toBe('customer')
      expect(row.recipient_email).toBe('jane@example.com')
      expect(row.recipients).toBe('["jane@example.com"]')
      expect(row.cc).toBe('["ops@example.com","boss@example.com"]')
      expect(row.from_email).toBe('shop@acme.com')
      expect(row.from_name).toBe('Acme Store')
      expect(row.subject).toBe('Your parcel is on its way')
      expect(row.body_html).toBe('<p>Hi Jane</p>')
      expect(JSON.parse(row.payload as string)).toEqual({
        customerName: 'Jane',
        items: [{ name: 'Mug', qty: 2 }],
      })
      expect(row.provider).toBe('resend')
      expect(row.provider_message_id).toBe('msg_1')
      expect(row.status).toBe('sent')
      expect(row.source).toBe('workflow')
      expect(row.order_id).toBe('5f2b1a1e-8d7f-4c2e-9a1b-2c3d4e5f6a7b')
      // A non-UUID never reaches a UUID column (22P02 would fail the insert).
      expect(row.user_id).toBeNull()
      expect(Object.keys(row)).not.toContain('apiKey')
      expect(queries[0].values.join(' ')).not.toContain('sk_live_secret')
    } finally {
      restore()
    }
  })

  it('redacts token-bearing parameters in the payload AND scrubs their values from the body', async () => {
    const { api, queries, restore } = loadModule({})
    try {
      await api.recordSentEmail({
        emailType: 'forgot-password',
        to: 'jane@example.com',
        subject: 'Reset',
        html: '<a href="https://shop.test/reset?token=abcdef123456">Reset</a>',
        payload: [
          { key: 'resetUrl', value: 'https://shop.test/reset?token=abcdef123456' },
          { key: 'userName', value: 'Jane' },
        ],
        source: 'workflow',
      })
      const row = rowOf(queries[0])
      expect(JSON.parse(row.payload as string)).toEqual({
        resetUrl: '[redacted]',
        userName: 'Jane',
      })
      expect(row.body_html).toBe('<a href="[redacted]">Reset</a>')
    } finally {
      restore()
    }
  })

  it('records nothing without a recipient, and never rejects', async () => {
    const { api, queries, restore } = loadModule({})
    try {
      await expect(api.recordSentEmail({ emailType: 'x', to: '', html: 'a' })).resolves.toBe(false)
      await expect(api.recordSentEmail(null)).resolves.toBe(false)
      expect(queries).toHaveLength(0)
    } finally {
      restore()
    }
  })

  it('disables itself for the process once the table is missing (42P01)', async () => {
    const { api, queries, restore } = loadModule({
      queryImpl: async () => {
        const err: any = new Error('relation "teleport_sent_emails" does not exist')
        err.code = '42P01'
        throw err
      },
    })
    try {
      await expect(api.recordSentEmail({ to: 'a@b.c', html: 'x' })).resolves.toBe(false)
      await expect(api.recordSentEmail({ to: 'a@b.c', html: 'x' })).resolves.toBe(false)
      expect(queries).toHaveLength(1)
    } finally {
      restore()
    }
  })

  it('keeps trying through transient failures and gives up after three in a row', async () => {
    let calls = 0
    const { api, queries, restore } = loadModule({
      queryImpl: async () => {
        calls += 1
        throw new Error('connection reset')
      },
    })
    try {
      for (let i = 0; i < 5; i++) {
        await api.recordSentEmail({ to: 'a@b.c', html: 'x' })
      }
      expect(calls).toBe(3)
      expect(queries).toHaveLength(3)
    } finally {
      restore()
    }
  })

  it('is a no-op when the pg driver is not installed or no database is configured', async () => {
    const withoutPg = loadModule({ pgAvailable: false })
    try {
      await expect(withoutPg.api.recordSentEmail({ to: 'a@b.c', html: 'x' })).resolves.toBe(false)
      expect(withoutPg.queries).toHaveLength(0)
    } finally {
      withoutPg.restore()
    }
    const withoutDb = loadModule({})
    try {
      delete process.env.TELEPORT_DB_CONNECTION_STRING
      delete process.env.TELEPORT_DB_HOST
      await expect(withoutDb.api.recordSentEmail({ to: 'a@b.c', html: 'x' })).resolves.toBe(false)
      expect(withoutDb.queries).toHaveLength(0)
    } finally {
      withoutDb.restore()
    }
  })

  it('caps an oversized body and payload with a marker instead of failing', async () => {
    const { api, queries, restore } = loadModule({})
    try {
      await api.recordSentEmail({
        to: 'a@b.c',
        html: 'x'.repeat(1000100),
        payload: { blob: 'y'.repeat(300000) },
      })
      const row = rowOf(queries[0])
      expect((row.body_html as string).length).toBeLessThan(1000200)
      expect(row.body_html).toContain('truncated by sent-email-log')
      expect(row.payload).toContain('truncated by sent-email-log')
    } finally {
      restore()
    }
  })

  it('settleSentEmailLog waits for every in-flight record', async () => {
    let release: () => void = () => undefined
    const { api, queries, restore } = loadModule({
      queryImpl: () =>
        new Promise((resolve) => {
          release = () => resolve({ rowCount: 1 })
        }),
    })
    try {
      const pending = api.recordSentEmail({ to: 'a@b.c', html: 'x' })
      let settled = false
      const settle = api.settleSentEmailLog().then(() => {
        settled = true
      })
      await new Promise((r) => setTimeout(r, 5))
      expect(settled).toBe(false)
      release()
      await pending
      await settle
      expect(settled).toBe(true)
      expect(queries).toHaveLength(1)
    } finally {
      restore()
    }
  })

  describe('wrapEmailNodeHandler', () => {
    it('records after the handler resolves and registers the record on the workflow context queue', async () => {
      const { api, queries, restore } = loadModule({})
      try {
        const handler = jest.fn(async () => ({ id: 'rs_1', success: true }))
        const wrapped = api.wrapEmailNodeHandler('email-resend', handler)
        const context: any = { __pendingNodePromises: [] }
        const config = {
          to: ['a@b.c'],
          from: 'shop@acme.com',
          subject: 'Hi',
          body: '<p>x</p>',
          emailPurpose: 'welcome',
          emailAudience: 'customer',
          apiKey: 'secret',
        }
        const result = await wrapped(config, context)
        expect(result).toEqual({ id: 'rs_1', success: true })
        expect(context.__pendingNodePromises).toHaveLength(1)
        await Promise.all(context.__pendingNodePromises)
        const row = rowOf(queries[0])
        expect(row.email_type).toBe('welcome')
        expect(row.audience).toBe('customer')
        expect(row.provider).toBe('resend')
        expect(row.provider_message_id).toBe('rs_1')
        expect(row.source).toBe('workflow')
        expect(row.source_ref).toBe('email-resend')
        expect(row.status).toBe('sent')
      } finally {
        restore()
      }
    })

    it('records a failed attempt when the handler reports failure or throws, and rethrows', async () => {
      const { api, queries, restore } = loadModule({})
      try {
        const refused = api.wrapEmailNodeHandler('email-postmark', async () => ({
          id: '',
          success: false,
          error: 'domain not verified',
        }))
        const ctx1: any = {}
        await refused({ to: 'a@b.c', body: 'x' }, ctx1)
        await Promise.all(ctx1.__pendingNodePromises)
        expect(rowOf(queries[0]).status).toBe('failed')
        expect(rowOf(queries[0]).error_message).toBe('domain not verified')

        const thrown = api.wrapEmailNodeHandler('email-sendgrid', async () => {
          throw new Error('boom')
        })
        const ctx2: any = {}
        await expect(thrown({ to: 'a@b.c', body: 'x' }, ctx2)).rejects.toThrow('boom')
        await Promise.all(ctx2.__pendingNodePromises)
        expect(rowOf(queries[1]).status).toBe('failed')
        expect(rowOf(queries[1]).error_message).toBe('boom')
      } finally {
        restore()
      }
    })

    it('records an integration node only for its send-email action, and forwards extra arguments', async () => {
      const { api, queries, restore } = loadModule({})
      try {
        const calls: unknown[][] = []
        const handler = async (...args: unknown[]) => {
          calls.push(args)
          return { success: true, message: { id: 'gm_1' } }
        }
        const wrapped = api.wrapEmailNodeHandler('integration-gmail', handler)
        const ctx: any = {}
        const onChunk = noop
        await wrapped({ action: 'list-messages' }, ctx, onChunk)
        expect(calls[0]).toHaveLength(3)
        expect(ctx.__pendingNodePromises).toBeUndefined()

        await wrapped({ action: 'send-email', to: 'a@b.c', subject: 's', body: '<p>b</p>' }, ctx)
        await Promise.all(ctx.__pendingNodePromises)
        expect(queries).toHaveLength(1)
        expect(rowOf(queries[0]).provider).toBe('gmail')
        expect(rowOf(queries[0]).provider_message_id).toBe('gm_1')
        expect(rowOf(queries[0]).email_type).toBe('custom')
      } finally {
        restore()
      }
    })
  })

  it('emits a same-shaped no-op module for a non-Postgres data source', async () => {
    const code = generateSentEmailLogCode({ pgSupported: false })
    const module = { exports: {} as any }
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', code)(module, module.exports)
    expect(code).not.toContain("require('pg')")
    await expect(module.exports.recordSentEmail({ to: 'a@b.c' })).resolves.toBe(false)
    await expect(module.exports.settleSentEmailLog()).resolves.toBeUndefined()
    const handler = async () => 1
    expect(module.exports.wrapEmailNodeHandler('email-resend', handler)).toBe(handler)
  })
})
