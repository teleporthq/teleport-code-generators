import { parse } from '@babel/parser'
import {
  FileType,
  InMemoryFileRecord,
  ProjectPluginStructure,
  UIDLBlogRssFeed,
} from '@teleporthq/teleport-types'
import { generateSafeFileName } from '@teleporthq/teleport-plugin-next-data-source'
import { NextBlogProjectPlugin } from '../src/blog/project-plugin'
import { BLOG_RSS_FEED_SIZE, generateBlogRssPageSource } from '../src/blog/rss-feed'

/**
 * The blog's RSS feed: `pages/rss.xml.js` reads the newest published posts
 * through the blog's own generated fetcher and writes an RSS 2.0 document;
 * every page announces it with a `<link rel="alternate">`.
 */

const APP_CONTENT = `const MyApp = ({ Component, pageProps }) => {
  return (
    <Component {...pageProps} />
  )
}

export default MyApp
`

const DATA_SOURCE_ID = 'ds-blog-1234567890'
const FETCHER_MODULE = generateSafeFileName('teleport', 'teleport_blog_posts', DATA_SOURCE_ID)

const FEED: UIDLBlogRssFeed = {
  dataSourceId: DATA_SOURCE_ID,
  postPath: '/blog',
  postUrlField: 'slug',
  listingPath: '/blog',
}

const makeStructure = (params: {
  rssFeed?: UIDLBlogRssFeed
  withFetcherModule?: boolean
  withDataSource?: boolean
}): ProjectPluginStructure => {
  const files = new Map<string, InMemoryFileRecord>()
  files.set('_app', {
    path: ['pages'],
    files: [{ name: '_app', fileType: FileType.JS, content: APP_CONTENT }],
  })
  if (params.withFetcherModule) {
    files.set(`resource-utils/data-sources/${FETCHER_MODULE}`, {
      path: ['utils', 'data-sources'],
      files: [{ name: FETCHER_MODULE, fileType: FileType.JS, content: '// emitted by a page' }],
    })
  }
  return {
    uidl: {
      name: 'journal',
      globals: { settings: { title: 'The Journal', language: 'en' }, assets: [] },
      root: {
        stateDefinitions: {
          route: {
            type: 'string',
            defaultValue: 'index',
            values: [
              {
                value: 'index',
                seo: {
                  assets: [{ type: 'canonical', path: 'https://journal.example.com/' }],
                  metaTags: [{ name: 'description', content: 'Notes on slow travel.' }],
                },
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
                name: 'Blog',
                config: { selectedTables: { teleport_blog_posts: { columns: [] } } },
              },
            },
          }),
      blogSettings: {
        categories: [],
        ...(params.rssFeed ? { rssFeed: params.rssFeed } : {}),
      },
    },
    files,
    dependencies: {},
    devDependencies: {},
    template: { files: [], subFolders: [] },
  } as unknown as ProjectPluginStructure
}

const fileContent = (structure: ProjectPluginStructure, key: string): string | undefined =>
  structure.files.get(key)?.files?.[0]?.content as string | undefined

const expectValidJsx = (source: string) => {
  expect(() => parse(source, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
}

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

type ServerSideProps = (context: Record<string, unknown>) => Promise<unknown>

/** The generated page's `getServerSideProps`, reading from a fake fetcher. */
const loadFeedPage = (
  source: string,
  fetchData: (params: Record<string, unknown>) => Promise<unknown>
): ServerSideProps => {
  const body = source
    .replace(/^import .*$/m, '')
    .replace('export async function getServerSideProps', 'async function getServerSideProps')
    .replace('export default function', 'function')
  const silentConsole = { error: (): undefined => undefined }
  // tslint:disable-next-line:function-constructor
  const factory = new Function('blogPosts', 'console', `${body}\nreturn getServerSideProps`)
  return factory({ fetchData }, silentConsole) as ServerSideProps
}

const pageSource = (siteUrl: string | null = 'https://journal.example.com') =>
  generateBlogRssPageSource({
    feed: FEED,
    fetcherModule: FETCHER_MODULE,
    siteUrl,
    title: 'The Journal',
    description: 'Notes on slow travel.',
  })

const runFeed = async (
  rows: unknown,
  context: Record<string, unknown> = {},
  source: string = pageSource()
) => {
  const calls: Array<Record<string, unknown>> = []
  const getServerSideProps = loadFeedPage(source, async (params) => {
    calls.push(params)
    return rows
  })
  const res = fakeResponse()
  const result = await getServerSideProps({
    req: { headers: { host: 'preview.example.net' } },
    res,
    locale: 'en',
    defaultLocale: 'en',
    ...context,
  })
  return { res, calls, result }
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

const itemsOf = (xml: string): string[] => xml.match(/<item>[\s\S]*?<\/item>/g) || []

const post = (overrides: Record<string, unknown>) => ({
  id: 1,
  title: 'A post',
  slug: 'a-post',
  status: 'published',
  excerpt: 'Short summary.',
  content: '<p>Body</p>',
  createdAt: Date.UTC(2026, 0, 1),
  publishedAt: Date.UTC(2026, 0, 1),
  ...overrides,
})

describe('NextBlogProjectPlugin — RSS feed', () => {
  it('serves /rss.xml through the fetcher a page already emitted, and announces it', async () => {
    const structure = makeStructure({ rssFeed: FEED, withFetcherModule: true })
    await new NextBlogProjectPlugin().runAfter(structure)

    const record = structure.files.get('blog-rss-feed')
    expect(record?.path).toEqual(['pages'])
    expect(record?.files[0].name).toBe('rss.xml')
    const page = fileContent(structure, 'blog-rss-feed')!
    expect(page).toContain(`import blogPosts from '../utils/data-sources/${FETCHER_MODULE}'`)
    expectValidJsx(page)

    const modules = Array.from(structure.files.values()).filter((entry) =>
      entry.files.some((file) => file.name === FETCHER_MODULE)
    )
    expect(modules).toHaveLength(1)
    expect(modules[0].files[0].content).toBe('// emitted by a page')

    const link = fileContent(structure, 'blog-feed-link')!
    expectValidJsx(link)
    expect(link).toContain('type="application/rss+xml"')
    expect(link).toContain('title={"The Journal"}')
    expect(fileContent(structure, '_app')).toContain(
      "import BlogFeedLink from '../components/blog-feed-link'"
    )
    expect(fileContent(structure, '_app')).toContain('<BlogFeedLink />')
  })

  it('emits the posts fetcher itself when no page did', async () => {
    const structure = makeStructure({ rssFeed: FEED })
    await new NextBlogProjectPlugin().runAfter(structure)

    const module = structure.files.get(`resource-utils/data-sources/${FETCHER_MODULE}`)
    expect(module?.path).toEqual(['utils', 'data-sources'])
    expect(module?.files[0].content).toContain('async function fetchData')
    expect(structure.files.has('blog-rss-feed')).toBe(true)
  })

  it('serves no feed when it is off, or when the posts database is unknown', async () => {
    const off = makeStructure({ withFetcherModule: true })
    await new NextBlogProjectPlugin().runAfter(off)
    expect(off.files.has('blog-rss-feed')).toBe(false)
    expect(off.files.has('blog-feed-link')).toBe(false)
    expect(fileContent(off, '_app')).not.toContain('BlogFeedLink')

    const orphan = makeStructure({ rssFeed: FEED, withDataSource: false })
    await new NextBlogProjectPlugin().runAfter(orphan)
    expect(orphan.files.has('blog-rss-feed')).toBe(false)
    expect(fileContent(orphan, '_app')).not.toContain('BlogFeedLink')
  })
})

describe('generated /rss.xml', () => {
  it('asks for the newest published posts, in the page language', async () => {
    const { calls } = await runFeed([], { locale: 'es', defaultLocale: 'en' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      sortBy: 'created_at',
      sortOrder: 'desc',
      locale: 'es',
      limit: BLOG_RSS_FEED_SIZE * 2,
    })
    expect(JSON.parse(calls[0].filters as string)).toEqual([
      { type: 'condition', source: 'status', destination: 'published', operand: '=' },
    ])
  })

  it('writes a valid, cacheable RSS 2.0 document linking each post canonically', async () => {
    const { res, result } = await runFeed([
      post({
        title: 'Tea & <biscuits>',
        slug: 'tea & biscuits',
        authorName: 'Ana "Pip" Ruiz',
        categories: [{ id: 'c1', name: 'Food' }],
        tags: ['tea', 'Food'],
      }),
    ])

    expect(result).toEqual({ props: {} })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/rss+xml; charset=utf-8')
    expect(res.headers['cache-control']).toContain('s-maxage=')
    expectWellFormed(res.body)

    expect(res.body).toContain('<title>The Journal</title>')
    expect(res.body).toContain('<link>https://journal.example.com/blog</link>')
    expect(res.body).toContain('<description>Notes on slow travel.</description>')
    expect(res.body).toContain(
      '<atom:link href="https://journal.example.com/rss.xml" rel="self" type="application/rss+xml"/>'
    )
    expect(res.body).toContain('<language>en</language>')

    const [item] = itemsOf(res.body)
    expect(item).toContain('<title>Tea &amp; &lt;biscuits&gt;</title>')
    expect(item).toContain('<link>https://journal.example.com/blog/tea%20%26%20biscuits</link>')
    expect(item).toContain(
      '<guid isPermaLink="true">https://journal.example.com/blog/tea%20%26%20biscuits</guid>'
    )
    expect(item).toContain('<pubDate>Thu, 01 Jan 2026 00:00:00 GMT</pubDate>')
    expect(item).toContain('<dc:creator>Ana &quot;Pip&quot; Ruiz</dc:creator>')
    // A category and a tag of the same name are listed once.
    expect(item.match(/<category>/g)).toHaveLength(2)
    expect(item).toContain('<category>Food</category>')
    expect(item).toContain('<category>tea</category>')
    expect(item).toContain('<description>Short summary.</description>')
  })

  it('links a secondary language under its prefix, the main one without', async () => {
    const spanish = await runFeed([post({ slug: 'hola' })], { locale: 'es', defaultLocale: 'en' })
    expect(spanish.res.body).toContain('<link>https://journal.example.com/es/blog/hola</link>')
    expect(spanish.res.body).toContain('<link>https://journal.example.com/es/blog</link>')
    expect(spanish.res.body).toContain('href="https://journal.example.com/es/rss.xml"')
    expect(spanish.res.body).toContain('<language>es</language>')

    const main = await runFeed([post({ slug: 'hello' })])
    expect(main.res.body).toContain('<link>https://journal.example.com/blog/hello</link>')
  })

  it('leaves out posts with no address of their own, and orders by publication', async () => {
    const { res } = await runFeed([
      post({
        id: 1,
        slug: 'old-draft-published-today',
        createdAt: Date.UTC(2025, 0, 1),
        publishedAt: Date.UTC(2026, 5, 1),
      }),
      post({
        id: 2,
        slug: 'newer',
        createdAt: Date.UTC(2026, 1, 1),
        publishedAt: Date.UTC(2026, 1, 1),
      }),
      post({ id: 3, slug: '' }),
      post({ id: 4, slug: 'moved', redirectUrl: 'https://elsewhere.example.com' }),
      null,
    ])

    const links = itemsOf(res.body).map((item) => item.match(/<link>([^<]*)<\/link>/)![1])
    expect(links).toEqual([
      'https://journal.example.com/blog/old-draft-published-today',
      'https://journal.example.com/blog/newer',
    ])
    expect(res.body).toContain('<lastBuildDate>Mon, 01 Jun 2026 00:00:00 GMT</lastBuildDate>')
  })

  it(`lists at most ${BLOG_RSS_FEED_SIZE} posts`, async () => {
    const rows = Array.from({ length: BLOG_RSS_FEED_SIZE * 2 }, (_, index) =>
      post({ id: index, slug: `post-${index}`, publishedAt: Date.UTC(2026, 0, 1 + index) })
    )
    const { res } = await runFeed(rows)
    expect(itemsOf(res.body)).toHaveLength(BLOG_RSS_FEED_SIZE)
  })

  it('reads untransformed rows by column name, bare SQL timestamps as UTC', async () => {
    const { res } = await runFeed([
      {
        id: 7,
        title: 'Raw row',
        slug: 'raw-row',
        status: 'published',
        excerpt: '',
        meta_description: '',
        content:
          '<h2>Intro</h2><script>track()</script><p>Caf&eacute; &amp; b&#233;b&#xE9; &mdash; ok&nbsp;now</p>',
        author_name: 'Kim',
        published_at: '2026-03-04 05:06:07',
        tags: 'travel, food',
        category: 'Guides',
      },
    ])

    const [item] = itemsOf(res.body)
    expectWellFormed(res.body)
    expect(item).toContain('<pubDate>Wed, 04 Mar 2026 05:06:07 GMT</pubDate>')
    expect(item).toContain('<dc:creator>Kim</dc:creator>')
    expect(item).toContain('<category>Guides</category>')
    expect(item).toContain('<category>travel</category>')
    expect(item).toContain('<category>food</category>')
    // Markup and scripts gone; an unknown named entity stays as written, escaped.
    expect(item).toContain('<description>Intro Caf&amp;eacute; &amp; bébé — ok now</description>')
  })

  it('shortens a long summary on a character boundary, and drops what XML cannot carry', async () => {
    const long = '😀'.repeat(400)
    const { res } = await runFeed([post({ excerpt: long, title: 'Bell\u0007 \ud800 ok' })])

    expectWellFormed(res.body)
    const [item] = itemsOf(res.body)
    const summary = item.match(/<description>([^<]*)<\/description>/)![1]
    expect(Array.from(summary)).toHaveLength(300)
    expect(summary.endsWith('😀…')).toBe(true)
    expect(item).toContain('<title>Bell  ok</title>')
  })

  it('answers 503 — never an empty feed — when the posts cannot be read', async () => {
    const getServerSideProps = loadFeedPage(pageSource(), async () => {
      throw new Error('connection refused')
    })
    const res = fakeResponse()
    await getServerSideProps({ req: { headers: {} }, res, locale: 'en', defaultLocale: 'en' })

    expect(res.statusCode).toBe(503)
    expect(res.headers['retry-after']).toBe('300')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).not.toContain('<rss')
  })

  it("links from the request's own host only when the pages carry no canonical address", async () => {
    const withoutCanonical = pageSource(null)
    const { res } = await runFeed([post({ slug: 'x' })], {}, withoutCanonical)
    expect(res.body).toContain('<link>https://preview.example.net/blog/x</link>')

    const local = await runFeed(
      [post({ slug: 'x' })],
      { req: { headers: { host: 'localhost:3000' } } },
      withoutCanonical
    )
    expect(local.res.body).toContain('<link>http://localhost:3000/blog/x</link>')

    const forged = await runFeed(
      [post({ slug: 'x' })],
      { req: { headers: { host: 'evil.example"><script>' } } },
      withoutCanonical
    )
    expect(forged.res.body).toContain('<link>/blog/x</link>')
  })

  it('links posts of a blog whose post pages sit at the root', async () => {
    const source = generateBlogRssPageSource({
      feed: { ...FEED, postPath: '/', listingPath: '/' },
      fetcherModule: FETCHER_MODULE,
      siteUrl: 'https://journal.example.com',
      title: 'The Journal',
      description: '',
    })
    const { res } = await runFeed(
      [post({ slug: 'root-post' })],
      { locale: 'es', defaultLocale: 'en' },
      source
    )
    expect(res.body).toContain('<link>https://journal.example.com/es/root-post</link>')
    expect(res.body).toContain('<link>https://journal.example.com/es</link>')
    // No description of its own: the channel repeats its title.
    expect(res.body).toContain('<description>The Journal</description>')
  })
})
