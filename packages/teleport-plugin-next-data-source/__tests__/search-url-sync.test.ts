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
const makeUidlNode = (searchUrlParamKey?: string, pageUrlParamKey?: string): any => ({
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
          ...(pageUrlParamKey ? { pageUrlParamKey } : {}),
          nodes: { list: { type: 'element', content: { elementType: 'div' } } },
        },
      },
    },
  },
})

interface RunOptions {
  paginated?: boolean
  pageUrlParamKey?: string
  infiniteScroll?: boolean
}

const runPlugin = async (searchUrlParamKey?: string, options: RunOptions = {}): Promise<string> => {
  const chunk = makeComponentChunk()
  const node = makeUidlNode(searchUrlParamKey, options.pageUrlParamKey)
  node.content.nodes.success.content.paginated = options.paginated ?? true
  node.content.nodes.success.content.infiniteScroll = !!options.infiniteScroll
  const structure: ComponentStructure = {
    uidl: { name: 'TestComponent', node },
    chunks: [chunk],
    dependencies: {},
    options: { dataSources: {}, extractedResources: {} },
  } as never
  const plugin = createNextArrayMapperPaginationPlugin()
  await plugin(structure)
  return generator(chunk.content as types.Node).code
}

describe('pagination plugin — search input URL two-way sync (searchUrlParamKey)', () => {
  it('starts from the default and adopts the address after mount, with paired read-back/write-back effects', async () => {
    const code = await runPlugin('searchKeyword')

    // ⛔ Never seeded from the address: a statically generated page is rendered
    // on the server without the visitor's query, and the first browser render
    // must match it — a seeded query filled the input and skipped the
    // prefetched rows there, and React warned of a hydration mismatch.
    expect(code).not.toContain('window.location.search')
    expect(code).toContain('const [ds_0_searchQuery, setDs_0_searchQuery] = useState("")')
    expect(code).toContain('debouncedQuery: ""')

    // useRouter is injected for the effects.
    expect(code).toContain('const router = useRouter()')

    // Write-back (debounced query → URL), keyed on the DEBOUNCED value, routed
    // through the shared writer, and silent until the address was adopted —
    // its first run would otherwise delete the key the read-back adopts.
    expect(code).toContain('const ds_0_searchUrlAdopted = useRef(false)')
    expect(code).toContain('const __tqQuerySyncRef = useRef(')
    expect(code).toContain('if (!ds_0_searchUrlAdopted.current) return;')
    expect(code).toContain(
      '__tqWriteQueryParam("searchKeyword", ds_0_state.debouncedQuery === "" || ds_0_state.debouncedQuery == null ? undefined : ds_0_state.debouncedQuery)'
    )
    expect(code).toContain('}, [ds_0_state.debouncedQuery, router.isReady])')

    // Read-back (URL → input AND applied query at once, from page 1: the page
    // is not in the address), functional setState bail-out (loop-free), then
    // the handshake flag.
    expect(code).toContain('const __urlValue = router.query.searchKeyword')
    expect(code).toContain('ds_0_adoptUrlSearch(prev => prev === __nextValue ? prev : __nextValue)')
    expect(code).toContain('ds_0_searchUrlAdopted.current = true')
    expect(code).toContain('}, [router.query.searchKeyword, router.isReady])')
    expect(code.replace(/\s+/g, ' ')).toContain(
      'const ds_0_adoptUrlSearch = update => { setDs_0_searchQuery(update); setDs_0_state(state => { const next = update(state.debouncedQuery); return next === state.debouncedQuery ? state : { ...state, page: 1, debouncedQuery: next }; }); };'
    )
  })

  it('starts an appending list on page 1 when the address brings a query', async () => {
    // The scroll sentinel has usually fetched page 2 before the router is
    // ready: kept, the query's first answer was its page 2 — empty when only a
    // few rows match.
    const code = await runPlugin('q', { infiniteScroll: true })
    expect(code.replace(/\s+/g, ' ')).toContain(
      'return next === state.debouncedQuery ? state : { ...state, page: 1, debouncedQuery: next };'
    )
  })

  it('keeps the page of a list whose page is in the address too', async () => {
    const code = await runPlugin('searchKeyword', { pageUrlParamKey: 'page' })
    expect(code.replace(/\s+/g, ' ')).toContain(
      'return next === state.debouncedQuery ? state : { ...state, debouncedQuery: next };'
    )
  })

  it('adopts the address into both queries of a list without pages too', async () => {
    const code = await runPlugin('searchKeyword', { paginated: false })
    expect(code).not.toContain('window.location.search')
    expect(code.replace(/\s+/g, ' ')).toContain(
      'const ds_0_adoptUrlSearch = update => { setDs_0_searchQuery(update); setDs_0_debouncedQuery(update); };'
    )
    expect(code).toContain('ds_0_adoptUrlSearch(prev => prev === __nextValue ? prev : __nextValue)')
    expect(code).toContain('if (!ds_0_searchUrlAdopted.current) return;')
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
