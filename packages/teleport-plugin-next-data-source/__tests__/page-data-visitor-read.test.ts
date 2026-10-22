import * as types from '@babel/types'
import generator from '@babel/generator'
import {
  ChunkType,
  FileType,
  ComponentStructure,
  ChunkDefinition,
  UIDLAuthentication,
  UIDLDataSource,
} from '@teleporthq/teleport-types'
import { createNextPagesDataSourcePlugin } from '../src/index'

/**
 * A page's lists are pre-rendered from rows its getStaticProps reads, and
 * those rows reach whoever opens the page — and anyone who asks
 * `/_next/data` for its data. They were read as the store: a store's draft
 * and inactive products were painted on the products page, whose page 2 the
 * visitor's own browser then fetched from the active products only. A page
 * now reads `{ as: 'visitor' }`; only an admin page nobody but the store's
 * trusted readers may open reads as the store.
 */

const DS_ID = 'ds1'
const TABLE = 'teleport_products'

const dataSource: UIDLDataSource = {
  id: DS_ID,
  name: 'TeleportHQ database',
  type: 'teleport',
  config: { selectedTables: { [TABLE]: { columns: [{ name: 'id' }, { name: 'name' }] } } },
}

const jsx = (name: string, attrs: types.JSXAttribute[], children: types.JSXElement[] = []) =>
  types.jsxElement(
    types.jsxOpeningElement(types.jsxIdentifier(name), attrs, children.length === 0),
    children.length === 0 ? null : types.jsxClosingElement(types.jsxIdentifier(name)),
    children,
    children.length === 0
  )

const makeListProvider = (): types.JSXElement =>
  jsx('DataProvider', [
    types.jsxAttribute(
      types.jsxIdentifier('name'),
      types.jsxExpressionContainer(types.stringLiteral('items'))
    ),
    types.jsxAttribute(
      types.jsxIdentifier('resourceDefinition'),
      types.jsxExpressionContainer(
        types.objectExpression([
          types.objectProperty(types.stringLiteral('dataSourceId'), types.stringLiteral(DS_ID)),
          types.objectProperty(types.stringLiteral('tableName'), types.stringLiteral(TABLE)),
          types.objectProperty(
            types.stringLiteral('dataSourceType'),
            types.stringLiteral('teleport')
          ),
        ])
      )
    ),
    types.jsxAttribute(
      types.jsxIdentifier('renderSuccess'),
      types.jsxExpressionContainer(
        types.arrowFunctionExpression(
          [types.identifier('items')],
          jsx('Repeater', [
            types.jsxAttribute(
              types.jsxIdentifier('items'),
              types.jsxExpressionContainer(types.identifier('items'))
            ),
            types.jsxAttribute(
              types.jsxIdentifier('renderItem'),
              types.jsxExpressionContainer(
                types.arrowFunctionExpression([types.identifier('product')], jsx('div', []))
              )
            ),
          ])
        )
      )
    ),
  ])

// tslint:disable-next-line:no-any
const makeListNode = (paginated: boolean): any => ({
  type: 'data-source-list',
  content: {
    renderPropIdentifier: 'items',
    resourceDefinition: { dataSourceId: DS_ID, tableName: TABLE, dataSourceType: 'teleport' },
    resource: { id: 'TQ_products', params: {} },
    nodes: {
      success: {
        type: 'cms-list-repeater',
        content: {
          renderPropIdentifier: 'product',
          paginated,
          perPage: 20,
          searchEnabled: false,
          nodes: { list: { type: 'element', content: { elementType: 'div' } } },
        },
      },
    },
  },
})

const protection = (route: string, allowedRoles: string[]) => ({
  requiresAuth: true,
  allowedRoles,
  pageName: route.split('/').pop(),
  route,
})

// An admin panel admitting admins, with one screen staff may open too.
const AUTH = {
  enabled: true,
  roles: ['admin', 'staff', 'user'],
  pageProtection: {
    'p-products': protection('/admin/products', ['admin']),
    'p-dashboard': protection('/admin/dashboard', ['admin', 'staff']),
  },
  folderProtection: {
    'f-admin': {
      requiresAuth: true,
      allowedRoles: ['admin'],
      folderName: 'admin-panel',
      parentId: 'pages',
      children: { 'p-products': 'page', 'p-dashboard': 'page' },
    },
  },
} as unknown as UIDLAuthentication

const runPage = async (
  paginated: boolean,
  outputOptions: { folderPath: string[]; fileName: string; pageId?: string }
): Promise<string> => {
  const provider = makeListProvider()
  const chunk: ChunkDefinition = {
    name: 'jsx-component',
    type: ChunkType.AST,
    fileType: FileType.JS,
    linkAfter: [],
    content: types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('ProductsList'),
        types.arrowFunctionExpression(
          [types.identifier('props')],
          types.blockStatement([types.returnStatement(jsx('div', [], [provider]))])
        )
      ),
    ]),
    meta: { nodesLookup: { provider } },
  }
  const structure: ComponentStructure = {
    uidl: { name: 'ProductsList', node: makeListNode(paginated), outputOptions },
    chunks: [chunk],
    dependencies: {},
    options: { dataSources: { [DS_ID]: dataSource }, extractedResources: {}, auth: AUTH },
  } as never
  await createNextPagesDataSourcePlugin()(structure)
  const getStaticProps = structure.chunks.find((c) => c.name === 'getStaticProps')
  return generator(getStaticProps!.content as types.Node).code.replace(/\s+/g, ' ')
}

describe("a page's own data", () => {
  it('reads a paginated list page as a visitor: the first page and the count', async () => {
    const staticProps = await runPage(true, { folderPath: [], fileName: 'products' })

    expect(staticProps).toContain(
      'teleportTeleportProductsDs1.fetchData({ page: 1, perPage: 20 }, { as: "visitor" })'
    )
    expect(staticProps).toContain('teleportTeleportProductsDs1.fetchCount({}, { as: "visitor" })')
  })

  it('reads a plain list page as a visitor', async () => {
    const staticProps = await runPage(false, { folderPath: [], fileName: 'products' })

    expect(staticProps).toContain('teleportTeleportProductsDs1.fetchData({}, { as: "visitor" })')
  })

  it('reads as the store only on an admin page nobody but its trusted readers opens', async () => {
    const admin = await runPage(true, {
      folderPath: ['admin'],
      fileName: 'products',
      pageId: 'p-products',
    })
    expect(admin).toContain('teleportTeleportProductsDs1.fetchData({ page: 1, perPage: 20 })')
    expect(admin).toContain('teleportTeleportProductsDs1.fetchCount()')
    expect(admin).not.toContain('visitor')

    // Staff may open this one, and staff read what a visitor reads.
    const staffScreen = await runPage(true, {
      folderPath: ['admin'],
      fileName: 'dashboard',
      pageId: 'p-dashboard',
    })
    expect(staffScreen).toContain('fetchData({ page: 1, perPage: 20 }, { as: "visitor" })')
  })
})
