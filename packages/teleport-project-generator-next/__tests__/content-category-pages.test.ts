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

  /**
   * Manual Order. The SAME fixture and expectation as teleport-gui
   * `features/blog/utils/__tests__/arranged-order.spec.ts` ("the category page
   * order the published site mirrors"): the two runtimes must agree.
   */
  it('lists the posts the way the author arranged them, in Manual Order', async () => {
    const arrangedPost = (
      id: string,
      categoryIds: string[],
      sortOrder: number | null,
      createdAt: number
    ) =>
      post({
        id,
        slug: id,
        categories: categoryIds.map((categoryId) => ({ id: categoryId, name: categoryId })),
        sortOrder,
        createdAt,
      })
    // As the fetcher returns them: newest first.
    const rows = [
      arrangedPost('x1', ['billing', 'editing'], 1, 4000),
      arrangedPost('g3', ['guides'], null, 3000),
      arrangedPost('g4', ['guides'], null, 2000),
      arrangedPost('g1', ['guides'], 2, 1000),
      arrangedPost('g2', ['guides'], 1, 900),
      arrangedPost('p1', ['publishing'], 2, 800),
      arrangedPost('s1', ['publishing'], 3, 700),
      arrangedPost('p2', ['publishing'], 1, 600),
      arrangedPost('e1', ['editing'], 1, 500),
      arrangedPost('d1', ['domains'], null, 100),
    ]
    const source = generateContentCategoryPagesSource([
      { key: 'help', settings: CATEGORY_PAGES, fetcherModule: HELP_FETCHER, arranged: true },
    ])
    expectValidModule(source)
    const module = loadModule(source, { helpPosts: async () => rows })

    const { data } = await module.resolveHelpCategoryPage({ slug: 'guides' })
    expect((data as { posts: Array<{ id: string }> }).posts.map((entry) => entry.id)).toEqual([
      'g2',
      'g1',
      'g3',
      'g4',
      'p2',
      'p1',
      's1',
      'd1',
      'e1',
      'x1',
    ])

    // Newest first, as fetched, when the pages are not arranged.
    const newest = loadModule(helpSource(), { helpPosts: async () => rows })
    const { data: unarranged } = await newest.resolveHelpCategoryPage({ slug: 'guides' })
    expect((unarranged as { posts: Array<{ id: string }> }).posts.map((entry) => entry.id)).toEqual(
      rows.map((row) => row.id)
    )
  })

  it('arranges the pages only for a preset whose settings say Manual Order', async () => {
    const structure = makeStructure({ helpCategoryPages: CATEGORY_PAGES })
    ;(structure.uidl.helpCenterSettings as { order?: string }).order = 'manual'
    const arranged = moduleSource(await new NextBlogProjectPlugin().runAfter(structure)) as string
    expect(arranged).toContain('"arranged":true')

    const plain = moduleSource(
      await new NextBlogProjectPlugin().runAfter(
        makeStructure({ helpCategoryPages: CATEGORY_PAGES })
      )
    ) as string
    expect(plain).toContain('"arranged":false')
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
