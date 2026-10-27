/* tslint:disable:function-constructor max-classes-per-file */
import { parse } from '@babel/parser'
import { generateDataSourceFetcher } from '../src/data-source-fetchers'
import { generateTeleportCountFetcher } from '../src/fetchers/teleport'
import { generateCSVFileFetcher } from '../src/fetchers/csv-file'

/**
 * A list's search: every typed word must appear in one of the searched
 * columns, and the matches are ordered by where the words are — rows whose
 * first searched column (a title) holds every word, then rows whose second
 * one does, and so on, rows with the words spread over several columns last —
 * with the list's own sort deciding within each group. The order is part of
 * the query, so a page is cut from the ranked rows, never ranked after.
 */

interface Query {
  sql: string
  params: unknown[]
}

const SEARCHED = JSON.stringify(['title', 'excerpt', 'content'])

const pgRoute = (type: 'teleport' | 'postgresql', withCount = false) => {
  const config =
    type === 'teleport'
      ? {
          host: 'db',
          database: 'site',
          selectedTables: { articles: { columns: [{ name: 'id' }] } },
        }
      : { host: 'h', port: 5432, user: 'u', password: 'p', database: 'd' }
  const route = generateDataSourceFetcher({ type, config } as never, 'articles')
  return withCount && type === 'teleport'
    ? route + generateTeleportCountFetcher(config, 'articles')
    : route
}

const runPgRoute = async (
  code: string,
  query: Record<string, string>,
  entry = 'handler'
): Promise<Query[]> => {
  const queries: Query[] = []
  class FakeClient {
    public async connect() {
      return
    }
    public async end() {
      return
    }
    public async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params })
      return /^SELECT COUNT/i.test(sql) ? { rows: [{ count: '0' }] } : { rows: [] }
    }
  }
  const body = code
    .replace(/^import .*$/gm, '')
    .replace(/^export default async function handler/m, 'async function handler')
  const module = { exports: {} as Record<string, (req: unknown, res: unknown) => Promise<void>> }
  new Function(
    'require',
    'module',
    'process',
    'console',
    'Client',
    'pgTypes',
    `${body}\nmodule.exports = { handler, getCount: typeof getCount === 'function' ? getCount : null }`
  )(
    () => ({ getToken: async () => null }),
    module,
    { env: {} },
    { error: () => undefined, warn: () => undefined, log: () => undefined },
    FakeClient,
    { setTypeParser: () => undefined }
  )
  const res = { status: () => res, json: () => res, setHeader: () => res }
  await module.exports[entry]({ method: 'GET', query, headers: {} }, res)
  return queries.filter((recorded) => / FROM "?articles"?/.test(recorded.sql))
}

const titleMatch = (placeholders: string[], column: string) =>
  placeholders.map((ph) => `"${column}"::text ILIKE ${ph} ESCAPE '|'`).join(' AND ')

describe.each(['teleport', 'postgresql'] as const)('the %s list route', (type) => {
  const route = pgRoute(type)

  it('parses as valid JavaScript', () => {
    expect(() => parse(route, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })

  it('needs every typed word, each in any searched column', async () => {
    const [main] = await runPgRoute(route, { query: 'Create  form', queryColumns: SEARCHED })
    expect(main.sql).toContain(
      `WHERE (("title"::text ILIKE $1 ESCAPE '|' OR "excerpt"::text ILIKE $1 ESCAPE '|' OR "content"::text ILIKE $1 ESCAPE '|')` +
        ` AND ("title"::text ILIKE $2 ESCAPE '|' OR "excerpt"::text ILIKE $2 ESCAPE '|' OR "content"::text ILIKE $2 ESCAPE '|'))`
    )
    expect(main.params).toEqual(['%create%', '%form%'])
  })

  it('orders title matches, then excerpt, then content, then spread words, before the sort and the page', async () => {
    const [main] = await runPgRoute(route, {
      query: 'create form',
      queryColumns: SEARCHED,
      sorts: JSON.stringify([{ field: 'sort_order', order: 'asc' }]),
      filters: JSON.stringify([{ source: 'status', destination: 'published', operand: '=' }]),
      perPage: '12',
      page: '2',
    })
    const rank =
      `CASE WHEN ${titleMatch(['$1', '$2'], 'title')} THEN 0` +
      ` WHEN ${titleMatch(['$1', '$2'], 'excerpt')} THEN 1` +
      ` WHEN ${titleMatch(['$1', '$2'], 'content')} THEN 2 ELSE 3 END`
    expect(main.sql).toContain(` ORDER BY ${rank}, sort_order ASC NULLS LAST`)
    expect(main.sql).toMatch(/ LIMIT 12 OFFSET 12$/)
    expect(main.params).toEqual(['%create%', '%form%', 'published'])
  })

  it('ranks the matches when the list has no sort of its own', async () => {
    const [main] = await runPgRoute(route, { query: 'form', queryColumns: SEARCHED })
    expect(main.sql).toMatch(
      / ORDER BY CASE WHEN "title"::text ILIKE \$1 ESCAPE '\|' THEN 0 .* ELSE 3 END(, "id" ASC)?$/
    )
  })

  it('leaves the order alone without a search, or with one searched column', async () => {
    const sorts = JSON.stringify([{ field: 'sort_order', order: 'asc' }])
    const [plain] = await runPgRoute(route, { sorts })
    const [single] = await runPgRoute(route, {
      sorts,
      query: 'form',
      queryColumns: JSON.stringify(['title']),
    })
    expect(plain.sql).not.toContain('CASE WHEN')
    expect(single.sql).not.toContain('CASE WHEN')
    expect(single.sql).toContain(' ORDER BY sort_order ASC NULLS LAST')
  })
})

describe('the built-in database count route', () => {
  it('counts the rows matching every word, without ranking them', async () => {
    const [count] = await runPgRoute(
      pgRoute('teleport', true),
      { query: 'create form', queryColumns: SEARCHED },
      'getCount'
    )
    expect(count.sql).toMatch(/^SELECT COUNT\(\*\) FROM articles WHERE \(\(.*\) AND \(.*\)\)$/)
    expect(count.sql).not.toContain('CASE')
    expect(count.params).toEqual(['%create%', '%form%'])
  })
})

describe('the MySQL list route', () => {
  const route = generateDataSourceFetcher(
    { type: 'mysql', config: { host: 'h', user: 'u', password: 'p', database: 'd' } } as never,
    'articles'
  )

  it('binds the ranking patterns after every WHERE parameter, as the ORDER BY follows the WHERE', async () => {
    const queries: Query[] = []
    const mysql = {
      escapeId: (name: string) => '`' + name + '`',
      createConnection: () => ({
        query: async (sql: string, params: unknown[]) => {
          queries.push({ sql, params })
          return [[]]
        },
        end: async () => undefined,
      }),
    }
    const body = route
      .replace(/^import .*$/gm, '')
      .replace(/^export default async function handler/m, 'async function handler')
    const handler = new Function('mysql', 'console', `${body}\nreturn handler`)(mysql, {
      error: () => undefined,
      warn: () => undefined,
    })
    const res = { status: () => res, json: () => res }
    await handler(
      {
        query: {
          query: 'create form',
          queryColumns: JSON.stringify(['title', 'content']),
          filters: JSON.stringify([{ source: 'status', destination: 'published', operand: '=' }]),
          sorts: JSON.stringify([{ field: 'sort_order', order: 'asc' }]),
        },
      },
      res
    )
    const [main] = queries
    const placeholders = (main.sql.match(/\?/g) || []).length
    expect(placeholders).toBe(main.params.length)
    expect(main.sql).toContain(
      "ORDER BY CASE WHEN LOWER(CAST(`title` AS CHAR)) LIKE LOWER(?) ESCAPE '|' AND LOWER(CAST(`title` AS CHAR)) LIKE LOWER(?) ESCAPE '|' THEN 0"
    )
    expect(main.sql).toContain('ELSE 2 END, `sort_order` ASC')
    expect(main.params).toEqual([
      '%create%',
      '%create%',
      '%form%',
      '%form%',
      'published',
      '%create%',
      '%form%',
      '%create%',
      '%form%',
    ])
  })
})

describe('a list searched in memory (CSV file)', () => {
  const rows = [
    { id: 1, title: 'Publishing your site', excerpt: 'Go live', content: 'Create a form first' },
    { id: 2, title: 'Forms', excerpt: 'How to create a form', content: '' },
    { id: 3, title: 'How to create a form', excerpt: '', content: '' },
    { id: 4, title: 'Create pages', excerpt: 'A form on a page', content: '' },
    { id: 5, title: 'Create a contact form', excerpt: '', content: '' },
    { id: 6, title: 'Unrelated', excerpt: '', content: '' },
  ]
  const code = generateCSVFileFetcher({
    parsedData: rows,
    columns: ['id', 'title', 'excerpt', 'content'].map((id) => ({ id, label: id })),
  })

  const run = async (query: Record<string, string>) => {
    const handler = new Function(
      `${code.replace(/^export default async function handler/m, 'async function handler')}
      return handler`
    )()
    let payload: { data: Array<{ id: number }> } = { data: [] }
    const res = {
      status: () => res,
      json: (data: typeof payload) => {
        payload = data
        return res
      },
    }
    await handler({ query }, res)
    return payload.data.map((row) => row.id)
  }

  it('ranks title, then excerpt, then content, then spread words; the sort within each', async () => {
    const ids = await run({
      query: 'create form',
      queryColumns: SEARCHED,
      sorts: JSON.stringify([{ field: 'id', order: 'desc' }]),
    })
    expect(ids).toEqual([5, 3, 2, 1, 4])
  })

  it('cuts the page from the ranked rows', async () => {
    const ids = await run({
      query: 'create form',
      queryColumns: SEARCHED,
      sorts: JSON.stringify([{ field: 'id', order: 'desc' }]),
      perPage: '2',
      page: '2',
    })
    expect(ids).toEqual([2, 1])
  })
})
