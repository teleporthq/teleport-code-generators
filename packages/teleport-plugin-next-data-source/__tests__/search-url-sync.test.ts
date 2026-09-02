import * as types from '@babel/types'
import generator from '@babel/generator'
import {
  ChunkType,
  FileType,
  ComponentStructure,
  ChunkDefinition,
} from '@teleporthq/teleport-types'
import { createNextArrayMapperPaginationPlugin } from '../src/pagination-plugin'

// A `const TestComponent = (props) => { return <div/> }` shell. The pagination
// plugin prepends the search/pagination state hooks and splices the URL-sync
// effects before the return, so a minimal body is enough to observe them — the
// effects are derived from the UIDL registry, not from the JSX wiring.
const makeComponentChunk = (): ChunkDefinition => {
  const body = types.blockStatement([
    types.returnStatement(
      types.jsxElement(
        types.jsxOpeningElement(types.jsxIdentifier('div'), [], true),
        null,
        [],
        true
      )
    ),
  ])
  const arrow = types.arrowFunctionExpression([types.identifier('props')], body)
  const declaration = types.variableDeclaration('const', [
    types.variableDeclarator(types.identifier('TestComponent'), arrow),
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

// A `data-source-list > cms-list-repeater` UIDL: a paginated + search-enabled
// products list, optionally bound to a URL search-param key.
// tslint:disable-next-line:no-any
const makeUidlNode = (searchUrlParamKey?: string): any => ({
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
          paginated: true,
          perPage: 20,
          searchEnabled: true,
          searchDebounce: 300,
          ...(searchUrlParamKey ? { searchUrlParamKey } : {}),
          nodes: { list: { type: 'element', content: { elementType: 'div' } } },
        },
      },
    },
  },
})

const runPlugin = async (searchUrlParamKey?: string): Promise<string> => {
  const chunk = makeComponentChunk()
  const structure: ComponentStructure = {
    uidl: { name: 'TestComponent', node: makeUidlNode(searchUrlParamKey) },
    chunks: [chunk],
    dependencies: {},
    options: { dataSources: {}, extractedResources: {} },
  } as never
  const plugin = createNextArrayMapperPaginationPlugin()
  await plugin(structure)
  return generator(chunk.content as types.Node).code
}

describe('pagination plugin — search input URL two-way sync (searchUrlParamKey)', () => {
  it('seeds the query from window.location.search and emits paired read-back/write-back effects', async () => {
    const code = await runPlugin('searchKeyword')

    // Initial value seeded from the URL on the client (both the immediate input
    // state AND the debounced value, so a deep link fetches filtered on mount).
    const seedMatches = code.match(
      /new URLSearchParams\(window\.location\.search\)\.get\("searchKeyword"\)/g
    )
    expect(seedMatches).not.toBeNull()
    expect((seedMatches || []).length).toBe(2)
    expect(code).toContain('typeof window !== "undefined"')

    // useRouter is injected for the effects.
    expect(code).toContain('const router = useRouter()')

    // Write-back (debounced query → URL), keyed on the DEBOUNCED value and
    // routed through the shared writer so it cannot race the page's own write.
    expect(code).toContain('const __tqQuerySyncRef = useRef(')
    expect(code).toContain(
      '__tqWriteQueryParam("searchKeyword", ds_0_state.debouncedQuery === "" || ds_0_state.debouncedQuery == null ? undefined : ds_0_state.debouncedQuery)'
    )
    expect(code).toContain('}, [ds_0_state.debouncedQuery, router.isReady])')

    // Read-back (URL → input), functional setState bail-out (loop-free).
    expect(code).toContain('const __urlValue = router.query.searchKeyword')
    expect(code).toContain('setDs_0_searchQuery(prev => prev === __nextValue ? prev : __nextValue)')
    expect(code).toContain('}, [router.query.searchKeyword, router.isReady])')
  })

  it('does NOT emit any URL sync when the repeater has no searchUrlParamKey (unchanged behaviour)', async () => {
    const code = await runPlugin(undefined)

    // Search still works locally (state + debounce), but nothing touches the URL.
    expect(code).toContain('ds_0_searchQuery')
    expect(code).not.toContain('searchKeyword')
    expect(code).not.toContain('window.location.search')
    expect(code).not.toContain('router.replace')
    expect(code).not.toContain('__tqWriteQueryParam')
    expect(code).not.toContain('useRouter')
  })
})
