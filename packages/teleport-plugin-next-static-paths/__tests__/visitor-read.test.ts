/* tslint:disable:function-constructor */
import * as types from '@babel/types'
import generate from '@babel/generator'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { createStaticPathsPlugin } from '../src/index'

/**
 * The rows a details page is pre-rendered for are the rows its reader may see:
 * listed as the store, a draft product became a page anyone could open by its
 * slug. A public page lists them as a visitor is served them.
 */

const RESOURCE_ID = 'fetch-products-paths'

const AUTH = {
  enabled: true,
  roles: ['admin'],
  pageProtection: {
    'p-admin-products': {
      requiresAuth: true,
      allowedRoles: ['admin'],
      pageName: 'update',
      route: '/admin/products/update',
    },
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

const runStaticPaths = async (folderPath: string[], pageId: string) => {
  const structure = {
    uidl: {
      name: 'ProductDetails',
      node: { type: 'element', content: { elementType: 'container' } },
      outputOptions: {
        pageId,
        folderPath,
        fileName: '[slug]',
        dynamicRouteAttribute: 'slug',
        initialPathsData: {
          exposeAs: { name: 'productPaths', valuePath: ['data'], itemValuePath: ['slug'] },
          resource: { id: RESOURCE_ID, params: {} },
        },
      },
    },
    chunks: [{ name: 'jsx-component', type: 'js', fileType: 'js', content: {}, linkAfter: [] }],
    dependencies: {},
    options: {
      auth: AUTH,
      resources: {
        items: {
          [RESOURCE_ID]: {
            id: RESOURCE_ID,
            name: 'fetch-products-paths',
            params: {
              dataSourceId: { type: 'static', content: 'ds-1' },
              dataSourceType: { type: 'static', content: 'teleport' },
              tableName: { type: 'static', content: 'teleport_products' },
            },
          },
        },
        path: ['resources'],
      },
    },
  } as unknown as ComponentStructure
  const result = await createStaticPathsPlugin()(structure)
  const chunk = result.chunks.find((c) => c.name === 'getStaticPaths')
  const helper = result.chunks.find((c) => c.name === 'prerendered-records')
  const { code } = generate(types.program([chunk!.content as types.Statement]))
  const calls: unknown[][] = []
  const getStaticPaths = new Function(
    'fetchProductsPathsResource',
    `${helper ? helper.content : ''}
    ${code.replace('export async function getStaticPaths', 'async function getStaticPaths')}
    return getStaticPaths`
  )((...args: unknown[]) => {
    calls.push(args)
    return Promise.resolve({ data: [{ slug: 'mug' }] })
  })
  const result2 = await getStaticPaths()
  return { calls, paths: result2.paths }
}

describe('teleport-plugin-next-static-paths: whom the listed rows are read for', () => {
  it('lists a public page’s rows as a visitor is served them', async () => {
    const { calls, paths } = await runStaticPaths(['products'], 'p-product')

    expect(calls).toEqual([[{}, { as: 'visitor' }]])
    expect(paths).toEqual([{ params: { slug: 'mug' } }])
  })

  it('lists them as the store for an admin page only trusted readers open', async () => {
    const { calls } = await runStaticPaths(['admin', 'products', 'update'], 'p-admin-products')

    expect(calls).toEqual([[{}]])
  })
})
