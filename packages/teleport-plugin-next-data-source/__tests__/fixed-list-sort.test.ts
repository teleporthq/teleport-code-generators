import * as types from '@babel/types'
import generator from '@babel/generator'
import {
  ChunkType,
  FileType,
  ComponentStructure,
  ChunkDefinition,
  UIDLDataCacheConfig,
} from '@teleporthq/teleport-types'
import { createNextArrayMapperPaginationPlugin } from '../src/pagination-plugin'
import { readFixedSort } from '../src/sort-utils'

/**
 * A list whose sort the editor FIXED (a blog listing's newest first: a static
 * column, a static direction) is a static sort. Read as dynamic, it made the
 * list skip the server-side first page — `initialData` is left out for a
 * dynamic sort, since that prefetch ran without one — so the pre-rendered
 * HTML of every blog and help center listing carried no posts, and the
 * browser fetched page 1 a second time. Only a sort bound to state is dynamic.
 */

const CACHE: UIDLDataCacheConfig = {
  enabled: true,
  ttlSeconds: 60,
  client: true,
  server: true,
  versionScope: 'ds1:posts',
}

const element = (name: string, attributes: types.JSXAttribute[] = []) =>
  types.jsxElement(
    types.jsxOpeningElement(types.jsxIdentifier(name), attributes, true),
    null,
    [],
    true
  )

const makeDataProviderJSX = (): types.JSXElement =>
  element('DataProvider', [
    types.jsxAttribute(
      types.jsxIdentifier('name'),
      types.jsxExpressionContainer(types.stringLiteral('items'))
    ),
    types.jsxAttribute(
      types.jsxIdentifier('renderSuccess'),
      types.jsxExpressionContainer(
        types.arrowFunctionExpression(
          [types.identifier('items')],
          element('Repeater', [
            types.jsxAttribute(
              types.jsxIdentifier('renderItem'),
              types.jsxExpressionContainer(
                types.arrowFunctionExpression([types.identifier('post')], element('div'))
              )
            ),
          ])
        )
      )
    ),
  ])

const makeComponentChunk = (): ChunkDefinition => ({
  name: 'jsx-component',
  type: ChunkType.AST,
  fileType: FileType.JS,
  linkAfter: [],
  content: types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('PostsList'),
      types.arrowFunctionExpression(
        [types.identifier('props')],
        types.blockStatement([types.returnStatement(makeDataProviderJSX())])
      )
    ),
  ]),
  meta: {},
})

type SortKind = 'fixed' | 'state' | 'none'

const SORTS: Record<SortKind, Record<string, unknown>> = {
  fixed: {
    sort: { type: 'static', content: 'created_at' },
    sortDirection: { type: 'static', content: 'desc' },
  },
  state: {
    sort: { type: 'expr', content: 'sortBy.split("-")[0]' },
    sortDirection: { type: 'expr', content: 'sortBy.split("-")[1]' },
  },
  none: {},
}

const runPlugin = async (sort: SortKind, cache?: UIDLDataCacheConfig): Promise<string> => {
  const chunk = makeComponentChunk()
  const structure: ComponentStructure = {
    uidl: {
      name: 'PostsList',
      node: {
        type: 'data-source-list',
        content: {
          renderPropIdentifier: 'items',
          resourceDefinition: {
            dataSourceId: 'ds1',
            tableName: 'posts',
            dataSourceType: 'postgresql',
          },
          resource: { params: { queryColumns: { content: ['title'] } } },
          nodes: {
            success: {
              type: 'cms-list-repeater',
              content: {
                renderPropIdentifier: 'post',
                paginated: true,
                perPage: 20,
                searchEnabled: true,
                searchDebounce: 300,
                nodes: { list: { type: 'element', content: { elementType: 'div' } } },
                ...(cache ? { cache } : {}),
                ...SORTS[sort],
              },
            },
          },
        },
      },
    },
    chunks: [chunk],
    dependencies: {},
    options: {
      dataSources: {
        ds1: {
          id: 'ds1',
          name: 'Content',
          type: 'postgresql',
          config: { host: 'h', database: 'd', user: 'u', password: 'p' },
        },
      },
      extractedResources: {},
    },
  } as never
  await createNextArrayMapperPaginationPlugin()(structure)
  return generator(chunk.content as types.Node).code.replace(/\s+/g, ' ')
}

describe('a list sort the editor fixed', () => {
  it('keeps the server-side first page and asks for the sort itself', async () => {
    const code = await runPlugin('fixed')
    expect(code).toContain('initialData=')
    expect(code).toContain('sorts: JSON.stringify([{ field: "created_at", order: "desc" }])')
  })

  it('may peek at the browser cache on mount, as an unsorted list may', async () => {
    expect(await runPlugin('fixed', CACHE)).toContain('ds_0_cached')
    expect(await runPlugin('none', CACHE)).toContain('ds_0_cached')
  })

  it('leaves a sort bound to state dynamic: no first page from the server, no peek', async () => {
    const code = await runPlugin('state', CACHE)
    expect(code).not.toContain('initialData=')
    expect(code).not.toContain('ds_0_cached')
    expect(code).toContain('field: sortBy.split("-")[0]')
  })
})

describe('readFixedSort', () => {
  it('reads a static column and direction, ascending by default', () => {
    expect(
      readFixedSort({ type: 'static', content: 'created_at' }, { type: 'static', content: 'desc' })
    ).toEqual({ field: 'created_at', order: 'desc' })
    expect(readFixedSort({ type: 'static', content: 'title' }, undefined)).toEqual({
      field: 'title',
      order: 'asc',
    })
  })

  it('refuses anything bound to state, and an empty column', () => {
    expect(readFixedSort({ type: 'expr', content: 'sortBy' }, undefined)).toBeUndefined()
    expect(
      readFixedSort({ type: 'static', content: 'title' }, { type: 'expr', content: 'direction' })
    ).toBeUndefined()
    expect(readFixedSort({ type: 'static', content: ' ' }, undefined)).toBeUndefined()
    expect(readFixedSort(undefined, undefined)).toBeUndefined()
  })
})
