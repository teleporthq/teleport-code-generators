import generator from '@babel/generator'
import * as types from '@babel/types'
import { createStateDataSourcePlugin } from '../src/state-data-source-plugin'
import { generateContentCategoryPagesSource } from '../src/blog/content-category-pages'
import { generateContentSiteIndexSource } from '../src/blog/content-site-index'
import { generateBlogRssPageSource } from '../src/blog/rss-feed'

/**
 * What a page renders is read as a visitor is served the store's tables: the
 * page data reaches whoever opens the page. The page-load values a page seeds
 * its states with (a home page's featured strip) were read as the store, a
 * draft product among them; the content pages and feeds read their posts the
 * same way the lists do. Only an admin page nobody but the store's trusted
 * readers may open reads as the store.
 */

const DS_ID = '595ce5d7-d36c-4767-95e1-610e9c9831d6'
const FETCHER_FILE = 'teleport-teleport_products-595ce5d7'

const AUTH = {
  enabled: true,
  roles: ['admin'],
  pageProtection: {
    'p-curations': {
      requiresAuth: true,
      allowedRoles: ['admin'],
      pageName: 'create',
      route: '/admin/curations/create',
    },
  },
  folderProtection: {
    'f-admin': {
      requiresAuth: true,
      allowedRoles: ['admin'],
      folderName: 'admin-panel',
      parentId: 'pages',
      children: { 'p-curations': 'page' },
    },
  },
}

const FEATURED =
  'SELECT tp.slug, fpc.blurb FROM featured_product_curations fpc INNER JOIN teleport_products tp ON tp.id = fpc.product_id'

const stateFetchCode = async (outputOptions: Record<string, unknown>): Promise<string> => {
  const result = await createStateDataSourcePlugin()({
    uidl: {
      name: 'Homepage',
      stateDefinitions: {
        featured: {
          type: 'array',
          defaultValue: [],
          dataSourceBinding: { dataSourceId: DS_ID, refPath: ['teleport_products'] },
          query: FEATURED,
        },
      },
      node: { type: 'element', content: { elementType: 'container' } },
      outputOptions,
    },
    chunks: [],
    dependencies: {},
    options: {
      auth: AUTH,
      dataSources: { [DS_ID]: { id: DS_ID, type: 'teleport', config: {} } },
      extractedResources: {
        [`utils/${FETCHER_FILE}`]: {
          fileName: FETCHER_FILE,
          fileType: 'js',
          path: ['utils', 'data-sources'],
          content: '// stub',
        },
      },
    },
  } as never)
  const chunk = result.chunks.find((c: { name: string }) => c.name === 'getStaticProps')
  return generator(chunk!.content as types.Node).code.replace(/\s+/g, ' ')
}

describe('the page-load values a page renders', () => {
  it('are read as a visitor is served them', async () => {
    const code = await stateFetchCode({ folderPath: [], fileName: 'index' })
    expect(code).toContain(
      `.fetchData({ rawQuery: ${JSON.stringify(FEATURED)} }, { as: "visitor" })`
    )
  })

  it('are read as the store on an admin page only trusted readers open', async () => {
    const code = await stateFetchCode({
      folderPath: ['admin', 'curations'],
      fileName: 'create',
      pageId: 'p-curations',
    })
    expect(code).toContain(`.fetchData({ rawQuery: ${JSON.stringify(FEATURED)} })`)
    expect(code).not.toContain('visitor')
  })
})

describe('the content pages and feeds', () => {
  const everyPostReadIsAVisitorRead = (source: string) => {
    expect(source).toContain("var PAGE_READ = { as: 'visitor' }")
    const reads = source.split('.fetchData(').slice(1)
    expect(reads.length).toBeGreaterThan(0)
    reads.forEach((read) => expect(read).toMatch(/^\{[\s\S]*?\}, PAGE_READ\)/))
  }

  it('read their posts as a visitor is served them', () => {
    everyPostReadIsAVisitorRead(
      generateContentCategoryPagesSource([
        {
          key: 'help',
          settings: {
            dataSourceId: 'ds1',
            postPath: '/help',
            postUrlField: 'slug',
            categoryPath: '/help/category',
          },
          fetcherModule: 'teleport-teleport_help_posts-ds1',
        },
      ] as never)
    )
    everyPostReadIsAVisitorRead(
      generateContentSiteIndexSource(
        [
          {
            key: 'help',
            settings: {
              dataSourceId: 'ds1',
              postPath: '/help',
              postUrlField: 'slug',
              title: 'Help Center',
            },
            fetcherModule: 'teleport-teleport_help_posts-ds1',
          },
        ] as never,
        'https://example.com'
      )
    )
    everyPostReadIsAVisitorRead(
      generateBlogRssPageSource({
        feed: {
          dataSourceId: 'ds1',
          postPath: '/blog',
          postUrlField: 'slug',
          listingPath: '/blog',
        },
        fetcherModule: 'teleport-teleport_blog_posts-ds1',
        siteUrl: 'https://example.com',
        title: 'Journal',
        description: 'Notes',
      } as never)
    )
  })
})
