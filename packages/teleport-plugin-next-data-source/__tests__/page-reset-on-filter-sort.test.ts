import * as types from '@babel/types'
import generator from '@babel/generator'
import {
  ChunkType,
  FileType,
  ComponentStructure,
  ChunkDefinition,
} from '@teleporthq/teleport-types'
import { createNextArrayMapperPaginationPlugin } from '../src/pagination-plugin'

// Same minimal `const TestComponent = (props) => { return <div/> }` shell the
// search-url-sync suite uses: the reset effect is derived from the UIDL
// registry, not from the JSX, so an empty body is enough to observe it.
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

interface ListOptions {
  searchEnabled?: boolean
  // A filter destination bound to component state (the category dropdown).
  stateFilter?: string
  // A filter destination read straight from the URL (`?categoryFilter=`).
  urlFilter?: string
  // A dynamic sort expression reading component state (the sort dropdown).
  sortExpression?: string
}

// tslint:disable-next-line:no-any
const makeUidlNode = (options: ListOptions): any => {
  // tslint:disable-next-line:no-any
  const filters: any[] = []
  if (options.stateFilter) {
    filters.push({
      source: 'category_filter_ids',
      operand: 'array_overlap',
      destination: {
        type: 'dynamic',
        content: { referenceType: 'state', id: options.stateFilter },
      },
    })
  }
  if (options.urlFilter) {
    filters.push({
      source: 'category_filter_ids',
      operand: 'array_overlap',
      destination: {
        type: 'dynamic',
        content: { referenceType: 'urlSearchParams', id: options.urlFilter },
      },
    })
  }

  return {
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
          ...(filters.length > 0 ? { filters: { content: filters } } : {}),
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
            ...(options.sortExpression
              ? {
                  sort: { type: 'expr', content: options.sortExpression },
                  sortDirection: { type: 'static', content: 'asc' },
                }
              : {}),
            nodes: { list: { type: 'element', content: { elementType: 'div' } } },
          },
        },
      },
    },
  }
}

// Babel prints object literals across several lines; assertions about a whole
// statement read better against a whitespace-collapsed copy.
const collapse = (code: string): string => code.replace(/\s+/g, ' ')

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

describe('pagination plugin — page resets to 1 when a filter or sort changes', () => {
  it('resets the combined state page for a state-bound filter', async () => {
    const code = await runPlugin({ stateFilter: 'selectedCategory' })

    expect(code).toContain('const ds_0_filterResetRef = useRef(null)')
    expect(code).toContain('const __sig = JSON.stringify([selectedCategory])')
    expect(code).toContain('if (ds_0_filterResetRef.current === __sig) return')
    // First OBSERVED value is recorded, never acted on.
    expect(code).toContain('const __first = ds_0_filterResetRef.current === null')
    expect(code).toContain('if (__first) return')
    // Functional update that bails when already on page 1, so a visitor who
    // never paginated does not get an extra render (and refetch).
    expect(collapse(code)).toContain(
      'setDs_0_state(state => state.page === 1 ? state : { ...state, page: 1 })'
    )
    expect(code).toContain('}, [selectedCategory])')
  })

  it('tracks the sort state alongside the filter', async () => {
    const code = await runPlugin({
      stateFilter: 'selectedCategory',
      sortExpression: 'sortBy.split("-")[0]',
    })

    expect(code).toContain('const __sig = JSON.stringify([selectedCategory, sortBy])')
    expect(code).toContain('}, [selectedCategory, sortBy])')
  })

  it('guards on router.isReady and null-coalesces URL params so deep links survive', async () => {
    const code = await runPlugin({ urlFilter: 'categoryFilter' })

    // ⛔ The reason this effect hashes a signature instead of skipping the first
    // run: router.query is empty until the router hydrates, and treating that
    // hydration as a change would reset a `?page=3&categoryFilter=X` deep link.
    expect(code).toContain('if (!router.isReady) return')
    expect(code).toContain('const __sig = JSON.stringify([router.query.categoryFilter ?? null])')
    expect(code).toContain('}, [router.query.categoryFilter, router.isReady])')
  })

  it('uses the standalone page setter for a paginated-only list', async () => {
    const code = await runPlugin({ searchEnabled: false, stateFilter: 'selectedCategory' })

    expect(code).toContain('setDs_0_page(page => page === 1 ? page : 1)')
    expect(code).not.toContain('setDs_0_state(')
  })

  it('emits nothing for a list that has no filter and no dynamic sort', async () => {
    const code = await runPlugin({})

    // Regression guard: an unfiltered mapper must generate exactly what it did
    // before this feature existed.
    expect(code).not.toContain('filterResetRef')
    expect(code).not.toContain('__sig')
  })
})
