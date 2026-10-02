import { loadHandler } from './_helpers/load-handler'

// A statement that raises on purpose (a seat race lost, a slot taken) is told
// apart from a broken one by the SQLSTATE the data route answers with — the
// route keeps the database's message in its own log, so the code is all a
// workflow can read.

async function runAgainst(response: { ok: boolean; body: unknown }): Promise<any> {
  const fetchMock = jest.fn(async () => ({
    ok: response.ok,
    json: async () => response.body,
  }))
  const originalFetch = (globalThis as any).fetch
  ;(globalThis as any).fetch = fetchMock
  try {
    const handler = loadHandler('data-raw-query')
    return await handler({ dataSourceId: 'ds', query: 'SELECT 1', params: [] }, {})
  } finally {
    ;(globalThis as any).fetch = originalFetch
  }
}

describe('data-raw-query — a database error reaches the workflow with its SQLSTATE', () => {
  it('passes the route’s code on beside the error', async () => {
    const result = await runAgainst({
      ok: false,
      body: { error: 'Internal server error', code: '2203A' },
    })
    expect(result).toEqual({
      rows: [],
      result: [],
      error: 'Internal server error',
      code: '2203A',
    })
  })

  it('answers no code when the route gave none', async () => {
    const result = await runAgainst({ ok: false, body: { error: 'INVALID_SQL_IDENTIFIER' } })
    expect(result).toEqual({ rows: [], result: [], error: 'INVALID_SQL_IDENTIFIER' })
    expect('code' in result).toBe(false)
  })

  it('answers the rows of a statement that went through', async () => {
    const result = await runAgainst({ ok: true, body: { rows: [{ code: 'ok' }] } })
    expect(result).toEqual({ rows: [{ code: 'ok' }], result: [{ code: 'ok' }] })
  })
})
