import * as types from '@babel/types'
import generator from '@babel/generator'
import {
  ChunkType,
  FileType,
  ComponentStructure,
  ChunkDefinition,
} from '@teleporthq/teleport-types'
import { createNextArrayMapperPaginationPlugin } from '../src/pagination-plugin'

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
  return {
    name: 'jsx-component',
    type: ChunkType.AST,
    fileType: FileType.JS,
    linkAfter: [],
    content: types.variableDeclaration('const', [
      types.variableDeclarator(types.identifier('TestComponent'), arrow),
    ]),
    meta: {},
  }
}

interface ListOptions {
  pageUrlParamKey?: string
  searchEnabled?: boolean
  stateFilter?: string
  infiniteScroll?: boolean
}

// tslint:disable-next-line:no-any
const makeUidlNode = (options: ListOptions): any => ({
  type: 'data-source-list',
  content: {
    renderPropIdentifier: 'items',
    resourceDefinition: {
      dataSourceId: 'ds1',
      tableName: 'products',
      dataSourceType: 'postgresql',
    },
    resource: {
      params: {
        queryColumns: { content: ['name'] },
        ...(options.stateFilter
          ? {
              filters: {
                content: [
                  {
                    source: 'category_filter_ids',
                    operand: 'array_overlap',
                    destination: {
                      type: 'dynamic',
                      content: { referenceType: 'state', id: options.stateFilter },
                    },
                  },
                ],
              },
            }
          : {}),
      },
    },
    nodes: {
      success: {
        type: 'cms-list-repeater',
        content: {
          renderPropIdentifier: 'product',
          paginated: true,
          perPage: 20,
          searchEnabled: options.searchEnabled !== false,
          searchDebounce: 300,
          ...(options.pageUrlParamKey ? { pageUrlParamKey: options.pageUrlParamKey } : {}),
          ...(options.infiniteScroll ? { infiniteScroll: true } : {}),
          nodes: { list: { type: 'element', content: { elementType: 'div' } } },
        },
      },
    },
  },
})

const runPlugin = async (options: ListOptions): Promise<string> => {
  const chunk = makeComponentChunk()
  const structure: ComponentStructure = {
    uidl: { name: 'TestComponent', node: makeUidlNode(options) },
    chunks: [chunk],
    dependencies: {},
    options: { dataSources: {}, extractedResources: {} },
  } as never
  await createNextArrayMapperPaginationPlugin()(structure)
  return generator(chunk.content as types.Node).code
}

const collapse = (code: string): string => code.replace(/\s+/g, ' ')

describe('pagination plugin — current page ⇄ URL (pageUrlParamKey)', () => {
  it('adopts the URL page in an effect rather than seeding the state', async () => {
    const code = await runPlugin({ pageUrlParamKey: 'page' })
    const flat = collapse(code)

    // ⛔ NOT seeded in the useState initializer, unlike the search query.
    // A statically generated page renders page 1 on the server, and React does
    // not repair mismatched ATTRIBUTES when it hydrates — a client that started
    // on page 3 would keep the server's disabled "Previous" for good. Moving
    // the page in an effect makes it a real state transition React will paint.
    expect(code).not.toContain('window.location.search')
    expect(flat).toContain('const [ds_0_state, setDs_0_state] = useState({ page: 1,')

    expect(code).toContain('const router = useRouter()')
    expect(code).toContain('const ds_0_pageUrlRef = useRef(null)')
    expect(code).toContain('const __urlPage = Math.max(1, parseInt(__raw, 10) || 1)')
    expect(code).toContain('const __statePage = ds_0_state.page')
    expect(code).toContain('const __seenUrlPage = ds_0_pageUrlRef.current')
  })

  it('decides which side moved, so the two directions cannot race', async () => {
    const code = await runPlugin({ pageUrlParamKey: 'page' })
    const flat = collapse(code)

    // The URL moved (deep link, <Link>, back/forward) ⇒ adopt it — but ONLY
    // once every replace this component issued has landed. Mid-flight,
    // `router.query` still holds the page the visitor is on their way out of.
    expect(flat).toContain(
      'if (__tqQuerySyncRef.current.inFlight === 0 && __seenUrlPage !== __urlPage && __urlPage !== __statePage)'
    )
    expect(flat).toContain(
      'setDs_0_state(state => state.page === __urlPage ? state : { ...state, page: __urlPage })'
    )
    // The page moved (a click, or the filter reset) ⇒ write it. Page 1 is the
    // ABSENCE of the key, so an unpaginated visit keeps a clean URL.
    expect(flat).toContain('if (__urlPage === __statePage) return')
    expect(flat).toContain(
      '__tqWriteQueryParam("page", __statePage <= 1 ? undefined : __statePage)'
    )
    expect(code).toContain('}, [router.query.page, router.isReady, ds_0_state.page])')
  })

  it('applies to the standalone page state for a paginated-only list', async () => {
    const code = await runPlugin({ pageUrlParamKey: 'page', searchEnabled: false })
    const flat = collapse(code)

    expect(code).toContain('const __statePage = ds_0_page')
    expect(flat).toContain('setDs_0_page(page => page === __urlPage ? page : __urlPage)')
  })

  it('runs the URL sync AFTER the filter reset so a deep link wins', async () => {
    const code = await runPlugin({ pageUrlParamKey: 'page', stateFilter: 'selectedCategory' })

    // Both effects can fire in one flush on a navigation that changes filter and
    // page together. Effects run in emission order, so the URL sync must be last
    // or `?page=3&categoryFilter=X` would land on page 1.
    const resetAt = code.indexOf('ds_0_filterResetRef.current = __sig')
    const syncAt = code.indexOf('const __seenUrlPage = ds_0_pageUrlRef.current')
    expect(resetAt).toBeGreaterThan(-1)
    expect(syncAt).toBeGreaterThan(resetAt)
  })

  it('writes through the shared writer, so two controls cannot erase each other', async () => {
    const code = await runPlugin({ pageUrlParamKey: 'page', stateFilter: 'selectedCategory' })
    const flat = collapse(code)

    // ⛔ THE DEFECT THIS GUARDS, seen live: picking a category while on page 3
    // resets the page, so the category write-back and the page write-back fire
    // in the SAME flush. Each used to build its next query from `router.query`,
    // which Next updates asynchronously and does NOT refresh on a component's
    // own setState — so the second `replace` wrote a query that predated the
    // first, and `?categoryFilter=…` vanished even though the list was filtered.
    // The read-back then cleared the category state, the write-back re-asserted
    // it, and the pair swapped values forever: an endless refetch loop.
    //
    // The fix is that neither effect composes a query any more. Both hand one
    // key to `__tqWriteQueryParam`, which merges into the last query the
    // component ASKED for, so the second write builds on the first's payload.
    expect(code).not.toContain('__nextQuery')
    expect(flat).toContain('const base = __tqQuerySyncRef.current.pending || router.query')
    expect(flat).toContain('__tqQuerySyncRef.current.pending = next')

    // Exactly ONE writer is declared however many controls are bound to the URL.
    expect((code.match(/const __tqWriteQueryParam = /g) || []).length).toBe(1)
    // ...and exactly one `router.replace`, inside it.
    expect((code.match(/router\.replace\(/g) || []).length).toBe(1)
  })

  it('emits nothing page-URL related without the key (unchanged behaviour)', async () => {
    const code = await runPlugin({})

    expect(code).toContain('page: 1')
    expect(code).not.toContain('pageUrlRef')
    expect(code).not.toContain('router.query.page')
    expect(code).not.toContain('useRouter')
  })

  it('ignores the key on an infinite-scroll list, which has no pages to name', async () => {
    const code = await runPlugin({ pageUrlParamKey: 'page', infiniteScroll: true })

    expect(code).not.toContain('router.query.page')
    expect(code).not.toContain('pageUrlRef')
  })
})
