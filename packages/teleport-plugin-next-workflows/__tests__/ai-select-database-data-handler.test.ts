import { aiSelectDatabaseData } from '../src/nodes/ai/ai-select-database-data'
import { generateSharedRuntimeUtilsCode } from '../src/executor-generator'

/**
 * The handler's result is serialized straight to the visitor's browser, so the
 * contract under test is as much about what it must NEVER contain (the
 * generated SQL, schema text, database error messages) as about what it
 * returns. The AI call and fetch are mocked by pre-defining the guarded
 * globals — the emitted `var X = typeof X !== 'undefined' ? X : …` pattern
 * keeps whatever is already in scope.
 */

interface MockState {
  aiResponses: string[]
  aiCalls: Array<{ systemMessage: string; userMessage: string; jsonMode: boolean }>
  fetchCalls: Array<{ url: string; body: { query: string; params: unknown[] } }>
  fetchResponse: { ok: boolean; json: unknown }
}

function loadHandler(state: MockState) {
  const mocks = `
    var __ai_callProvider = async function (params) {
      state.aiCalls.push({ systemMessage: params.systemMessage, userMessage: params.userMessage, jsonMode: params.jsonMode });
      var next = state.aiResponses.shift();
      if (next === '__throw__') { throw new Error('provider exploded'); }
      return { content: next };
    };
  `
  const source = aiSelectDatabaseData.generateServerHandler!()
  const fetchMock = async (url: string, init: { body: string }) => {
    state.fetchCalls.push({ url, body: JSON.parse(init.body) })
    return {
      ok: state.fetchResponse.ok,
      json: async () => state.fetchResponse.json,
    }
  }
  // eslint-disable-next-line no-new-func
  return new Function('state', 'fetch', `${mocks}\n${source}\nreturn ai_select_database_data;`)(
    state,
    fetchMock
  ) as (config: unknown, context: Record<string, unknown>) => Promise<any>
}

function makeState(overrides: Partial<MockState> = {}): MockState {
  return {
    aiResponses: ['{"needsQuery": true, "query": "SELECT \\"id\\" FROM \\"teleport_products\\""}'],
    aiCalls: [],
    fetchCalls: [],
    fetchResponse: { ok: true, json: { rows: [{ id: '1' }, { id: '2' }] } },
    ...overrides,
  }
}

const BASE_CONFIG = {
  dataSourceId: 'ds1',
  allowedTables: ['teleport_products'],
  prompt: 'What is the cheapest product?',
  model: 'gpt-4o',
  token: 'sk-test',
  tableSchemas: [
    { table: 'teleport_products', columns: [{ name: 'id', type: 'uuid', nullable: false }] },
  ],
}

function loadIsFatalNodeResult(): (result: unknown) => boolean {
  const utilsModule = { exports: {} as { isFatalNodeResult: (result: unknown) => boolean } }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', generateSharedRuntimeUtilsCode())(
    utilsModule,
    utilsModule.exports,
    () => ({})
  )
  return utilsModule.exports.isFatalNodeResult
}

describe('happy path', () => {
  it('generates, validates, executes, and returns only { executed, rowCount, rows }', async () => {
    const state = makeState()
    const handler = loadHandler(state)
    const result = await handler(BASE_CONFIG, {})

    expect(result).toEqual({ executed: true, rowCount: 2, rows: [{ id: '1' }, { id: '2' }] })
    expect(state.aiCalls).toHaveLength(1)
    expect(state.aiCalls[0].jsonMode).toBe(true)
    expect(state.aiCalls[0].systemMessage).toContain('TABLE "teleport_products"')
    expect(state.fetchCalls).toHaveLength(1)
    expect(state.fetchCalls[0].url).toBe('/api/data/ds1/raw-query')
    // The executed SQL carries the enforced LIMIT
    expect(state.fetchCalls[0].body.query).toBe('SELECT "id" FROM "teleport_products" LIMIT 100')
  })

  it('respects the AI deciding no query is needed, without touching the database', async () => {
    const state = makeState({ aiResponses: ['{"needsQuery": false, "query": null}'] })
    const handler = loadHandler(state)
    const result = await handler(BASE_CONFIG, {})

    expect(result).toEqual({ executed: false, rows: [], rowCount: 0 })
    expect(state.fetchCalls).toHaveLength(0)
  })

  it('retries once with feedback when the first SQL is rejected', async () => {
    const state = makeState({
      aiResponses: [
        '{"needsQuery": true, "query": "DELETE FROM \\"teleport_products\\""}',
        '{"needsQuery": true, "query": "SELECT \\"id\\" FROM \\"teleport_products\\" LIMIT 5"}',
      ],
    })
    const handler = loadHandler(state)
    const result = await handler(BASE_CONFIG, {})

    expect(result.executed).toBe(true)
    expect(state.aiCalls).toHaveLength(2)
    expect(state.aiCalls[1].userMessage).toContain('was rejected')
  })
})

describe('failure contract — nothing sensitive ever leaves the handler', () => {
  const flatten = (value: unknown): string => JSON.stringify(value)

  it('rejected SQL on both attempts fails closed with a fixed code', async () => {
    const bad = '{"needsQuery": true, "query": "DELETE FROM \\"teleport_products\\""}'
    const state = makeState({ aiResponses: [bad, bad] })
    const handler = loadHandler(state)
    const result = await handler(BASE_CONFIG, {})

    expect(result).toEqual({
      error: true,
      message: 'AI database query failed (sql_rejected)',
      code: 'sql_rejected',
    })
    expect(flatten(result)).not.toContain('DELETE')
    expect(flatten(result)).not.toContain('teleport_products')
  })

  it('never forwards the data route error body (pg errors quote the SQL)', async () => {
    const state = makeState({
      fetchResponse: {
        ok: false,
        json: { error: 'syntax error at or near "SELECT \\"id\\" FROM teleport_products"' },
      },
    })
    const handler = loadHandler(state)
    const result = await handler(BASE_CONFIG, {})

    expect(result.code).toBe('query_failed')
    expect(flatten(result)).not.toContain('syntax error')
    expect(flatten(result)).not.toContain('SELECT')
  })

  it('optional: true converts every failure into skipped data', async () => {
    const state = makeState({ aiResponses: ['__throw__'] })
    const handler = loadHandler(state)
    const result = await handler({ ...BASE_CONFIG, optional: true }, {})

    expect(result).toEqual({
      executed: false,
      rows: [],
      rowCount: 0,
      skipped: true,
      skipReason: 'provider_error',
    })
  })

  it('missing configuration fails before any AI call', async () => {
    const state = makeState()
    const handler = loadHandler(state)
    const result = await handler({ ...BASE_CONFIG, allowedTables: [] }, {})

    expect(result.code).toBe('missing_configuration')
    expect(state.aiCalls).toHaveLength(0)
  })

  it('the executor treats default failures as fatal and optional ones as data', async () => {
    const isFatalNodeResult = loadIsFatalNodeResult()
    const bad = '{"needsQuery": true, "query": "DELETE FROM \\"teleport_products\\""}'

    const fatalState = makeState({ aiResponses: [bad, bad] })
    const fatal = await loadHandler(fatalState)(BASE_CONFIG, {})
    const optionalState = makeState({ aiResponses: [bad, bad] })
    const optional = await loadHandler(optionalState)({ ...BASE_CONFIG, optional: true }, {})

    expect(isFatalNodeResult(fatal)).toBe(true)
    expect(isFatalNodeResult(optional)).toBe(false)
  })
})

describe('registration', () => {
  it('is a server node so its config (schemas, allowlist) is redacted from client bundles', () => {
    expect(aiSelectDatabaseData.executionEnv).toBe('server')
  })
})
