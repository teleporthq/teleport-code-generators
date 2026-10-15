import { parse } from '@babel/parser'
import {
  InMemoryFileRecord,
  ProjectPluginStructure,
  UIDLContentSiteIndex,
  UIDLEcommerceCategory,
} from '@teleporthq/teleport-types'
import { ContentTables } from '@teleporthq/teleport-shared'
import { generateSafeFileName } from '@teleporthq/teleport-plugin-next-data-source'
import { NextBlogProjectPlugin } from '../src/blog/project-plugin'
import {
  SITE_INDEX_PAGE_SIZE,
  generateContentSiteIndexSource,
  generateContentSitemapPageSource,
  generateLlmsFullTxtPageSource,
  generateLlmsTxtPageSource,
} from '../src/blog/content-site-index'

/**
 * The site's live index: a content preset's sitemap (`/sitemap-help.xml`) and
 * the llms files (`/llms.txt`, `/llms-full.txt`) read the published posts on
 * request through the preset's own generated fetcher, so a post published
 * after the last publish is listed, with the date it last changed.
 */

const DATA_SOURCE_ID = 'ds-help-1234567890'
const HELP_FETCHER = generateSafeFileName('teleport', 'teleport_help_articles', DATA_SOURCE_ID)

const SITE_INDEX: UIDLContentSiteIndex = {
  dataSourceId: DATA_SOURCE_ID,
  postPath: '/help',
  postUrlField: 'slug',
  title: 'Help Center',
}

const category = (
  id: string,
  overrides: Partial<UIDLEcommerceCategory> = {}
): UIDLEcommerceCategory => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  slug: id,
  parentId: null,
  order: 0,
  children: [],
  ...overrides,
})

const HELP_TREE: UIDLEcommerceCategory[] = [
  category('guides', {
    translations: { fr: { name: 'Guides FR' } },
    children: [category('publishing', { parentId: 'guides' })],
  }),
  category('billing'),
]

const makeStructure = (params: {
  siteIndex?: UIDLContentSiteIndex
  llms?: { index?: string }
  withDataSource?: boolean
  manual?: boolean
}): ProjectPluginStructure =>
  ({
    uidl: {
      name: 'docs',
      globals: { env: {} },
      root: {
        stateDefinitions: {
          route: {
            type: 'string',
            defaultValue: 'index',
            values: [
              {
                value: 'index',
                seo: { assets: [{ type: 'canonical', path: 'https://docs.example.com/' }] },
              },
            ],
          },
        },
      },
      ...(params.withDataSource === false
        ? {}
        : {
            dataSources: {
              [DATA_SOURCE_ID]: {
                id: DATA_SOURCE_ID,
                type: 'teleport',
                name: 'Content',
                config: { selectedTables: { teleport_help_articles: { columns: [] } } },
              },
            },
          }),
      helpCenterSettings: {
        categories: HELP_TREE,
        ...(params.siteIndex ? { siteIndex: params.siteIndex } : {}),
        ...(params.manual ? { order: 'manual' } : {}),
      },
      ...(params.llms ? { llms: params.llms } : {}),
    },
    files: new Map<string, InMemoryFileRecord>(),
    dependencies: {},
    devDependencies: {},
    template: { files: [], subFolders: [] },
  } as unknown as ProjectPluginStructure)

const fileOf = (structure: ProjectPluginStructure, key: string) => structure.files.get(key)

const expectValidModule = (source: string) => {
  expect(() => parse(source, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
}

type Fetcher = (params: Record<string, unknown>) => Promise<unknown>
type Serve = (...args: unknown[]) => Promise<unknown>

const localize = (tree: UIDLEcommerceCategory[], locale: string | null) => {
  const resolve = (nodes: UIDLEcommerceCategory[]): UIDLEcommerceCategory[] =>
    nodes.map((node) => {
      const override = locale && node.translations ? node.translations[locale] : null
      return {
        ...node,
        name: (override && override.name) || node.name,
        children: resolve(node.children || []),
      }
    })
  return resolve(tree)
}

/** The module's exports, with the taxonomy and the fetcher it imports replaced. */
const loadModule = (source: string, helpPosts: Fetcher): Record<string, Serve> => {
  const body = source
    .replace(/^import .*$/gm, '')
    .replace(/^export async function/gm, 'async function')
  const exportNames = Array.from(source.matchAll(/^export async function (\w+)/gm)).map(
    (match) => match[1]
  )
  // tslint:disable-next-line:function-constructor
  const factory = new Function(
    'HELP_CATEGORY_TREE',
    'localizeCategoryTree',
    'helpPosts',
    'console',
    `${body}\nreturn { ${exportNames.join(', ')} }`
  )
  return factory(
    HELP_TREE,
    localize,
    { fetchData: helpPosts },
    { error: (): undefined => undefined }
  ) as Record<string, Serve>
}

const moduleSource = (params: { arranged?: boolean; siteUrl?: string | null } = {}) =>
  generateContentSiteIndexSource(
    [
      {
        key: 'help',
        settings: SITE_INDEX,
        fetcherModule: HELP_FETCHER,
        arranged: params.arranged === true,
      },
    ],
    params.siteUrl === undefined ? 'https://docs.example.com' : params.siteUrl
  )

interface FakeResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
  setHeader(name: string, value: string): void
  end(body: string): void
}

const fakeResponse = (): FakeResponse => ({
  statusCode: 0,
  headers: {},
  body: '',
  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value
  },
  end(body) {
    this.body = body
  },
})

const article = (overrides: Record<string, unknown>) => ({
  id: 'a1',
  title: 'Connect a domain',
  slug: 'connect-a-domain',
  status: 'published',
  categories: [] as Array<{ id: string }>,
  createdAt: Date.UTC(2026, 8, 15, 12),
  updatedAt: Date.UTC(2026, 8, 15, 12),
  ...overrides,
})

/** Serves one route of the module over `rows` (or a per-call fetcher), returning the response and the reads. */
const serve = async (
  name: string,
  rows: unknown[] | Fetcher,
  options: { args?: unknown[]; context?: Record<string, unknown>; source?: string } = {}
) => {
  const calls: Array<Record<string, unknown>> = []
  const fetcher: Fetcher = async (params) => {
    calls.push(params)
    return typeof rows === 'function' ? rows(params) : Number(params.offset) > 0 ? [] : rows
  }
  const module = loadModule(options.source ?? moduleSource(), fetcher)
  const res = fakeResponse()
  const context = {
    req: { headers: { host: 'preview.example.net' } },
    res,
    ...options.context,
  }
  await module[name](...(options.args ?? []), context)
  return { res, calls }
}

/** Every tag closed in order, and no stray markup character in the text between them. */
const expectWellFormed = (xml: string) => {
  const [declaration, ...rest] = xml.split('\n')
  expect(declaration).toBe('<?xml version="1.0" encoding="UTF-8"?>')
  const body = rest.join('\n')
  const stack: string[] = []
  const tag = /<(\/?)([a-zA-Z:]+)((?:\s+[a-zA-Z:]+="[^"<]*")*)\s*(\/?)>/g
  let last = 0
  let match = tag.exec(body)
  while (match) {
    const text = body.slice(last, match.index)
    expect(text).not.toMatch(/[<>]/)
    expect(text).not.toMatch(/&(?!(amp|lt|gt|quot|apos);)/)
    const [, closing, name, , selfClosing] = match
    if (closing) {
      expect(stack.pop()).toBe(name)
    } else if (!selfClosing) {
      stack.push(name)
    }
    last = match.index + match[0].length
    match = tag.exec(body)
  }
  expect(body.slice(last).trim()).toBe('')
  expect(stack).toEqual([])
}

const locsOf = (xml: string) =>
  Array.from(xml.matchAll(/<loc>([^<]*)<\/loc>/g)).map((match) => match[1])

describe('the live site index — emission', () => {
  it('serves a preset’s sitemap when its settings carry siteIndex, and no llms route without llms', async () => {
    const structure = await new NextBlogProjectPlugin().runAfter(
      makeStructure({ siteIndex: SITE_INDEX })
    )
    const page = fileOf(structure, 'content-sitemap-help')
    expect(page?.path).toEqual(['pages'])
    expect(page?.files[0].name).toBe(ContentTables.contentSitemapPath('help').slice(1))
    expect(page?.files[0].name).toBe('sitemap-help.xml')
    expectValidModule(page?.files[0].content as string)

    const module = fileOf(structure, 'content-site-index')?.files[0].content as string
    expectValidModule(module)
    expect(module).toContain(`import helpPosts from './utils/data-sources/${HELP_FETCHER}'`)
    expect(module).toContain(
      "import { HELP_CATEGORY_TREE, localizeCategoryTree } from '@/blog-context'"
    )
    expect(module).toContain('var SITE_URL = "https://docs.example.com"')
    expect(structure.files.get(`resource-utils/data-sources/${HELP_FETCHER}`)).toBeDefined()

    expect(structure.files.has('llms-txt')).toBe(false)
    expect(structure.files.has('llms-full-txt')).toBe(false)
  })

  it('serves /llms.txt with the editor’s page list baked in, and /llms-full.txt, when the project carries llms', async () => {
    const pages =
      '# Docs\n\n> Help for the Docs app.\n\n## Pages\n\n- [Home](https://docs.example.com)'
    const structure = await new NextBlogProjectPlugin().runAfter(
      makeStructure({ siteIndex: SITE_INDEX, llms: { index: pages } })
    )
    const llms = fileOf(structure, 'llms-txt')
    expect(llms?.path).toEqual(['pages'])
    expect(llms?.files[0].name).toBe('llms.txt')
    expect(llms?.files[0].content).toContain(`var PAGES = ${JSON.stringify(pages)}`)
    expectValidModule(llms?.files[0].content as string)
    const full = fileOf(structure, 'llms-full-txt')
    expect(full?.files[0].name).toBe('llms-full.txt')
    expectValidModule(full?.files[0].content as string)

    // The owner's own llms.txt stays a static file: only the full text is live.
    const ownFile = await new NextBlogProjectPlugin().runAfter(
      makeStructure({ siteIndex: SITE_INDEX, llms: {} })
    )
    expect(ownFile.files.has('llms-txt')).toBe(false)
    expect(ownFile.files.has('llms-full-txt')).toBe(true)
  })

  it('serves nothing live for a preset without siteIndex, or whose database the project does not carry', async () => {
    const off = await new NextBlogProjectPlugin().runAfter(makeStructure({}))
    expect(off.files.has('content-site-index')).toBe(false)
    expect(off.files.has('content-sitemap-help')).toBe(false)

    const orphan = await new NextBlogProjectPlugin().runAfter(
      makeStructure({ siteIndex: SITE_INDEX, withDataSource: false })
    )
    expect(orphan.files.has('content-sitemap-help')).toBe(false)
    expect(orphan.files.has('llms-full-txt')).toBe(false)
  })

  it('still serves the baked page list at /llms.txt when no preset can be read — the editor wrote no static file', async () => {
    const structure = await new NextBlogProjectPlugin().runAfter(
      makeStructure({ siteIndex: SITE_INDEX, withDataSource: false, llms: { index: '# Docs' } })
    )
    expect(structure.files.has('llms-txt')).toBe(true)
    expect(structure.files.has('llms-full-txt')).toBe(false)
    const module = fileOf(structure, 'content-site-index')?.files[0].content as string
    expectValidModule(module)
    expect(module).not.toContain('@/blog-context')

    const { res } = await serve('serveLlmsTxt', [], { args: ['# Docs'], source: module })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('# Docs\n')
  })

  it('emits page sources that parse', () => {
    expectValidModule(generateContentSitemapPageSource('help'))
    expectValidModule(generateLlmsTxtPageSource('# Docs\n\n`code` and "quotes"'))
    expectValidModule(generateLlmsFullTxtPageSource())
    expectValidModule(moduleSource())
  })
})

describe('the live sitemap', () => {
  it('lists every published post a search engine may list, with the date it last changed', async () => {
    const rows = [
      article({ id: 'a1', slug: 'connect-a-domain', updatedAt: Date.UTC(2026, 9, 6, 9, 30) }),
      article({ id: 'a2', slug: 'old-one', updatedAt: null, publishedAt: Date.UTC(2026, 0, 2) }),
      article({ id: 'a3', slug: 'hidden', noIndex: true }),
      article({ id: 'a4', slug: 'moved', redirectUrl: '/help/connect-a-domain' }),
      article({ id: 'a5', slug: 'draft', status: 'draft' }),
      article({ id: 'a6', slug: '' }),
      article({ id: 'a7', slug: 'r&d notes' }),
    ]
    const { res, calls } = await serve('serveContentSitemap', rows, { args: ['help'] })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/xml; charset=utf-8')
    expect(res.headers['cache-control']).toBe('public, s-maxage=600, stale-while-revalidate=3600')
    expectWellFormed(res.body)
    expect(locsOf(res.body)).toEqual([
      'https://docs.example.com/help/connect-a-domain',
      'https://docs.example.com/help/old-one',
      'https://docs.example.com/help/r%26d%20notes',
    ])
    expect(res.body).toContain('<lastmod>2026-10-06T09:30:00.000Z</lastmod>')
    expect(res.body).toContain('<lastmod>2026-01-02T00:00:00.000Z</lastmod>')
    expect(res.body).not.toContain('xhtml')

    // Published rows only, newest first with the id as tiebreak, a page at a time.
    expect(calls[0]).toMatchObject({
      limit: SITE_INDEX_PAGE_SIZE,
      offset: 0,
      filters: JSON.stringify([
        { type: 'condition', source: 'status', destination: 'published', operand: '=' },
      ]),
      sorts: JSON.stringify([
        { field: 'created_at', order: 'desc' },
        { field: 'id', order: 'asc' },
      ]),
    })
  })

  it('reads page after page until one comes back short, listing a post once', async () => {
    const firstPage = Array.from({ length: SITE_INDEX_PAGE_SIZE }, (_, index) =>
      article({ id: `p${index}`, slug: `post-${index}` })
    )
    const { res, calls } = await serve(
      'serveContentSitemap',
      async (params) =>
        Number(params.offset) === 0
          ? firstPage
          : [article({ id: 'p0', slug: 'post-0' }), article({ id: 'late', slug: 'late' })],
      { args: ['help'] }
    )
    expect(calls.map((call) => call.offset)).toEqual([0, SITE_INDEX_PAGE_SIZE])
    const locs = locsOf(res.body)
    expect(locs).toHaveLength(SITE_INDEX_PAGE_SIZE + 1)
    expect(locs[locs.length - 1]).toBe('https://docs.example.com/help/late')
  })

  it('lists each language’s address with the others as alternates on a site in several', async () => {
    const { res, calls } = await serve(
      'serveContentSitemap',
      async (params) =>
        params.locale === 'fr'
          ? [article({ slug: 'connecter-un-domaine' })]
          : [article({ slug: 'connect-a-domain' })],
      { args: ['help'], context: { locale: 'en', defaultLocale: 'en', locales: ['en', 'fr'] } }
    )
    expect(calls.map((call) => call.locale)).toEqual(['en', 'fr'])
    expectWellFormed(res.body)
    expect(res.body).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"')
    expect(locsOf(res.body)).toEqual([
      'https://docs.example.com/help/connect-a-domain',
      'https://docs.example.com/fr/help/connecter-un-domaine',
    ])
    const alternates = [
      '<xhtml:link rel="alternate" hreflang="en" href="https://docs.example.com/help/connect-a-domain" />',
      '<xhtml:link rel="alternate" hreflang="fr" href="https://docs.example.com/fr/help/connecter-un-domaine" />',
      '<xhtml:link rel="alternate" hreflang="x-default" href="https://docs.example.com/help/connect-a-domain" />',
    ]
    for (const alternate of alternates) {
      expect(res.body.split(alternate)).toHaveLength(3)
    }
  })

  it('takes the request’s host when the pages carry no canonical address', async () => {
    const { res } = await serve('serveContentSitemap', [article({})], {
      args: ['help'],
      source: moduleSource({ siteUrl: null }),
    })
    expect(locsOf(res.body)).toEqual(['https://preview.example.net/help/connect-a-domain'])
  })

  it('answers 503 with Retry-After when the posts cannot be read — never an empty sitemap', async () => {
    const { res } = await serve(
      'serveContentSitemap',
      async () => {
        throw new Error('connection refused')
      },
      { args: ['help'] }
    )
    expect(res.statusCode).toBe(503)
    expect(res.headers['retry-after']).toBe('300')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).not.toContain('<urlset')
  })
})

describe('the live llms files', () => {
  const PAGES =
    '# Docs\n\n> Help for the Docs app.\n\n## Pages\n\n- [Home](https://docs.example.com)'
  const rows = [
    article({ id: 'loose', slug: 'loose', title: 'A loose [draft] note', categories: [] }),
    article({
      id: 'p-2',
      slug: 'publish',
      title: 'Publish your site',
      categories: [{ id: 'publishing' }],
      sortOrder: 2,
      metaDescription: 'How to put your site online.',
    }),
    article({
      id: 'p-1',
      slug: 'preview',
      title: 'Preview before publishing',
      categories: [{ id: 'publishing' }],
      sortOrder: 1,
      excerpt: '<p>See the site <strong>before</strong> anyone else.</p>',
    }),
    article({
      id: 'g-1',
      slug: 'start',
      title: 'Start here',
      categories: [{ id: 'gone' }, { id: 'guides' }],
      metaDescription: 'word '.repeat(60).trim(),
    }),
    article({ id: 'b-1', slug: 'invoices', title: 'Invoices', categories: [{ id: 'billing' }] }),
  ]

  it('appends each preset’s posts by category to the editor’s page list', async () => {
    const { res } = await serve('serveLlmsTxt', rows, { args: [PAGES] })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(res.body).toBe(
      [
        PAGES,
        '',
        '## Help Center',
        '',
        '- [A loose \\[draft\\] note](https://docs.example.com/help/loose)',
        '',
        '### Guides',
        '',
        `- [Start here](https://docs.example.com/help/start): ${'word '.repeat(40).trim()}...`,
        '',
        '### Guides › Publishing',
        '',
        '- [Publish your site](https://docs.example.com/help/publish): How to put your site online.',
        '- [Preview before publishing](https://docs.example.com/help/preview): See the site before anyone else.',
        '',
        '### Billing',
        '',
        '- [Invoices](https://docs.example.com/help/invoices)',
        '',
      ].join('\n')
    )
  })

  it('lists each category’s posts by the places the author gave them in Manual Order', async () => {
    const { res } = await serve('serveLlmsTxt', rows, {
      args: [PAGES],
      source: moduleSource({ arranged: true }),
    })
    const publishing = res.body.split('### Guides › Publishing\n\n')[1].split('\n\n')[0]
    expect(publishing.split('\n').map((line) => line.split('](')[0])).toEqual([
      '- [Preview before publishing',
      '- [Publish your site',
    ])
  })

  it('names the categories and links the posts in the request’s language', async () => {
    const { res, calls } = await serve('serveLlmsTxt', rows, {
      args: [PAGES],
      context: { locale: 'fr', defaultLocale: 'en', locales: ['en', 'fr'] },
    })
    expect(calls[0].locale).toBe('fr')
    expect(res.body).toContain('### Guides FR\n')
    expect(res.body).toContain('(https://docs.example.com/fr/help/start)')
  })

  it('writes every post in full as Markdown, in the order llms.txt lists them', async () => {
    const body = [
      '<h2 id="before">Before you start</h2>',
      '<p>You need a <strong>Pro</strong> plan &amp; a <a href="/help/domains">domain</a>. Run <code>npm i</code>.</p>',
      '<ul><li>One<ul><li>Nested</li></ul></li><li>Two</li></ul>',
      '<ol start="3"><li>Third</li><li>Fourth</li></ol>',
      '<pre><code class="language-js">const a = `x`\n</code></pre>',
      '<table><thead><tr><th>Plan</th><th>Domains</th></tr></thead><tbody><tr><td>Pro</td><td>1 | 2</td></tr></tbody></table>',
      '<aside class="tq-callout" data-kind="tip"><p><strong>Tip:</strong> Keep it short.</p></aside>',
      '<figure class="ql-content-image"><img src="/assets/shot.png" alt="The panel"></figure>',
      '<div class="tq-embed" data-tq-embed-url="https://www.youtube.com/watch?v=x" data-tq-embed-caption="Walkthrough"></div>',
      '<h1>A stray top heading</h1>',
    ].join('')
    const { res } = await serve(
      'serveLlmsFullTxt',
      [
        article({
          id: 'p-2',
          slug: 'publish',
          title: 'Publish your site',
          categories: [{ id: 'publishing' }],
          metaDescription: 'How to put your site online.',
          content: body,
          updatedAt: Date.UTC(2026, 9, 6),
        }),
        article({ id: 'loose', slug: 'loose', title: 'Loose', content: '<p>Short.</p>' }),
      ],
      {}
    )
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe(
      [
        '# Loose',
        '',
        'Source: https://docs.example.com/help/loose',
        'Last updated: 2026-09-15',
        '',
        'Short.',
        '',
        '# Publish your site',
        '',
        'Source: https://docs.example.com/help/publish',
        'Category: Guides › Publishing',
        'Last updated: 2026-10-06',
        '',
        '> How to put your site online.',
        '',
        '## Before you start',
        '',
        'You need a **Pro** plan & a [domain](https://docs.example.com/help/domains). Run `npm i`.',
        '',
        '- One',
        '  - Nested',
        '- Two',
        '',
        '3. Third',
        '4. Fourth',
        '',
        '```js',
        'const a = `x`',
        '```',
        '',
        '| Plan | Domains |',
        '| --- | --- |',
        '| Pro | 1 \\| 2 |',
        '',
        '> **Tip:** Keep it short.',
        '',
        '![The panel](https://docs.example.com/assets/shot.png)',
        '',
        '[Walkthrough](https://www.youtube.com/watch?v=x)',
        '',
        '## A stray top heading',
        '',
      ].join('\n')
    )
  })

  it('answers 503 when the posts cannot be read', async () => {
    const { res } = await serve(
      'serveLlmsFullTxt',
      async () => {
        throw new Error('timeout')
      },
      {}
    )
    expect(res.statusCode).toBe(503)
    expect(res.headers['retry-after']).toBe('300')
  })
})
