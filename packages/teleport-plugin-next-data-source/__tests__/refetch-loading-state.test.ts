import * as types from '@babel/types'
import generator from '@babel/generator'
import {
  ChunkType,
  FileType,
  ComponentStructure,
  ChunkDefinition,
} from '@teleporthq/teleport-types'
import { createNextArrayMapperPaginationPlugin } from '../src/pagination-plugin'

// A `<DataProvider>` shaped like the one `generateDataSourceNode` emits for an
// array mapper: a `renderSuccess` holding a `Repeater` (that is what marks it as
// an array-mapper provider) and, when the mapper has a loading state designed,
// a `renderLoading` slot.
const makeDataProviderJSX = (options: { withLoadingSlot: boolean }): types.JSXElement => {
  const repeater = types.jsxElement(
    types.jsxOpeningElement(
      types.jsxIdentifier('Repeater'),
      [
        types.jsxAttribute(
          types.jsxIdentifier('renderItem'),
          types.jsxExpressionContainer(
            types.arrowFunctionExpression(
              [types.identifier('product'), types.identifier('index')],
              types.jsxElement(
                types.jsxOpeningElement(types.jsxIdentifier('div'), [], true),
                null,
                [],
                true
              )
            )
          )
        ),
      ],
      true
    ),
    null,
    [],
    true
  )

  const attributes: types.JSXAttribute[] = [
    types.jsxAttribute(
      types.jsxIdentifier('name'),
      types.jsxExpressionContainer(types.stringLiteral('items'))
    ),
    types.jsxAttribute(
      types.jsxIdentifier('renderSuccess'),
      types.jsxExpressionContainer(
        types.arrowFunctionExpression([types.identifier('items')], repeater)
      )
    ),
  ]

  if (options.withLoadingSlot) {
    attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('renderLoading'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression(
            [],
            types.jsxElement(
              types.jsxOpeningElement(types.jsxIdentifier('p'), [], true),
              null,
              [],
              true
            )
          )
        )
      )
    )
  }

  return types.jsxElement(
    types.jsxOpeningElement(types.jsxIdentifier('DataProvider'), attributes, true),
    null,
    [],
    true
  )
}

const makeComponentChunk = (dataProvider: types.JSXElement): ChunkDefinition => {
  const body = types.blockStatement([types.returnStatement(dataProvider)])
  const arrow = types.arrowFunctionExpression([types.identifier('props')], body)
  const declaration = types.variableDeclaration('const', [
    types.variableDeclarator(types.identifier('ProductsList'), arrow),
  ])
  return {
    name: 'jsx-component',
    type: ChunkType.AST,
    fileType: FileType.JS,
    linkAfter: [],
    content: declaration,
    meta: {},
  }
}

// A `data-source-list > cms-list-repeater` UIDL. `category` decides which
// DataProvider updater runs, so every one of them is covered below.
const makeUidlNode = (
  category: 'paginated+search' | 'paginated-only' | 'search-only' | 'plain'
  // tslint:disable-next-line:no-any
): any => ({
  type: 'data-source-list',
  content: {
    renderPropIdentifier: 'items',
    resourceDefinition: {
      dataSourceId: 'ds1',
      tableName: 'products',
      dataSourceType: 'postgresql',
    },
    resource: { params: { queryColumns: { content: ['name'] } } },
    nodes: {
      success: {
        type: 'cms-list-repeater',
        content: {
          renderPropIdentifier: 'product',
          paginated: category === 'paginated+search' || category === 'paginated-only',
          perPage: 20,
          searchEnabled: category === 'paginated+search' || category === 'search-only',
          searchDebounce: 300,
          nodes: { list: { type: 'element', content: { elementType: 'div' } } },
        },
      },
    },
  },
})

const runPlugin = async (options: {
  category?: 'paginated+search' | 'paginated-only' | 'search-only' | 'plain'
  withLoadingSlot?: boolean
}): Promise<string> => {
  const dataProvider = makeDataProviderJSX({ withLoadingSlot: options.withLoadingSlot !== false })
  const chunk = makeComponentChunk(dataProvider)
  const structure: ComponentStructure = {
    uidl: { name: 'ProductsList', node: makeUidlNode(options.category || 'paginated+search') },
    chunks: [chunk],
    dependencies: {},
    options: { dataSources: {}, extractedResources: {} },
  } as never
  const plugin = createNextArrayMapperPaginationPlugin()
  await plugin(structure)
  return generator(chunk.content as types.Node).code
}

describe('pagination plugin — refetch loading state', () => {
  it('declares the in-flight tracking hooks and drives persistDataDuringLoading from them', async () => {
    const code = await runPlugin({})

    // The state definition that displays the loading state, plus the counter
    // that keeps it honest across overlapping requests.
    expect(code).toContain('const ds_0_fetchesInFlight = useRef(0)')
    expect(code).toContain('const [ds_0_isFetching, setDs_0_isFetching] = useState(false)')

    // While a fetch is in flight the provider stops persisting the previous rows
    // and falls through to its renderLoading slot.
    expect(code).toContain('persistDataDuringLoading={!ds_0_isFetching}')
    expect(code).not.toContain('persistDataDuringLoading={true}')
  })

  it('raises the flag when the request starts and lowers it once it settles', async () => {
    const code = await runPlugin({})

    // Raised synchronously, before the request is issued, so the flip is batched
    // with the provider's own switch to its loading status (no intermediate paint).
    expect(code).toMatch(
      /ds_0_fetchesInFlight\.current \+= 1;?\s*setDs_0_isFetching\(true\);?\s*return fetch\(/
    )

    // Lowered in `finally`, so a rejected request cannot leave it stuck on.
    expect(code).toContain('.finally(() => {')
    expect(code).toContain('ds_0_fetchesInFlight.current -= 1')
    expect(code).toContain('setDs_0_isFetching(false)')

    // Only the LAST outstanding request lowers the flag, and the counter is
    // clamped so a late settle from a remounted provider cannot drive it negative.
    expect(code).toContain('if (ds_0_fetchesInFlight.current <= 0)')
    expect(code).toContain('ds_0_fetchesInFlight.current = 0')
  })

  it('keeps fetchData referentially stable so the provider does not refetch in a loop', async () => {
    const code = await runPlugin({})

    // The wrapped callback only closes over a ref object and a setState setter,
    // both stable across renders — the empty dependency array stays correct.
    expect(code).toMatch(/fetchData=\{useCallback\(params => \{[\s\S]*?\}, \[\]\)\}/)
  })

  it.each([
    ['paginated+search' as const],
    ['paginated-only' as const],
    ['search-only' as const],
    ['plain' as const],
  ])('wires the loading state for the %s data source category', async (category) => {
    const code = await runPlugin({ category })

    expect(code).toContain('const [ds_0_isFetching, setDs_0_isFetching] = useState(false)')
    expect(code).toContain('persistDataDuringLoading={!ds_0_isFetching}')
    expect(code).toContain('setDs_0_isFetching(true)')
  })

  it('is idempotent — a second pass does not double-wrap fetchData', async () => {
    const dataProvider = makeDataProviderJSX({ withLoadingSlot: true })
    const chunk = makeComponentChunk(dataProvider)
    const structure: ComponentStructure = {
      uidl: { name: 'ProductsList', node: makeUidlNode('paginated+search') },
      chunks: [chunk],
      dependencies: {},
      options: { dataSources: {}, extractedResources: {} },
    } as never
    const plugin = createNextArrayMapperPaginationPlugin()

    await plugin(structure)
    await plugin(structure)

    const code = generator(chunk.content as types.Node).code
    expect((code.match(/setDs_0_isFetching\(true\)/g) || []).length).toBe(1)
    expect((code.match(/ds_0_fetchesInFlight\.current \+= 1/g) || []).length).toBe(1)
  })

  it('leaves an unmemoized fetchData alone rather than building a refetch loop', async () => {
    // A `fetchData` that is re-created on every render already refetches on
    // every render (DataProvider keys its effect on the fetcher identity);
    // adding a setState to it would make that loop self-sustaining. Such a
    // provider is skipped entirely.
    const dataProvider = makeDataProviderJSX({ withLoadingSlot: true })
    dataProvider.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('fetchData'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression(
            [types.identifier('params')],
            types.callExpression(types.identifier('fetch'), [types.stringLiteral('/api/items')])
          )
        )
      )
    )
    const chunk = makeComponentChunk(dataProvider)
    const structure: ComponentStructure = {
      // `plain` is the only category whose updater keeps an existing fetchData
      // instead of replacing it with the memoized one.
      uidl: { name: 'ProductsList', node: makeUidlNode('plain') },
      chunks: [chunk],
      dependencies: {},
      options: { dataSources: {}, extractedResources: {} },
    } as never
    await createNextArrayMapperPaginationPlugin()(structure)

    const code = generator(chunk.content as types.Node).code
    expect(code).not.toContain('ds_0_isFetching')
    expect(code).not.toContain('ds_0_fetchesInFlight')
  })

  it('leaves a provider without a designed loading state untouched', async () => {
    // With no renderLoading slot, dropping persistDataDuringLoading would blank
    // the list out mid-refetch instead of showing something — keeping the
    // previous rows is the better of the two, so nothing is wired.
    const code = await runPlugin({ withLoadingSlot: false })

    expect(code).not.toContain('ds_0_isFetching')
    expect(code).not.toContain('ds_0_fetchesInFlight')
    expect(code).toContain('persistDataDuringLoading={true}')
  })
})
