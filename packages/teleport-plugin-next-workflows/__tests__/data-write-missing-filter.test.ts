import { generateDataAPIRoute } from '../src/data-api-route-generator'
import { loadHandler } from './_helpers/load-handler'
import { isSecurityRuntimeSpecifier, loadSecurityRuntime } from './_helpers/load-security-runtime'

// An UPDATE or DELETE whose filter lost its value — its binding produced
// nothing, or the hand-off to the server dropped it — used to leave the filter
// OUT, so one request rewrote every row of the table (every user's password).
// The write nodes now do nothing, and the data API refuses such a write from
// any caller.

interface FetchCall {
  url: string
  body: Record<string, unknown>
}

function withFetch(calls: FetchCall[]): () => void {
  const original = (globalThis as any).fetch
  ;(globalThis as any).fetch = async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return { ok: true, json: async () => ({ updatedCount: 1, deletedCount: 1 }) }
  }
  return () => {
    ;(globalThis as any).fetch = original
  }
}

describe.each([
  ['data-update-item', { columnMappings: [{ column: 'password', value: 'hash' }] }],
  ['data-delete-item', {}],
])('%s with a filter that has no value', (nodeType, extra) => {
  const handler = loadHandler(nodeType)
  const config = (value: unknown) => ({
    dataSourceId: 'ds',
    tableName: 'users',
    filters: [{ field: 'email', operator: '=', value }],
    ...extra,
  })

  it.each([
    ['missing', undefined],
    ['cut off in the hand-off', { __truncated: true, type: 'string' }],
  ])('changes nothing when the value is %s', async (_label, value) => {
    const calls: FetchCall[] = []
    const restore = withFetch(calls)
    try {
      const result = (await handler(config(value), { __baseUrl: 'http://x' })) as Record<
        string,
        unknown
      >
      expect(calls).toHaveLength(0)
      expect(result).toMatchObject({ __skippedMissingFilter: true, success: true })
    } finally {
      restore()
    }
  })

  it('still writes when every filter has a value', async () => {
    const calls: FetchCall[] = []
    const restore = withFetch(calls)
    try {
      await handler(config('owner@shop.test'), { __baseUrl: 'http://x' })
      expect(calls).toHaveLength(1)
      expect(calls[0].body.filters).toEqual([
        { field: 'email', operator: '=', value: 'owner@shop.test' },
      ])
    } finally {
      restore()
    }
  })
})

describe('data API — the WHERE clause of an UPDATE or DELETE', () => {
  const code = generateDataAPIRoute()
  const pick = (name: string): string => {
    const start = code.indexOf(`function ${name}(`)
    const end = code.indexOf('\n}\n', start)
    return code.slice(start, end + 2)
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const buildWhereClause = new Function(
    'validateFilters',
    [
      pick('isMissingFilterValue'),
      pick('refuseUnscopedWrite'),
      pick('refuseUnfilteredWrite'),
      pick('isSkippableFilterValue'),
      pick('isAllSentinelFilterValue'),
      pick('buildWhereClause'),
      'return buildWhereClause;',
    ].join('\n')
  )(() => undefined) as (
    filters: unknown[],
    params: unknown[],
    start: number,
    options?: Record<string, unknown>
  ) => { clause: string }

  it('uses the strict clause for every UPDATE and DELETE', () => {
    expect(code.match(/buildWhereClause\([^)]*\{ strict: true \}\)/g)).toHaveLength(2)
  })

  it('refuses a filter with no value instead of leaving it out', () => {
    expect(() =>
      buildWhereClause([{ field: 'email', operator: '=' }], [], 1, { strict: true })
    ).toThrow('Refused: the filter on "email" has no value')
    expect(() =>
      buildWhereClause([{ field: 'email', value: { __truncated: true } }], [], 1, { strict: true })
    ).toThrow('Refused')
    expect(() => buildWhereClause([{ value: 'x' }], [], 1, { strict: true })).toThrow('Refused')
  })

  it('refuses a write with no filter', () => {
    expect(() => buildWhereClause([], [], 1, { strict: true })).toThrow(
      'Refused: no filter limits this write, so it would change every row.'
    )
    expect(() => buildWhereClause(undefined as any, [], 1, { strict: true })).toThrow('Refused')
  })

  it('refuses a write whose every filter adds no condition', () => {
    expect(() =>
      buildWhereClause([{ field: 'id', operator: '>', value: null }], [], 1, { strict: true })
    ).toThrow('Refused: no filter limits this write')
  })

  it('keeps a read with no filter unscoped', () => {
    expect(buildWhereClause([], [], 1).clause).toBe('')
  })

  it('matches no row for an empty list', () => {
    expect(buildWhereClause([{ field: 'id', value: [] }], [], 1, { strict: true }).clause).toBe(
      ' WHERE FALSE'
    )
  })

  it('keeps a read lenient: an optional filter without a value is left out', () => {
    expect(buildWhereClause([{ field: 'email' }], [], 1).clause).toBe('')
  })
})

describe('data API route — an UPDATE or DELETE names the rows it changes', () => {
  const SECRET = 'server-secret'
  const securityRuntime = loadSecurityRuntime()
  const statements: string[] = []

  class FakeClient {
    public async connect(): Promise<void> {
      return
    }
    public async end(): Promise<void> {
      return
    }
    public async query(sql: string): Promise<{ rows: any[]; rowCount: number }> {
      statements.push(sql)
      return /^(UPDATE|DELETE)/.test(sql)
        ? { rows: [{ id: 'r-1', points: 5 }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    }
  }

  const moduleObj: { exports: any } = { exports: {} }
  // tslint:disable-next-line:function-constructor
  new Function('require', 'module', 'exports', 'process', 'console', generateDataAPIRoute())(
    (name: string): any => {
      if (name === 'pg') {
        return { Client: FakeClient }
      }
      if (name === 'next-auth/jwt') {
        return { getToken: async (): Promise<null> => null }
      }
      if (isSecurityRuntimeSpecifier(name)) {
        return securityRuntime
      }
      throw new Error('unexpected require: ' + name)
    },
    moduleObj,
    moduleObj.exports,
    { env: { NEXTAUTH_SECRET: SECRET, TELEPORT_DB_CONNECTION_STRING: 'postgresql://x' } },
    {
      error: (): undefined => undefined,
      warn: (): undefined => undefined,
      log: (): undefined => undefined,
    }
  )

  const call = async (operation: string, body: Record<string, unknown>) => {
    statements.length = 0
    const reply: { status: number; body: any } = { status: 0, body: null }
    await moduleObj.exports(
      {
        method: 'POST',
        query: { params: ['ds-1', operation] },
        headers: { 'x-internal-data-secret': SECRET },
        body,
      },
      {
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
    return { ...reply, writes: statements.filter((sql) => /^(UPDATE|DELETE)/.test(sql)) }
  }

  const update = { tableName: 'loyalty_members', columnMappings: { points: 5 } }

  it.each([
    ['update', { ...update }],
    ['update', { ...update, filters: [] }],
    ['delete', { tableName: 'follows' }],
    ['delete', { tableName: 'follows', filters: [] }],
  ])('%s with no filter is refused and changes nothing', async (operation, body) => {
    const reply = await call(operation, body)
    expect(reply.status).toBe(400)
    expect(reply.body.error).toBe(
      'Refused: no filter limits this write, so it would change every row.'
    )
    expect(reply.writes).toEqual([])
  })

  it('still runs an UPDATE and a DELETE that name their rows', async () => {
    const updated = await call('update', {
      ...update,
      filters: [{ field: 'id', operator: '=', value: 'r-1' }],
    })
    expect(updated.status).toBe(200)
    expect(updated.writes).toEqual([
      'UPDATE loyalty_members SET points = $1 WHERE id = $2 RETURNING *',
    ])

    const deleted = await call('delete', {
      tableName: 'follows',
      filters: [{ field: 'id', operator: '=', value: 'r-1' }],
    })
    expect(deleted.status).toBe(200)
    expect(deleted.writes).toEqual(['DELETE FROM follows WHERE id = $1'])
  })
})
