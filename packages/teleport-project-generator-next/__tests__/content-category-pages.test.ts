import { parse } from '@babel/parser'
import {
  FileType,
  InMemoryFileRecord,
  ProjectPluginStructure,
  UIDLContentCategoryPages,
  UIDLEcommerceCategory,
} from '@teleporthq/teleport-types'
import { ContentTables } from '@teleporthq/teleport-shared'
import { generateSafeFileName } from '@teleporthq/teleport-plugin-next-data-source'
import { NextBlogProjectPlugin } from '../src/blog/project-plugin'
import {
  CATEGORY_PAGE_POST_LIMIT,
  generateContentCategoryPagesSource,
} from '../src/blog/content-category-pages'

/**
 * A content preset's category pages (`/help/category/[slug]`) read their data
 * server-side through `content-category-pages.js`: the category at the slug,
 * localized, with its ancestors, its subcategories and its published posts —
 * so the pre-rendered page carries the list crawlers index. The page's
 * `getStaticProps` / `getStaticPaths` import the two functions by the names
 * teleport-shared derives from the preset key.
 */

const DATA_SOURCE_ID = 'ds-help-1234567890'
const HELP_FETCHER = generateSafeFileName('teleport', 'teleport_help_articles', DATA_SOURCE_ID)
const BLOG_FETCHER = generateSafeFileName('teleport', 'teleport_blog_posts', DATA_SOURCE_ID)

const CATEGORY_PAGES: UIDLContentCategoryPages = {
  dataSourceId: DATA_SOURCE_ID,
  postPath: '/help',
  postUrlField: 'slug',
  categoryPath: '/help/category',
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
    description: 'Step by step.',
    translations: { fr: { name: 'Guides FR', description: 'Pas à pas.' } },
    children: [
      category('publishing', {
        parentId: 'guides',
        children: [category('domains', { parentId: 'publishing' })],
      }),
      category('editing', { parentId: 'guides' }),
    ],
  }),
  category('billing', { icon: '<svg/>' }),
]

const makeStructure = (params: {
  helpCategoryPages?: UIDLContentCategoryPages
  blogCategoryPages?: UIDLContentCategoryPages
  withDataSource?: boolean
}): ProjectPluginStructure => {
  const files = new Map<string, InMemoryFileRecord>()
  return {
    uidl: {
      name: 'docs',
      globals: { env: {} },
      ...(params.withDataSource === false
        ? {}
        : {
            dataSources: {
              [DATA_SOURCE_ID]: {
                id: DATA_SOURCE_ID,
                type: 'teleport',
                name: 'Content',
                config: {
                  selectedTables: {
                    teleport_help_articles: { columns: [] },
                    teleport_blog_posts: { columns: [] },
                  },
                },
              },
            },
          }),
      blogSettings: {
        categories: [],
        ...(params.blogCategoryPages ? { categoryPages: params.blogCategoryPages } : {}),
      },
      helpCenterSettings: {
        categories: HELP_TREE,
        ...(params.helpCategoryPages ? { categoryPages: params.helpCategoryPages } : {}),
      },
    },
    files,
    dependencies: {},
    devDependencies: {},
    template: { files: [], subFolders: [] },
  } as unknown as ProjectPluginStructure
}

const moduleSource = (structure: ProjectPluginStructure): string | undefined =>
  structure.files.get('content-category-pages')?.files?.[0]?.content as string | undefined

const expectValidModule = (source: string) => {
  expect(() => parse(source, { sourceType: 'module' })).not.toThrow()
}

type Fetcher = (params: Record<string, unknown>) => Promise<unknown>

/** The generated module's exports, with the taxonomy and the fetchers it imports replaced. */
const loadModule = (
  source: string,
  fakes: { helpPosts?: Fetcher; blogPosts?: Fetcher; helpTree?: unknown; blogTree?: unknown }
) => {
  const body = source
    .replace(/^import .*$/gm, '')
    .replace(/^export async function/gm, 'async function')
  const exportNames = Array.from(source.matchAll(/^export async function (\w+)/gm)).map(
    (match) => match[1]
  )
  const localize = (tree: UIDLEcommerceCategory[], locale: string | null) => {
    const resolve = (nodes: UIDLEcommerceCategory[]): UIDLEcommerceCategory[] =>
      nodes.map((node) => {
        const override = locale && node.translations ? node.translations[locale] : null
        return {
          ...node,
          name: (override && override.name) || node.name,
          description: (override && override.description) || node.description,
          children: resolve(node.children || []),
        }
      })
    return resolve(tree)
  }
  // tslint:disable-next-line:function-constructor
  const factory = new Function(
    'HELP_CATEGORY_TREE',
    'BLOG_CATEGORY_TREE',
    'localizeCategoryTree',
    'helpPosts',
    'blogPosts',
    `${body}\nreturn { ${exportNames.join(', ')} }`
  )
  return factory(
    fakes.helpTree ?? HELP_TREE,
    fakes.blogTree ?? [],
    localize,
    { fetchData: fakes.helpPosts ?? (async () => []) },
    { fetchData: fakes.blogPosts ?? (async () => []) }
  ) as Record<string, (params?: Record<string, unknown>) => Promise<{ data: unknown }>>
}

const helpSource = () =>
  generateContentCategoryPagesSource([
    { key: 'help', settings: CATEGORY_PAGES, fetcherModule: HELP_FETCHER },
  ])

const post = (overrides: Record<string, unknown>) => ({
  id: 'p1',
  title: 'Connect a domain',
  slug: 'connect-a-domain',
  status: 'published',
  ...overrides,
})

describe('the content-category-pages module', () => {
  it('is emitted only for a preset whose settings carry category pages, importing that preset’s fetcher', async () => {
    const plugin = new NextBlogProjectPlugin()

    const without = await plugin.runAfter(makeStructure({}))
    expect(moduleSource(without)).toBeUndefined()

    const withHelp = await plugin.runAfter(makeStructure({ helpCategoryPages: CATEGORY_PAGES }))
    const source = moduleSource(withHelp)
    expect(source).toBeDefined()
    expectValidModule(source as string)
    expect(source).toContain(`import helpPosts from './utils/data-sources/${HELP_FETCHER}'`)
    expect(source).not.toContain('blogPosts')
    expect(source).toContain(
      `export async function ${ContentTables.contentCategoryPageResolverName('help')}(params)`
    )
    expect(source).toContain(
      `export async function ${ContentTables.contentCategoryPathsListerName('help')}()`
    )
    // The fetcher module the import names exists.
    expect(withHelp.files.get(`resource-utils/data-sources/${HELP_FETCHER}`)).toBeDefined()
  })

  it('serves both presets from one module when both have category pages', async () => {
    const structure = await new NextBlogProjectPlugin().runAfter(
      makeStructure({
        helpCategoryPages: CATEGORY_PAGES,
        blogCategoryPages: { ...CATEGORY_PAGES, postPath: '/blog', categoryPath: '/blog/category' },
      })
    )
    const source = moduleSource(structure) as string
    expectValidModule(source)
    expect(source).toContain(`import blogPosts from './utils/data-sources/${BLOG_FETCHER}'`)
    expect(source).toContain(`import helpPosts from './utils/data-sources/${HELP_FETCHER}'`)
    expect(source).toContain('export async function resolveBlogCategoryPage')
    expect(source).toContain('export async function resolveHelpCategoryPage')
  })

  it('emits nothing for a preset whose data source the UIDL does not carry', async () => {
    const structure = await new NextBlogProjectPlugin().runAfter(
      makeStructure({ helpCategoryPages: CATEGORY_PAGES, withDataSource: false })
    )
    expect(moduleSource(structure)).toBeUndefined()
  })

  it('resolves a category at its slug: localized, with ancestors, subcategories and its published posts', async () => {
    const calls: Array<Record<string, unknown>> = []
    const module = loadModule(helpSource(), {
      helpPosts: async (params) => {
        calls.push(params)
        return [
          post({}),
          post({ id: 'p2', slug: 'old', redirectUrl: '/help/connect-a-domain' }),
          post({ id: 'p3', slug: '' }),
        ]
      },
    })

    const { data } = await module.resolveHelpCategoryPage({ slug: 'publishing', locale: 'fr' })
    expect(data).toMatchObject({
      id: 'publishing',
      name: 'Publishing',
      slug: 'publishing',
      href: '/help/category/publishing',
      breadcrumbs: [{ id: 'guides', name: 'Guides FR', href: '/help/category/guides' }],
      pathIds: ['guides', 'publishing'],
      children: [{ id: 'domains', href: '/help/category/domains', childCount: 0 }],
      postCount: 1,
    })
    const page = data as { posts: Array<{ id: string; href: string }> }
    // The redirecting post and the one without an address are left out.
    expect(page.posts.map((entry) => [entry.id, entry.href])).toEqual([
      ['p1', '/help/connect-a-domain'],
    ])

    // One read: the category's published posts, newest first, in the locale.
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      limit: CATEGORY_PAGE_POST_LIMIT,
      sortBy: 'created_at',
      sortOrder: 'desc',
      locale: 'fr',
    })
    expect(JSON.parse(calls[0].filters as string)).toEqual([
      { type: 'condition', source: 'status', destination: 'published', operand: '=' },
      {
        type: 'condition',
        source: 'category_filter_ids',
        destination: 'publishing',
        operand: 'array_overlap',
      },
    ])
  })

  it('answers null for a slug no category has, without reading the posts', async () => {
    const reads: unknown[] = []
    const module = loadModule(helpSource(), {
      helpPosts: async (params) => {
        reads.push(params)
        return []
      },
    })

    expect(await module.resolveHelpCategoryPage({ slug: 'nope' })).toEqual({ data: null })
    expect(await module.resolveHelpCategoryPage({})).toEqual({ data: null })
    expect(reads).toEqual([])
  })

  it('lists every category of the tree, nested ones included, for getStaticPaths', async () => {
    const module = loadModule(helpSource(), {})

    const { data } = await module.listHelpCategoryPaths()
    expect(data).toEqual([
      { slug: 'guides' },
      { slug: 'publishing' },
      { slug: 'domains' },
      { slug: 'editing' },
      { slug: 'billing' },
    ])
  })
})
