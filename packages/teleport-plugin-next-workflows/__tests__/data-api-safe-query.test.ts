import { generateDataAPIRoute } from '../src/data-api-route-generator'

// Regression guard for "Stripe webhook 500s because metadata.orderId
// is empty string and the workflow's SELECT runs `WHERE id = ''` —
// Postgres rejects with `22P02 invalid input syntax for type uuid`".
//
// The generic fix lives in /api/data/[...params].js: every
// `client.query()` that filters on user-supplied values is wrapped
// in a `safeQuery` helper that catches the small set of Postgres
// type-coercion error codes (UUID, integer, date, numeric out of
// range, parameter type mismatch) and degrades to an empty result
// instead of throwing. Empty results are the correct semantics for
// the "filter value would never have matched a real row anyway"
// case — and they let upstream workflow code take its "not found"
// branch cleanly instead of crashing the request.

describe('data-api safeQuery wrapper — defends against Postgres type-coercion errors', () => {
  const code = generateDataAPIRoute()

  it('emits a SAFE_COERCION_ERROR_CODES set listing every code we degrade for', () => {
    expect(code).toContain('SAFE_COERCION_ERROR_CODES')
    // 22P02 = invalid_text_representation (uuid / integer / json coercion failure)
    expect(code).toContain("'22P02'")
    // 22008 = datetime out of range
    expect(code).toContain("'22008'")
    // 22003 = numeric out of range
    expect(code).toContain("'22003'")
    // 22023 = invalid parameter value (e.g. wrong parameter shape)
    expect(code).toContain("'22023'")
  })

  it('emits a safeQuery helper that returns empty rows for SELECT mode', () => {
    expect(code).toContain('async function safeQuery(client, sql, params, mode)')
    expect(code).toMatch(/return\s*\{\s*rows:\s*\[\s*\],\s*rowCount:\s*0\s*\}/)
  })

  it('emits a count-specific empty result so callers parsing rows[0].count still work', () => {
    // The COUNT path reads `result.rows[0].count` — returning `rows: []`
    // would crash with "Cannot read properties of undefined" downstream.
    // safeQuery must give the count caller `rows: [{ count: '0' }]`.
    expect(code).toMatch(/rows:\s*\[\s*\{\s*count:\s*'0'\s*\}\s*\]/)
  })

  it('logs the suppressed error with the SQL and params so the user can still diagnose', () => {
    // We deliberately don't swallow silently — the warn lets the merchant
    // figure out which upstream node fed in the bad value.
    expect(code).toContain('[data-api] suppressed Postgres coercion error')
    expect(code).toContain('JSON.stringify(params)')
  })

  it('rethrows errors with codes outside the safe set so real bugs still surface', () => {
    expect(code).toContain('throw err')
  })

  it('handleSelect routes the main query through safeQuery', () => {
    expect(code).toMatch(
      /var\s+result\s*=\s*await\s+safeQuery\(client,\s*sql,\s*queryParams,\s*'select'\)/
    )
  })

  it('handleSelect routes the COUNT query through safeQuery', () => {
    expect(code).toMatch(/safeQuery\(client,\s*countSql,\s*countParams,\s*'count'\)/)
  })

  it('handleCount routes its query through safeQuery', () => {
    expect(code).toMatch(/safeQuery\(client,\s*sql,\s*queryParams,\s*'count'\)/)
  })

  it('handleUpdate routes its query through safeQuery (degrades to 0 updated)', () => {
    expect(code).toMatch(/safeQuery\(client,\s*sql,\s*queryParams,\s*'update'\)/)
  })

  it('handleDelete routes its query through safeQuery', () => {
    expect(code).toMatch(/safeQuery\(client,\s*sql,\s*queryParams,\s*'delete'\)/)
  })

  it('handleRawQuery routes through safeQuery so workflow-level raw SELECTs also degrade gracefully', () => {
    // Now binds the resolved `params` array (positional $N binds) rather than a
    // hardcoded empty array — see raw-query-param-binding.test.ts.
    expect(code).toMatch(/safeQuery\(client,\s*query,\s*params,\s*'raw-query'\)/)
  })

  it('handleCreate is NOT wrapped (an INSERT failing on a bad UUID is a real error, not "no match")', () => {
    // The INSERT path already has its own UUID coercion (the previous
    // regression). Wrapping it would mask a programming bug where the
    // caller sends an invalid UUID *value* — that should still 500.
    // Check by counting safeQuery occurrences and confirming the
    // INSERT site is NOT among them.
    const insertSection = code.slice(
      code.indexOf('async function handleCreate'),
      code.indexOf('async function handleUpdate')
    )
    expect(insertSection).not.toContain('safeQuery(')
    // The plain client.query in handleCreate must still be present
    expect(insertSection).toMatch(/await\s+client\.query\(sql,\s*values\)/)
  })
})

describe('data-api safeQuery — runtime semantics', () => {
  const code = generateDataAPIRoute()
  // Eval the safeQuery helper out of the emitted file and verify it
  // behaves as we expect against a fake client.
  const evalFn = () => {
    const startTag = 'async function safeQuery'
    const start = code.indexOf(startTag)
    // Find the matching closing brace via depth counting
    let depth = 0
    let i = code.indexOf('{', start)
    for (; i < code.length; i++) {
      if (code[i] === '{') {
        depth++
      } else if (code[i] === '}') {
        depth--
        if (depth === 0) {
          break
        }
      }
    }
    const fnSrc = code.slice(start, i + 1)
    // Also extract the SAFE_COERCION_ERROR_CODES constant
    const codesStart = code.indexOf('var SAFE_COERCION_ERROR_CODES')
    const codesEnd = code.indexOf(';', codesStart)
    const codesSrc = code.slice(codesStart, codesEnd + 1)
    return new Function(codesSrc + '\n' + fnSrc + '\nreturn safeQuery;')() as any
  }
  const safeQuery = evalFn()

  it('returns rows:[] when client.query throws code 22P02', async () => {
    const fakeClient = {
      query: async () => {
        const e: any = new Error('invalid input syntax for type uuid: ""')
        e.code = '22P02'
        throw e
      },
    }
    const r = await safeQuery(fakeClient, 'SELECT *', [], 'select')
    expect(r).toEqual({ rows: [], rowCount: 0 })
  })

  it('returns count "0" envelope for count mode', async () => {
    const fakeClient = {
      query: async () => {
        const e: any = new Error('invalid')
        e.code = '22P02'
        throw e
      },
    }
    const r = await safeQuery(fakeClient, 'SELECT COUNT(*)', [], 'count')
    expect(r.rows[0].count).toBe('0')
  })

  it('rethrows non-coercion errors verbatim (real bugs still surface)', async () => {
    const fakeClient = {
      query: async () => {
        const e: any = new Error('relation "missing" does not exist')
        e.code = '42P01'
        throw e
      },
    }
    await expect(safeQuery(fakeClient, 'SELECT *', [], 'select')).rejects.toThrow(
      /relation "missing"/
    )
  })

  it('passes through successful results', async () => {
    const fakeClient = {
      query: async () => ({ rows: [{ a: 1 }], rowCount: 1 }),
    }
    const r = await safeQuery(fakeClient, 'SELECT *', [], 'select')
    expect(r.rowCount).toBe(1)
    expect(r.rows[0].a).toBe(1)
  })

  it('also degrades on 22008 (datetime out of range)', async () => {
    const fakeClient = {
      query: async () => {
        const e: any = new Error('bad date')
        e.code = '22008'
        throw e
      },
    }
    expect((await safeQuery(fakeClient, 'SELECT', [], 'select')).rows).toEqual([])
  })

  it('also degrades on 22003 (numeric out of range)', async () => {
    const fakeClient = {
      query: async () => {
        const e: any = new Error('numeric')
        e.code = '22003'
        throw e
      },
    }
    expect((await safeQuery(fakeClient, 'SELECT', [], 'select')).rows).toEqual([])
  })

  it('does NOT swallow a coercion error that has no code (e.g. arbitrary throw)', async () => {
    const fakeClient = {
      query: async () => {
        throw new Error('plain')
      },
    }
    await expect(safeQuery(fakeClient, 'SELECT', [], 'select')).rejects.toThrow('plain')
  })
})
