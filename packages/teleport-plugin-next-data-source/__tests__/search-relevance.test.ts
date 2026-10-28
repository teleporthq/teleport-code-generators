/* tslint:disable:function-constructor max-classes-per-file */
import { parse } from '@babel/parser'
import { generateDataSourceFetcher } from '../src/data-source-fetchers'
import { generateTeleportCountFetcher } from '../src/fetchers/teleport'
import { generateCSVFileFetcher } from '../src/fetchers/csv-file'
import { generateSearchRankHelperCode, generateSearchTermsCode } from '../src/search-relevance'
import { DataExposure } from '@teleporthq/teleport-shared'
import { publicRead } from './_helpers/exposure'

/**
 * A list's search: the typed text is split into terms at white space, the
 * punctuation around them dropped; every term must appear in one of the
 * searched columns. Postgres and the in-memory routes read the stored text
 * like the typed text — tags, entities and punctuation as spaces — so markup
 * never matches. The matches are ordered column by column: by how much of the
 * typed text the title holds (a whole word 3, a word start 2, inside a word
 * 1), then the summary, and so on, with the list's own sort among rows that
 * score alike. The order is part of the query, so a page is cut from the
 * ranked rows, never ranked after.
 */

interface Query {
  sql: string
  params: unknown[]
}

const SEARCHED = JSON.stringify(['title', 'excerpt', 'content'])

const ARTICLES_SCHEMA = {
  articles: {
    columns: [
      { name: 'id' },
      { name: 'title' },
      { name: 'excerpt' },
      { name: 'content' },
      { name: 'sort_order' },
      { name: 'status' },
    ],
  },
}

const pgRoute = (type: 'teleport' | 'postgresql', withCount = false) => {
  const config =
    type === 'teleport'
      ? {
          host: 'db',
          database: 'site',
          selectedTables: ARTICLES_SCHEMA,
        }
      : {
          host: 'h',
          port: 5432,
          user: 'u',
          password: 'p',
          database: 'd',
          selectedTables: ARTICLES_SCHEMA,
        }
  const route = generateDataSourceFetcher({ type, config } as never, 'articles', {
    routeExposure: publicRead(),
  })
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

const searchText = (position: number) => `"__tq_search"."__tq_search_${position}"`
const like = (position: number, placeholder: string, before: string, after: string) =>
  `${searchText(position)} LIKE ('${before}' || ${placeholder}::text || '${after}') ESCAPE '|'`
const columnScore = (position: number, placeholders: string[]) =>
  '(' +
  placeholders
    .map(
      (ph) =>
        `CASE WHEN ${like(position, ph, '% ', ' %')} THEN 3` +
        ` WHEN ${like(position, ph, '% ', '%')} THEN 2` +
        ` WHEN ${like(position, ph, '%', '%')} THEN 1 ELSE 0 END`
    )
    .join(' + ') +
  ') DESC'

describe.each(['teleport', 'postgresql'] as const)('the %s list route', (type) => {
  const route = pgRoute(type)
  const table = type === 'teleport' ? 'articles' : '"articles"'

  it('parses as valid JavaScript', () => {
    expect(() => parse(route, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })

  it('needs every typed term, each in any searched column, case and punctuation aside', async () => {
    const [main] = await runPgRoute(route, { query: 'Create  "form?"', queryColumns: SEARCHED })
    expect(main.sql).toContain(
      `WHERE ((${like(0, '$1', '%', '%')} OR ${like(1, '$1', '%', '%')} OR ${like(
        2,
        '$1',
        '%',
        '%'
      )})` +
        ` AND (${like(0, '$2', '%', '%')} OR ${like(1, '$2', '%', '%')} OR ${like(
          2,
          '$2',
          '%',
          '%'
        )}))`
    )
    expect(main.params).toEqual(['create', 'form'])
  })

  it("reads each searched column once per row, as text without markup or punctuation, and serves only the table's columns", async () => {
    const [main] = await runPgRoute(route, { query: 'form', queryColumns: SEARCHED })
    expect(main.sql).toMatch(
      new RegExp(
        `^SELECT ${table.replace(/"/g, '"')}\\.\\* FROM ${table} CROSS JOIN LATERAL \\(SELECT `
      )
    )
    expect(main.sql).toContain(
      `(' ' || regexp_replace(lower("title"::text), '<[^>]*>|&[a-z0-9#]+;|[]`
    )
    expect(main.sql).toContain(`, ' ', 'g') || ' ') AS "__tq_search_0", `)
    expect(main.sql).toContain(` AS "__tq_search_2" OFFSET 0) AS "__tq_search" WHERE `)
  })

  it('reads punctuation inside a term as a space, like the stored text', async () => {
    const [main] = await runPgRoute(route, {
      query: 'e-commerce what’s 50%',
      queryColumns: SEARCHED,
    })
    expect(main.params).toEqual(['e commerce', 'what s', '50'])
  })

  it('orders by the title score, then the excerpt, then the content, before the sort and the page', async () => {
    const [main] = await runPgRoute(route, {
      query: 'create form',
      queryColumns: SEARCHED,
      sorts: JSON.stringify([{ field: 'sort_order', order: 'asc' }]),
      filters: JSON.stringify([{ source: 'status', destination: 'published', operand: '=' }]),
      perPage: '12',
      page: '2',
    })
    const rank = [0, 1, 2].map((position) => columnScore(position, ['$1', '$2'])).join(', ')
    expect(main.sql).toContain(` ORDER BY ${rank}, sort_order ASC NULLS LAST`)
    expect(main.sql).toMatch(/ LIMIT 12 OFFSET 12$/)
    expect(main.params).toEqual(['create', 'form', 'published'])
  })

  it('ranks the matches when the list has no sort of its own, even over one column', async () => {
    const [main] = await runPgRoute(route, {
      query: 'form',
      queryColumns: JSON.stringify(['title']),
    })
    expect(main.sql).toMatch(
      new RegExp(
        ` ORDER BY \\(CASE WHEN .* THEN 3 .* ELSE 0 END\\) DESC, "id" ASC LIMIT ${DataExposure.BROWSER_READ_DEFAULT_LIMIT}$`
      )
    )
  })

  it('leaves the query alone without a search', async () => {
    const [plain] = await runPgRoute(route, {
      sorts: JSON.stringify([{ field: 'sort_order', order: 'asc' }]),
    })
    expect(plain.sql).toMatch(new RegExp(`^SELECT \\* FROM ${table}`))
    expect(plain.sql).not.toContain('LATERAL')
    expect(plain.sql).not.toContain('CASE WHEN')
    expect(plain.sql).toContain(' ORDER BY sort_order ASC NULLS LAST')
  })

  it('treats a search of only punctuation as no search', async () => {
    const [main] = await runPgRoute(route, { query: ' ?! - ', queryColumns: SEARCHED })
    expect(main.sql).not.toContain('LATERAL')
    expect(main.params).toEqual([])
  })
})

describe('the built-in database count route', () => {
  it('counts the rows matching every term, through the same texts, without ranking them', async () => {
    const [count] = await runPgRoute(
      pgRoute('teleport', true),
      { query: 'create form', queryColumns: SEARCHED },
      'getCount'
    )
    expect(count.sql).toMatch(
      /^SELECT COUNT\(\*\) FROM articles CROSS JOIN LATERAL \(SELECT [\s\S]* OFFSET 0\) AS "__tq_search" WHERE \(\(.*\) AND \(.*\)\)$/
    )
    expect(count.sql).not.toContain('CASE')
    expect(count.params).toEqual(['create', 'form'])
  })
})

describe('the MySQL list route', () => {
  const route = generateDataSourceFetcher(
    {
      type: 'mysql',
      config: {
        host: 'h',
        user: 'u',
        password: 'p',
        database: 'd',
        selectedTables: ARTICLES_SCHEMA,
      },
    } as never,
    'articles',
    { routeExposure: publicRead() }
  )

  it('binds the ranking terms after every WHERE parameter, as the ORDER BY follows the WHERE', async () => {
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
          query: '"e-commerce" form?',
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
    const title = "CONCAT(' ', LOWER(CAST(`title` AS CHAR)), ' ')"
    expect(main.sql).toContain(
      `ORDER BY (CASE WHEN ${title} LIKE CONCAT('% ', ?, ' %') ESCAPE '|' THEN 3` +
        ` WHEN ${title} LIKE CONCAT('% ', ?, '%') ESCAPE '|' THEN 2` +
        ` WHEN ${title} LIKE CONCAT('%', ?, '%') ESCAPE '|' THEN 1 ELSE 0 END`
    )
    expect(main.sql).toContain('ELSE 0 END) DESC, `sort_order` ASC')
    // The stored text is read raw here, so a term keeps the punctuation inside it.
    const term = ['e-commerce', 'form']
    expect(main.params).toEqual([
      term[0],
      term[0],
      term[1],
      term[1],
      'published',
      ...[term[0], term[0], term[0], term[1], term[1], term[1]],
      ...[term[0], term[0], term[0], term[1], term[1], term[1]],
    ])
  })
})

const evaluate = (code: string, exports: string) =>
  new Function(`${code}\nreturn { ${exports} }`)() as Record<
    string,
    (...args: unknown[]) => unknown
  >

describe('the typed terms', () => {
  const normalised = evaluate(generateSearchTermsCode(true), 'searchTerms').searchTerms
  const raw = evaluate(generateSearchTermsCode(false), 'searchTerms').searchTerms

  it('drops case, repeats and the punctuation around a term', () => {
    expect(normalised('  How do I create a FORM?  "create" ')).toEqual([
      'how',
      'do',
      'i',
      'create',
      'a',
      'form',
    ])
    expect(raw('(reCAPTCHA), "form?"')).toEqual(['recaptcha', 'form'])
  })

  it('reads the punctuation inside a term as a space only where the stored text is read the same way', () => {
    expect(normalised('e-commerce what’s Q&A')).toEqual(['e commerce', 'what s', 'q a'])
    expect(raw('e-commerce what’s Q&A')).toEqual(['e-commerce', 'what’s', 'q&a'])
  })

  it('finds nothing to search in blank text or punctuation alone', () => {
    expect(normalised('')).toEqual([])
    expect(normalised(' - ? ')).toEqual([])
    expect(normalised(undefined)).toEqual([])
    expect(raw(' % _ ')).toEqual([])
  })
})

describe('a list searched in memory', () => {
  const helpers = evaluate(generateSearchRankHelperCode(), 'matchesSearch, rankBySearch')
  const valueOf = (row: Record<string, unknown>, column: string) => row[column]

  it("never matches a word that is only in a rich-text body's markup", () => {
    const row = {
      content:
        '<p><strong>Tip:</strong> see <a href="https://x.io" rel="noopener">Q&amp;A</a></p><aside class="tq-callout" data-kind="note"><p>Done.</p></aside>',
    }
    const matches = (query: string) => helpers.matchesSearch(row, query, ['content'], valueOf)
    expect(matches('strong')).toBe(false)
    expect(matches('href')).toBe(false)
    expect(matches('noopener')).toBe(false)
    expect(matches('amp')).toBe(false)
    expect(matches('callout')).toBe(false)
    expect(matches('tip see')).toBe(true)
    expect(matches('Q&A')).toBe(true)
    expect(matches('done.')).toBe(true)
  })

  it('finds a typed apostrophe in either form', () => {
    const row = { title: 'What’s new' }
    expect(helpers.matchesSearch(row, "what's", ['title'], valueOf)).toBe(true)
    expect(helpers.matchesSearch({ title: "What's new" }, 'what’s', ['title'], valueOf)).toBe(true)
  })

  it('puts whole words before word starts before parts of words, the title before the rest', () => {
    const rows = [
      { id: 1, title: 'Other platforms', content: 'create' },
      { id: 2, title: 'Forms and more', content: 'create' },
      { id: 3, title: 'Unrelated', content: 'create a form' },
      { id: 4, title: 'How to create a form', content: '' },
      { id: 5, title: 'Create pages', content: 'a form' },
    ]
    const ranked = helpers.rankBySearch(
      rows,
      'create form',
      ['title', 'content'],
      valueOf
    ) as Array<{
      id: number
    }>
    expect(ranked.map((row) => row.id)).toEqual([4, 5, 2, 1, 3])
  })
})

describe('a list searched in memory (CSV file)', () => {
  const rows = [
    {
      id: 1,
      title: 'Publishing your site',
      excerpt: 'Go live',
      content: '<p>Create a <strong>form</strong> first</p>',
    },
    { id: 2, title: 'Forms', excerpt: 'How to create a form', content: '' },
    { id: 3, title: 'How to create a form', excerpt: '', content: '' },
    { id: 4, title: 'Create pages', excerpt: 'A form on a page', content: '' },
    { id: 5, title: 'Create a contact form', excerpt: '', content: '' },
    { id: 6, title: 'Unrelated', excerpt: '', content: '<p><strong>Strong</strong> words</p>' },
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

  it('ranks by the title, then the excerpt, then the content; the sort among rows that score alike', async () => {
    const ids = await run({
      query: 'create form?',
      queryColumns: SEARCHED,
      sorts: JSON.stringify([{ field: 'id', order: 'desc' }]),
    })
    expect(ids).toEqual([5, 3, 4, 2, 1])
  })

  it('cuts the page from the ranked rows', async () => {
    const ids = await run({
      query: 'create form',
      queryColumns: SEARCHED,
      sorts: JSON.stringify([{ field: 'id', order: 'desc' }]),
      perPage: '2',
      page: '2',
    })
    expect(ids).toEqual([4, 2])
  })

  it('matches the text of a rich-text column, not its tags', async () => {
    expect(await run({ query: 'strong', queryColumns: SEARCHED })).toEqual([6])
  })
})
