import * as types from '@babel/types'
import generator from '@babel/generator'
import {
  ChunkType,
  FileType,
  ComponentStructure,
  ChunkDefinition,
} from '@teleporthq/teleport-types'
import { createNextArrayMapperPaginationPlugin } from '../src/pagination-plugin'

/**
 * A PLAIN list — no pagination, no search — fetches with the sort its
 * repeater carries, like every other list: the three paginated / searchable
 * kinds rebuild their params with it, while a plain list's params were kept
 * as they came and the sort never reached the fetch, so the rows arrived in
 * the table's own order whatever the editor said.
 */

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
    sort: { type: 'static', content: 'title' },
    sortDirection: { type: 'static', content: 'asc' },
  },
  state: {
    sort: { type: 'expr', content: 'sortBy.split("-")[0]' },
    sortDirection: { type: 'expr', content: 'sortBy.split("-")[1]' },
  },
  none: {},
}

const runPlugin = async (
  sort: SortKind,
  options: { legacySorts?: boolean; params?: boolean; prefetched?: boolean } = {}
): Promise<string> => {
  const chunk = makeComponentChunk()
  if (options.prefetched) {
    // A page's list, seeded with its server prefetch.
    const provider = (
      (chunk.content as types.VariableDeclaration).declarations[0]
        .init as types.ArrowFunctionExpression
    ).body as types.BlockStatement
    const jsx = (provider.body[0] as types.ReturnStatement).argument as types.JSXElement
    jsx.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('initialData'),
        types.jsxExpressionContainer(
          types.memberExpression(types.identifier('props'), types.identifier('items'))
        )
      )
    )
  }
  if (options.params) {
    // The params the data-source plugin writes for a plain list: its filters.
    const provider = (
      (chunk.content as types.VariableDeclaration).declarations[0]
        .init as types.ArrowFunctionExpression
    ).body as types.BlockStatement
    const jsx = (provider.body[0] as types.ReturnStatement).argument as types.JSXElement
    jsx.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('params'),
        types.jsxExpressionContainer(
          types.objectExpression([
            types.objectProperty(types.identifier('filters'), types.stringLiteral('[]')),
          ])
        )
      )
    )
  }
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
          resource: {
            params: {
              queryColumns: { content: ['title'] },
              ...(options.legacySorts
                ? { sorts: { content: [{ field: 'created_at', order: 'desc' }] } }
                : {}),
            },
          },
          nodes: {
            success: {
              type: 'cms-list-repeater',
              content: {
                renderPropIdentifier: 'post',
                nodes: { list: { type: 'element', content: { elementType: 'div' } } },
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
  return generator(chunk.content as types.Node).code
}

const squash = (code: string) => code.replace(/\s+/g, ' ')

describe('a plain list fetches with its repeater’s sort', () => {
  it('sends a sort the editor fixed', async () => {
    const code = squash(await runPlugin('fixed'))
    expect(code).toContain(
      'params={useMemo(() => ({ sorts: JSON.stringify([{ field: "title", order: "asc" }]) }), [])}'
    )
  })

  it('sends a sort bound to state, and refetches when the state changes', async () => {
    const code = squash(await runPlugin('state'))
    expect(code).toContain(
      'sorts: JSON.stringify([{ field: sortBy.split("-")[0], order: sortBy.split("-")[1] }])'
    )
    expect(code).toMatch(/\}\), \[sortBy\]\)\}/)
  })

  it('adds the sort beside the params the list already had', async () => {
    const code = squash(await runPlugin('fixed', { params: true }))
    expect(code).toContain(
      'params={useMemo(() => ({ filters: "[]", sorts: JSON.stringify([{ field: "title", order: "asc" }]) }), [])}'
    )
  })

  it('keeps the resource’s own sorts first, as every other list does', async () => {
    const code = squash(await runPlugin('fixed', { legacySorts: true }))
    expect(code).toContain('sorts: JSON.stringify([{ field: "created_at", order: "desc" }])')
    expect(code).not.toContain('field: "title"')
  })

  it('drops the prefetched rows for a sort bound to state, which the server cannot know', async () => {
    expect(squash(await runPlugin('state', { prefetched: true }))).not.toContain('initialData')
    expect(squash(await runPlugin('fixed', { prefetched: true }))).toContain(
      'initialData={props.items}'
    )
  })

  it('leaves a list without a sort as it was', async () => {
    const code = squash(await runPlugin('none'))
    expect(code).not.toContain('sorts')
    expect(code).not.toContain('params=')
  })
})
