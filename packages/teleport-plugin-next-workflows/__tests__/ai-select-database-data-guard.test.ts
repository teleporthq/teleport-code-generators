import { generateAiSqlSelectGuard } from '../src/nodes/ai/ai-sql-select-guard'

/**
 * The guard is the ONLY thing standing between an AI model's output and the
 * database: the model can be prompt-injected into producing anything, so a
 * miss here is a write/exfiltration primitive, and an over-match breaks the
 * legitimate aggregate queries the node exists for (MIN/MAX/CASE…END).
 * Exercised exactly as the generated app defines it — by evaluating the
 * emitted source.
 */
function loadGuard() {
  // eslint-disable-next-line no-new-func
  return new Function(
    `${generateAiSqlSelectGuard()}
    return {
      validate: __aisql_validateSelectQuery,
      enforceLimit: __aisql_enforceLimit,
      buildSystemPrompt: __aisql_buildSystemPrompt,
    };`
  )() as {
    validate: (sql: string, allowedTables: string[]) => { valid: boolean; reason?: string }
    enforceLimit: (sql: string, maxRows: number) => string
    buildSystemPrompt: (tableSchemas: unknown, allowedTables: string[], maxRows: number) => string
  }
}

const { validate, enforceLimit, buildSystemPrompt } = loadGuard()
const ALLOWED = ['teleport_products', 'teleport_blog_posts']

describe('accepts the queries the node exists for', () => {
  it('plain SELECT over an allowed table', () => {
    expect(
      validate('SELECT "id", "name", "price" FROM "teleport_products" LIMIT 10', ALLOWED)
    ).toEqual({
      valid: true,
    })
  })

  it('aggregates and superlatives (MIN/MAX/ORDER BY … LIMIT 1)', () => {
    expect(
      validate(
        'SELECT "name", "price" FROM "teleport_products" ORDER BY "price" DESC LIMIT 1',
        ALLOWED
      ).valid
    ).toBe(true)
    expect(validate('SELECT MAX("price") FROM "teleport_products"', ALLOWED).valid).toBe(true)
    expect(validate('SELECT COUNT(*) FROM "teleport_blog_posts";', ALLOWED).valid).toBe(true)
  })

  it('CASE … END (the forms-worker validator regression)', () => {
    expect(
      validate(
        `SELECT "name", CASE WHEN "price" > 100 THEN 'premium' ELSE 'standard' END AS tier FROM "teleport_products"`,
        ALLOWED
      ).valid
    ).toBe(true)
  })

  it('WITH … SELECT over allowed tables, CTE referenced by name', () => {
    expect(
      validate(
        'WITH ranked AS (SELECT "name", "price" FROM "teleport_products") SELECT * FROM ranked ORDER BY "price" ASC LIMIT 1',
        ALLOWED
      ).valid
    ).toBe(true)
  })

  it('JOIN with an alias between allowed tables', () => {
    expect(
      validate(
        'SELECT p."name" FROM "teleport_products" p JOIN "teleport_blog_posts" b ON b."id" = p."id"',
        ALLOWED
      ).valid
    ).toBe(true)
  })

  it('set-returning functions in FROM are not table refs', () => {
    expect(
      validate(
        `SELECT kv.key FROM "teleport_products" p, jsonb_each_text(p."metadata") kv`,
        ALLOWED
      ).valid
    ).toBe(true)
  })

  it('keywords inside string literals do not false-positive', () => {
    expect(
      validate(`SELECT "name" FROM "teleport_products" WHERE "status" = 'deleted'`, ALLOWED).valid
    ).toBe(true)
    expect(
      validate(
        `SELECT "name" FROM "teleport_products" WHERE "description" = 'DROP by the store'`,
        ALLOWED
      ).valid
    ).toBe(true)
  })
})

describe('rejects everything that is not a single read-only SELECT', () => {
  const rejected = (sql: string, tables: string[] = ALLOWED) =>
    validate(sql, tables).valid === false

  it('writes and DDL', () => {
    expect(rejected(`INSERT INTO "teleport_products" ("name") VALUES ('x')`)).toBe(true)
    expect(rejected(`UPDATE "teleport_products" SET "price" = 0`)).toBe(true)
    expect(rejected(`DELETE FROM "teleport_products"`)).toBe(true)
    expect(rejected(`DROP TABLE "teleport_products"`)).toBe(true)
    expect(rejected(`SELECT * INTO backup FROM "teleport_products"`)).toBe(true)
  })

  it('stacked statements and comments', () => {
    expect(rejected(`SELECT 1; DELETE FROM "teleport_products"`)).toBe(true)
    expect(rejected(`SELECT "name" FROM "teleport_products" -- hidden`)).toBe(true)
    expect(rejected(`SELECT /* smuggle */ "name" FROM "teleport_products"`)).toBe(true)
  })

  it('system catalogs and pg_* objects', () => {
    expect(rejected(`SELECT * FROM information_schema.tables`)).toBe(true)
    expect(rejected(`SELECT * FROM pg_catalog.pg_tables`)).toBe(true)
    expect(rejected(`SELECT * FROM pg_stat_activity`)).toBe(true)
  })

  it('tables outside the allowlist, in FROM, JOIN, and subqueries', () => {
    expect(rejected(`SELECT * FROM "users"`)).toBe(true)
    expect(rejected(`SELECT * FROM "teleport_products" JOIN "users" u ON u."id" = 1`)).toBe(true)
    expect(
      rejected(`SELECT * FROM "teleport_products" WHERE "id" IN (SELECT "id" FROM "users")`)
    ).toBe(true)
    expect(rejected(`SELECT * FROM otherschema."teleport_products"`)).toBe(true)
  })

  it('a CTE cannot launder a non-allowed table', () => {
    expect(rejected(`WITH x AS (SELECT * FROM "users") SELECT * FROM x`)).toBe(true)
  })

  it('timing/file functions and locks', () => {
    expect(rejected(`SELECT pg_sleep(10)`)).toBe(true)
    expect(rejected(`SELECT current_setting('server_version')`)).toBe(true)
    expect(rejected(`SELECT "name" FROM "teleport_products" FOR SHARE`)).toBe(true)
    // FOR UPDATE falls to the UPDATE keyword rule
    expect(rejected(`SELECT "name" FROM "teleport_products" FOR UPDATE`)).toBe(true)
  })

  it('transaction control and session state', () => {
    expect(rejected(`BEGIN`)).toBe(true)
    expect(rejected(`SET search_path TO public`)).toBe(true)
  })

  it('degenerate inputs', () => {
    expect(rejected('')).toBe(true)
    expect(rejected('   ')).toBe(true)
    expect(rejected('SELECT 1'.padEnd(10001, '1'))).toBe(true)
    expect(validate(null as unknown as string, ALLOWED).valid).toBe(false)
  })
})

describe('enforceLimit', () => {
  it('appends a LIMIT when the statement has none', () => {
    expect(enforceLimit('SELECT * FROM "teleport_products"', 100)).toBe(
      'SELECT * FROM "teleport_products" LIMIT 100'
    )
  })

  it('clamps an oversized trailing LIMIT and keeps a compliant one', () => {
    expect(enforceLimit('SELECT * FROM "teleport_products" LIMIT 5000', 100)).toBe(
      'SELECT * FROM "teleport_products" LIMIT 100'
    )
    expect(enforceLimit('SELECT * FROM "teleport_products" LIMIT 5', 100)).toBe(
      'SELECT * FROM "teleport_products" LIMIT 5'
    )
  })

  it('a subquery LIMIT does not satisfy the outer statement', () => {
    const sql = 'SELECT * FROM (SELECT * FROM "teleport_products" LIMIT 5) t WHERE t."price" > 0'
    expect(enforceLimit(sql, 100)).toBe(sql + ' LIMIT 100')
  })

  it('strips a trailing semicolon and re-clamps maxRows itself', () => {
    expect(enforceLimit('SELECT 1;', 999999)).toBe('SELECT 1 LIMIT 1000')
    expect(enforceLimit('SELECT 1', 0)).toBe('SELECT 1 LIMIT 100')
  })
})

describe('buildSystemPrompt', () => {
  it('renders baked schemas and falls back for undescribed tables', () => {
    const prompt = buildSystemPrompt(
      [
        {
          table: 'teleport_products',
          columns: [
            { name: 'id', type: 'uuid', nullable: false },
            { name: 'price', type: 'numeric' },
          ],
        },
      ],
      ALLOWED,
      50
    )
    expect(prompt).toContain('TABLE "teleport_products" ("id" uuid NOT NULL, "price" numeric)')
    expect(prompt).toContain('TABLE "teleport_blog_posts" (column names unknown')
    expect(prompt).toContain('LIMIT of at most 50')
    expect(prompt).toContain('needsQuery')
  })

  it('teaches the SQL habits the store chat needed in practice', () => {
    const prompt = buildSystemPrompt([], ALLOWED, 50)
    // "what price does the 054 product have?" — partial name, possibly living
    // in a language-suffixed column.
    expect(prompt).toContain('ILIKE')
    expect(prompt).toContain('language-suffixed variants')
    // "most expensive product" with several products at the same top price —
    // ORDER BY + LIMIT 1 silently returned only one of them.
    expect(prompt).toContain('MAX()/MIN() subquery')
    expect(prompt).toContain('never ORDER BY with LIMIT 1')
    // Rows must arrive identifiable and linkable.
    expect(prompt).toContain('name/title/slug-like columns')
  })
})
