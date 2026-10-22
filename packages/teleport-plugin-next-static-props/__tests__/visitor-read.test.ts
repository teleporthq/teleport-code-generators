import generator from '@babel/generator'
import * as types from '@babel/types'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { createStaticPropsPlugin } from '../src/index'

/**
 * A details page's row is what it renders, and its page data reaches whoever
 * opens the address (and `/_next/data`). It was read as the store: a draft
 * product's page answered anyone who knew its slug, and a member's profile
 * page carried any account the address named. The row is now read as a
 * visitor is served it — except on an admin page nobody but the store's
 * trusted readers may open.
 */

const RESOURCE_ID = 'fetch-detail'

const dataSourceResource = (tableName: string) => ({
  id: RESOURCE_ID,
  name: `fetch-${tableName}-detail`,
  params: {
    dataSourceId: { type: 'static', content: 'ds-1' },
    dataSourceType: { type: 'static', content: 'teleport' },
    tableName: { type: 'static', content: tableName },
  },
})

const AUTH = {
  enabled: true,
  roles: ['admin', 'user'],
  pageProtection: {
    'p-admin-products': {
      requiresAuth: true,
      allowedRoles: ['admin'],
      pageName: 'update',
      route: '/admin/products/update',
    },
    'p-profile': { requiresAuth: true, allowedRoles: [], pageName: 'profile', route: '/profile' },
  },
  folderProtection: {
    'f-admin': {
      requiresAuth: true,
      allowedRoles: ['admin'],
      folderName: 'admin-panel',
      parentId: 'pages',
      children: { 'p-admin-products': 'page' },
    },
  },
}

const getStaticPropsCode = async (options: {
  folderPath: string[]
  pageId: string
  exposeAs: string
  resource: Record<string, unknown> | { name: string; dependency: unknown }
}): Promise<string> => {
  const isExternal = 'dependency' in options.resource
  const structure = {
    uidl: {
      name: 'Details',
      node: { type: 'element', content: { elementType: 'container' } },
      outputOptions: {
        pageId: options.pageId,
        folderPath: options.folderPath,
        fileName: '[id]',
        initialPropsData: {
          exposeAs: { name: options.exposeAs, valuePath: ['data', '0'] },
          resource: isExternal ? options.resource : { id: RESOURCE_ID, params: {} },
        },
      },
    },
    chunks: [],
    dependencies: {},
    options: {
      skipI18n: true,
      auth: AUTH,
      resources: {
        items: isExternal ? {} : { [RESOURCE_ID]: options.resource },
        path: ['resources'],
      },
    },
  } as unknown as ComponentStructure
  const result = await createStaticPropsPlugin()(structure)
  const chunk = result.chunks.find((c) => c.name === 'getStaticProps')
  return generator(chunk!.content as types.Node).code.replace(/\s+/g, ' ')
}

describe('teleport-plugin-next-static-props: whom a details page reads for', () => {
  it('reads a public page’s row as a visitor', async () => {
    const code = await getStaticPropsCode({
      folderPath: ['products'],
      pageId: 'p-product',
      exposeAs: 'product',
      resource: dataSourceResource('teleport_products'),
    })

    expect(code).toMatch(
      /await fetchTeleportProductsDetailResource\(\{[^)]*\}, \{ as: "visitor" \}\)/
    )
    // A row it is not served is a page that does not exist.
    expect(code).toContain('notFound: true')
  })

  it('reads the row as the store on an admin page only trusted readers open', async () => {
    const code = await getStaticPropsCode({
      folderPath: ['admin', 'products', 'update'],
      pageId: 'p-admin-products',
      exposeAs: 'product',
      resource: dataSourceResource('teleport_products'),
    })

    expect(code).toMatch(/await fetchTeleportProductsDetailResource\(\{[^)]*\}\)/)
    expect(code).not.toContain('visitor')
  })

  it('renders a page without a row its reader is never served, instead of reading it as the store', async () => {
    const code = await getStaticPropsCode({
      folderPath: ['profile'],
      pageId: 'p-profile',
      exposeAs: 'user',
      resource: dataSourceResource('users'),
    })

    // No read of the accounts table at all, and no 404 for the member.
    expect(code).not.toContain('fetchUsersDetailResource(')
    expect(code).toContain('try { return { props: { ...context?.params, user: null } }; }')
  })

  it('hands another package’s function only its own arguments', async () => {
    const code = await getStaticPropsCode({
      folderPath: ['help', 'category'],
      pageId: 'p-category',
      exposeAs: 'category',
      resource: {
        name: 'resolveHelpCategoryPage',
        dependency: { type: 'local', path: '@/content-category-pages' },
      },
    })

    expect(code).toMatch(/await resolveHelpCategoryPage\(\{[^)]*\}\)/)
    expect(code).not.toContain('visitor')
  })
})
