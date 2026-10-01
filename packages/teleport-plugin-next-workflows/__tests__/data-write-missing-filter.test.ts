import { generateDataAPIRoute } from '../src/data-api-route-generator'
import { loadHandler } from './_helpers/load-handler'

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

  it('matches no row for an empty list', () => {
    expect(buildWhereClause([{ field: 'id', value: [] }], [], 1, { strict: true }).clause).toBe(
      ' WHERE FALSE'
    )
  })

  it('keeps a read lenient: an optional filter without a value is left out', () => {
    expect(buildWhereClause([{ field: 'email' }], [], 1).clause).toBe('')
  })
})
