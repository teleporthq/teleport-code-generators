import { generateDataAPIRoute } from '../src/data-api-route-generator'
import { generateSharedRuntimeUtilsCode } from '../src'
import { analyzeRawQueryParameterization } from '../src/sql-query-validator'
import { loadHandler } from './_helpers/load-handler'

// SQL-INJECTION SECURITY regression guard.
//
// The generation-time net rewrites every {{state.X}}/{{Current User.id}}/…
// VALUE interpolation in a raw-SQL node into a positional $N placeholder and
// moves the {{…}} token into a sibling `params` (data-raw-query) /
// `rawQueryUserPartParams` (data-select) array. This suite proves the PUBLISHED
// app honours that contract end-to-end:
//   1. the executor node handlers FORWARD the resolved params array to the API,
//   2. the values are BOUND ($N) at runtime — never interpolated into SQL text,
//   3. the validator treats the parameterized form as SAFE and still flags a
//      legacy {{…}}-in-SQL query.

type SharedUtils = {
  resolveConfig: (cfg: unknown, ctx: Record<string, unknown>) => any
}

function loadSharedRuntime(): SharedUtils {
  const src = generateSharedRuntimeUtilsCode()
  const wrapper: { exports: Record<string, unknown> } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', src)(wrapper, wrapper.exports)
  return wrapper.exports as unknown as SharedUtils
}

async function captureRawQueryFetchBody(config: unknown): Promise<any> {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({ rows: [] }),
  }))
  const originalFetch = (globalThis as any).fetch
  ;(globalThis as any).fetch = fetchMock
  try {
    const handler = loadHandler('data-raw-query')
    await handler(config, {})
    return JSON.parse((fetchMock.mock.calls[0] as any[])[1].body)
  } finally {
    ;(globalThis as any).fetch = originalFetch
  }
}

async function captureSelectFetchBody(config: unknown): Promise<any> {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({ rows: [], count: 0 }),
  }))
  const originalFetch = (globalThis as any).fetch
  ;(globalThis as any).fetch = fetchMock
  try {
    const handler = loadHandler('data-select')
    await handler(config, {})
    return JSON.parse((fetchMock.mock.calls[0] as any[])[1].body)
  } finally {
    ;(globalThis as any).fetch = originalFetch
  }
}

describe('raw-query param binding — executor node handlers forward the bound params', () => {
  it('data-raw-query POSTs { query, params } with $N SQL and the values in params', async () => {
    const body = await captureRawQueryFetchBody({
      dataSourceId: 'ds1',
      query: 'SELECT * FROM products WHERE name ILIKE $1',
      params: ['oak desk'],
    })
    expect(body.query).toBe('SELECT * FROM products WHERE name ILIKE $1')
    expect(body.params).toEqual(['oak desk'])
    // The value must NOT appear anywhere in the SQL text.
    expect(body.query).not.toContain('oak desk')
  })

  it('resolves the {{state.X}} token INTO the params array (not the SQL) — injection is neutralised', async () => {
    const utils = loadSharedRuntime()
    // Attacker-controlled search term that would break out of a string literal
    // if it were interpolated into the SQL text.
    const injection = "x'; DROP TABLE products; --"
    const resolved = utils.resolveConfig(
      {
        dataSourceId: 'ds1',
        query: 'SELECT * FROM products WHERE name ILIKE $1',
        params: ['{{state.searchQuery}}'],
      },
      { __stateValues: { searchQuery: injection } }
    )
    // resolveConfig substitutes the {{…}} token to the concrete value in params.
    expect(resolved.params).toEqual([injection])
    // The SQL text is untouched — still just the $1 placeholder.
    expect(resolved.query).toBe('SELECT * FROM products WHERE name ILIKE $1')

    const body = await captureRawQueryFetchBody(resolved)
    expect(body.query).toBe('SELECT * FROM products WHERE name ILIKE $1')
    expect(body.params).toEqual([injection])
    expect(body.query).not.toContain('DROP TABLE')
  })

  it('data-raw-query stays backward-compatible: a static query with no params sends params: []', async () => {
    const body = await captureRawQueryFetchBody({
      dataSourceId: 'ds1',
      query: 'SELECT COUNT(*) FROM products',
    })
    expect(body.query).toBe('SELECT COUNT(*) FROM products')
    expect(body.params).toEqual([])
  })

  it('data-select forwards rawQueryUserPartParams alongside a $N rawQueryUserPart override', async () => {
    const body = await captureSelectFetchBody({
      dataSourceId: 'ds1',
      tableName: 'products',
      rawQueryUserPart: 'SELECT * FROM products WHERE owner = $1',
      rawQueryUserPartParams: ['user-42'],
    })
    expect(body.rawQueryUserPart).toBe('SELECT * FROM products WHERE owner = $1')
    expect(body.rawQueryUserPartParams).toEqual(['user-42'])
  })
})

describe('raw-query param binding — generated data-API route binds, never interpolates', () => {
  const code = generateDataAPIRoute()

  it('handleRawQuery extracts body.params and binds them through safeQuery', () => {
    expect(code).toMatch(
      /var\s+params\s*=\s*Array\.isArray\(body\.params\)\s*\?\s*body\.params\s*:\s*\[\s*\]/
    )
    expect(code).toMatch(/safeQuery\(client,\s*query,\s*params,\s*'raw-query'\)/)
  })

  it('handleRawQuery derives its SQL ONLY from body.query — no param value is spliced into the text', () => {
    const start = code.indexOf('async function handleRawQuery')
    const end = code.indexOf('async function assertSessionOwnsUsersRow')
    const section = code.slice(start, end)
    // query is assigned verbatim from the body and never re-concatenated with params.
    expect(section).toContain('var query = body.query;')
    expect(section).not.toMatch(/query\s*\+\s*params/)
    expect(section).not.toMatch(/params.*\+\s*query/)
  })

  it("handleSelect's raw override binds rawQueryUserPartParams instead of a hardcoded empty array", () => {
    expect(code).toMatch(
      /queryParams\s*=\s*Array\.isArray\(body\.rawQueryUserPartParams\)\s*\?\s*body\.rawQueryUserPartParams\s*:\s*\[\s*\]/
    )
  })

  it('handleRawQuery actually passes params to a parameterized client.query at runtime', async () => {
    const extractFunctionBlock = (src: string, tag: string): string => {
      const start = src.indexOf(tag)
      let depth = 0
      let i = src.indexOf('{', start)
      for (; i < src.length; i++) {
        if (src[i] === '{') {
          depth++
        } else if (src[i] === '}') {
          depth--
          if (depth === 0) {
            break
          }
        }
      }
      return src.slice(start, i + 1)
    }
    const blockStart = code.indexOf('var SAFE_COERCION_ERROR_CODES')
    const safeQueryStart = code.indexOf('async function safeQuery')
    const preamble = code.slice(blockStart, safeQueryStart)
    const safeQueryFn = extractFunctionBlock(code, 'async function safeQuery')
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const safeQuery = new Function(preamble + safeQueryFn + '\nreturn safeQuery;')() as any

    const calls: Array<{ sql: string; params: unknown[] }> = []
    const fakeClient = {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params })
        return { rows: [], rowCount: 0 }
      },
    }
    await safeQuery(
      fakeClient,
      'SELECT * FROM products WHERE name ILIKE $1',
      ["x'; DROP --"],
      'raw-query'
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toBe('SELECT * FROM products WHERE name ILIKE $1')
    expect(calls[0].params).toEqual(["x'; DROP --"])
  })
})

describe('sql-query-validator — analyzeRawQueryParameterization', () => {
  it('treats a $N-parameterized query as SAFE (zero warnings)', () => {
    const result = analyzeRawQueryParameterization(
      'SELECT * FROM products WHERE name ILIKE $1 AND owner = $2'
    )
    expect(result.isSafe).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('does NOT warn merely because the state lives in the params array', () => {
    // The function inspects only the SQL text; a {{…}} token in params is the
    // correct, safe home for it. A correctly-parameterized workflow → 0 warnings.
    expect(analyzeRawQueryParameterization('SELECT 1').isSafe).toBe(true)
  })

  it('WARNS on a legacy {{...}}-in-SQL-text interpolation', () => {
    const result = analyzeRawQueryParameterization(
      "SELECT * FROM products WHERE name = '{{state.searchQuery}}'"
    )
    expect(result.isSafe).toBe(false)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].ruleId).toBe('sql-unparameterized-context')
  })

  it('handles non-string / empty input as safe', () => {
    expect(analyzeRawQueryParameterization(undefined).isSafe).toBe(true)
    expect(analyzeRawQueryParameterization('').isSafe).toBe(true)
  })
})
