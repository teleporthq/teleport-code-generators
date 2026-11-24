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

describe('accepts the questions the store chat asks of its products and its blog', () => {
  const accepted = (sql: string) => validate(sql, ALLOWED)

  it.each([
    ['how many products', 'SELECT COUNT(*) AS "total_count" FROM "teleport_products"'],
    [
      'the cheapest products, ties included',
      'SELECT "id", "name", "slug", "price", "currency_symbol", "discounts" FROM "teleport_products" WHERE "price" = (SELECT MIN("price") FROM "teleport_products") LIMIT 50',
    ],
    [
      'products under a price',
      'SELECT "id", "name", "slug", "price", "currency_symbol", "discounts" FROM "teleport_products" WHERE "price" < 50 AND COALESCE("stock", 0) > 0 ORDER BY "price" ASC NULLS LAST LIMIT 50',
    ],
    [
      'a product named by part of its name, in every language column',
      `SELECT "id", "name", "slug", "price", "currency_symbol", "stock" FROM "teleport_products" WHERE "name" ILIKE '%054%' OR "name_es" ILIKE '%054%' OR LOWER(TRIM("description")) LIKE '%' || '054' || '%' LIMIT 50`,
    ],
    [
      'a total beside the listed rows',
      'SELECT "id", "name", "slug", "price", "currency_symbol", COUNT(*) OVER () AS "total_count" FROM "teleport_products" ORDER BY "price" DESC LIMIT 50',
    ],
    [
      'counts per category, the median price and the sold-out share',
      `SELECT "category", COUNT(*) AS "total_count", percentile_cont(0.5) WITHIN GROUP (ORDER BY "price") AS "median", COUNT(*) FILTER (WHERE "stock" = 0) AS "sold_out" FROM "teleport_products" GROUP BY "category" HAVING COUNT(*) > 1 ORDER BY 2 DESC`,
    ],
    [
      'casts, CASE and rounding',
      `SELECT "id", CAST("price" AS numeric(10, 2)) AS "price", ROUND("price"::numeric, 2), CASE WHEN "stock" IS NULL THEN 'unknown' ELSE 'known' END FROM "teleport_products" WHERE "price"::double precision > 10.5`,
    ],
    [
      'the newest posts, ties included',
      'SELECT "id", "title", "slug", "published_at" FROM "teleport_blog_posts" WHERE "published_at" = (SELECT MAX("published_at") FROM "teleport_blog_posts")',
    ],
    [
      'posts by an author',
      `SELECT "id", "title", "slug", "published_at", "author_name" FROM "teleport_blog_posts" WHERE "author_name" ILIKE '%jane%' ORDER BY "published_at" DESC LIMIT 50`,
    ],
    [
      'posts from a period',
      `SELECT "id", "title", "slug", "published_at" FROM "teleport_blog_posts" WHERE EXTRACT(YEAR FROM "published_at") = 2025 AND date_trunc('month', "published_at") >= date_trunc('month', NOW() - INTERVAL '3 months') AND "published_at" < CURRENT_DATE + INTERVAL '1 day'`,
    ],
    [
      'a post titled by part of its title',
      `SELECT "id", SUBSTRING("title" FROM 1 FOR 80) AS "title", "slug", "published_at"::timestamp with time zone AT TIME ZONE 'UTC' AS "published_at" FROM "teleport_blog_posts" WHERE TRIM(BOTH ' ' FROM "title") ILIKE ANY (ARRAY['%launch%', '%release%'])`,
    ],
    [
      'posts per author, as a CTE',
      'WITH per_author AS (SELECT "author_name", COUNT(*) AS "total_count" FROM "teleport_blog_posts" GROUP BY "author_name"), top_author AS (SELECT MAX("total_count") AS "most" FROM per_author) SELECT p.* FROM per_author p JOIN top_author t ON p."total_count" = t."most"',
    ],
    [
      'a comparison that reads FROM as part of IS DISTINCT FROM',
      'SELECT "id" FROM "teleport_products" WHERE "sale_price" IS DISTINCT FROM "price" AND "slug" IS NOT DISTINCT FROM "name"',
    ],
    [
      'products with a matching post, through EXISTS and IN',
      'SELECT DISTINCT ON (p."category") p."id", p."name" FROM "teleport_products" AS p WHERE EXISTS (SELECT 1 FROM "teleport_blog_posts" b WHERE b."title" ILIKE p."name") OR p."id" IN (SELECT "id" FROM "teleport_products" ORDER BY "created_at" DESC LIMIT 5)',
    ],
    [
      'a ranking with row_number over a window',
      'SELECT * FROM (SELECT "id", "name", row_number() OVER (PARTITION BY "category" ORDER BY "price") AS rn FROM "teleport_products") ranked WHERE ranked.rn <= 3',
    ],
    [
      'two allowed tables in one set operation',
      `SELECT "name" AS "label" FROM "teleport_products" UNION ALL SELECT "title" FROM "teleport_blog_posts" ORDER BY 1 LIMIT 20`,
    ],
  ])('%s', (_, sql) => {
    expect(accepted(sql)).toEqual({ valid: true })
  })

  it('folds an unquoted table name the way Postgres does', () => {
    expect(validate('SELECT name FROM Teleport_Products', ALLOWED).valid).toBe(true)
    expect(validate('SELECT name FROM "Teleport_Products"', ALLOWED).valid).toBe(false)
  })
})

describe('reads only the allowed tables, wherever the statement names one', () => {
  const rejected = (sql: string) => validate(sql, ALLOWED).valid === false

  it('every table of a comma-separated FROM list', () => {
    expect(rejected('SELECT p."name", s.* FROM "teleport_products" p, "team_members" s')).toBe(true)
    expect(
      rejected('SELECT 1 FROM "teleport_products" p JOIN "teleport_blog_posts" b ON true, users')
    ).toBe(true)
  })

  it('a table named by a set operation', () => {
    expect(rejected('SELECT "id" FROM "teleport_products" UNION ALL TABLE "team_members"')).toBe(
      true
    )
    expect(
      rejected('SELECT "id" FROM "teleport_products" EXCEPT (SELECT "id" FROM "team_members")')
    ).toBe(true)
  })

  it('a CTE name outside the scope that defines it', () => {
    expect(
      rejected(
        'SELECT s.* FROM "teleport_products" JOIN "team_members" s ON true WHERE EXISTS (WITH "team_members" AS (SELECT 1) SELECT 1 FROM "team_members")'
      )
    ).toBe(true)
    expect(
      rejected('WITH team_members AS (SELECT * FROM team_members) SELECT * FROM team_members')
    ).toBe(true)
    expect(
      rejected(
        'WITH a AS (SELECT * FROM b), b AS (SELECT * FROM "teleport_products") SELECT * FROM a'
      )
    ).toBe(true)
  })

  it('a table behind a schema, the project schema included', () => {
    expect(rejected('SELECT * FROM public."teleport_products"')).toBe(true)
    expect(rejected('SELECT * FROM "public"."team_members"')).toBe(true)
  })

  it('a from-item it does not follow', () => {
    expect(rejected('SELECT * FROM ("teleport_products" JOIN "team_members" ON true)')).toBe(true)
    expect(rejected('SELECT * FROM "teleport_products" p CROSS JOIN LATERAL (SELECT 1) x')).toBe(
      true
    )
    expect(rejected('SELECT * FROM ONLY "teleport_products"')).toBe(true)
    expect(rejected('SELECT * FROM ROWS FROM (unnest(ARRAY[1]))')).toBe(true)
    expect(rejected('SELECT * FROM "teleport_products" TABLESAMPLE SYSTEM (50)')).toBe(true)
    expect(rejected('SELECT * FROM merchant_rows()')).toBe(true)
  })
})

describe('calls only the functions it knows, and none that reads the server', () => {
  const rejected = (sql: string) => validate(sql, ALLOWED).valid === false

  it.each([
    'SELECT version()',
    'SELECT current_database()',
    'SELECT current_user',
    'SELECT "name", session_user FROM "teleport_products"',
    'SELECT inet_server_addr()',
    "SELECT nextval('teleport_orders_id_seq')",
    'SELECT lo_get(16384)',
    "SELECT table_to_xml('team_members', true, false, '')",
    "SELECT pg_read_file('postgresql.conf')",
    'SELECT "name" FROM "teleport_products" WHERE pg_catalog.lower("name") = \'x\'',
    'SELECT "f"("name") FROM "teleport_products"',
    "SELECT 'teleport_orders'::regclass",
  ])('%s', (sql) => {
    expect(rejected(sql)).toBe(true)
  })
})

describe('refuses a statement it cannot read as Postgres does', () => {
  const rejected = (sql: string) => validate(sql, ALLOWED).valid === false

  it.each([
    'SELECT "name" FROM "teleport_products" WHERE "id" = $1',
    'SELECT $$x$$ FROM "teleport_products"',
    `SELECT E'\\x27' FROM "teleport_products"`,
    `SELECT "name" FROM "teleport_products" WHERE "name" = 'a\\'`,
    `SELECT U&"\\0061" FROM "teleport_products"`,
    `SELECT "name" FROM "teleport_products" WHERE "name" = 'unterminated`,
    'SELECT "name FROM "teleport_products"',
    'SELECT "name" FROM "teleport_products")',
    'SELECT ("name" FROM "teleport_products"',
    'SELECT "name" FROM "teleport_products" WHERE "a" = `b`',
    'SELECT "name" FROM "teleport_products" FOR KEY SHARE',
    'SELECT "name" FROM "teleport_products" FETCH FIRST 1 ROWS ONLY',
    'WITH RECURSIVE r AS (SELECT 1) SELECT * FROM r',
    'WITH d AS (DELETE FROM "teleport_products" RETURNING *) SELECT * FROM d',
    '(SELECT "name" FROM "teleport_products")',
  ])('%s', (sql) => {
    expect(rejected(sql)).toBe(true)
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
