import * as types from '@babel/types'
import generator from '@babel/generator'
import {
  ChunkType,
  FileType,
  ComponentStructure,
  ChunkDefinition,
  UIDLDataCacheConfig,
  UIDLDependency,
} from '@teleporthq/teleport-types'
import { createNextArrayMapperPaginationPlugin } from '../src/pagination-plugin'

type Category = 'paginated+search' | 'paginated-only' | 'search-only' | 'plain'

const CACHE: UIDLDataCacheConfig = {
  enabled: true,
  ttlSeconds: 60,
  client: true,
  server: true,
  versionScope: 'ds1:products',
}

const makeDataProviderJSX = (): types.JSXElement => {
  const repeater = types.jsxElement(
    types.jsxOpeningElement(
      types.jsxIdentifier('Repeater'),
      [
        types.jsxAttribute(
          types.jsxIdentifier('renderItem'),
          types.jsxExpressionContainer(
            types.arrowFunctionExpression(
              [types.identifier('product')],
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

  return types.jsxElement(
    types.jsxOpeningElement(
      types.jsxIdentifier('DataProvider'),
      [
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
        ),
      ],
      true
    ),
    null,
    [],
    true
  )
}

const makeComponentChunk = (dataProvider: types.JSXElement): ChunkDefinition => ({
  name: 'jsx-component',
  type: ChunkType.AST,
  fileType: FileType.JS,
  linkAfter: [],
  content: types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('ProductsList'),
      types.arrowFunctionExpression(
        [types.identifier('props')],
        types.blockStatement([types.returnStatement(dataProvider)])
      )
    ),
  ]),
  meta: {},
})

// tslint:disable-next-line:no-any
const makeUidlNode = (
  category: Category,
  cache?: UIDLDataCacheConfig,
  dynamicSort = false
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
          ...(cache ? { cache } : {}),
          ...(dynamicSort
            ? {
                sort: { type: 'expr', content: 'sortBy.split("-")[0]' },
                sortDirection: { type: 'expr', content: 'sortBy.split("-")[1]' },
              }
            : {}),
        },
      },
    },
  },
})

const runPlugin = async (options: {
  category?: Category
  cache?: UIDLDataCacheConfig
  dynamicSort?: boolean
}) => {
  const chunk = makeComponentChunk(makeDataProviderJSX())
  const dependencies: Record<string, UIDLDependency> = {}
  // tslint:disable-next-line:no-any
  const extractedResources: Record<string, any> = {}
  const structure: ComponentStructure = {
    uidl: {
      name: 'ProductsList',
      node: makeUidlNode(
        options.category || 'paginated+search',
        options.cache,
        options.dynamicSort
      ),
    },
    chunks: [chunk],
    dependencies,
    options: {
      dataSources: {
        ds1: {
          id: 'ds1',
          name: 'Store',
          type: 'postgresql',
          config: { host: 'h', database: 'd', user: 'u', password: 'p' },
        },
      },
      extractedResources,
    },
  } as never

  await createNextArrayMapperPaginationPlugin()(structure)
  return { code: generator(chunk.content as types.Node).code, dependencies, extractedResources }
}

const CATEGORIES: Category[] = ['paginated+search', 'paginated-only', 'search-only', 'plain']

describe('array-mapper cache — client wiring', () => {
  /**
   * The regression pin that matters most: a project that never asked for
   * caching has to generate exactly what it generated before.
   */
  describe.each(CATEGORIES)('with caching OFF (%s)', (category) => {
    it('emits no cache code at all', async () => {
      const { code, dependencies } = await runPlugin({ category })

      expect(code).not.toContain('tqCache')
      expect(code).not.toContain('ds_0_cached')
      expect(code).not.toContain('ds_0_params')
      expect(Object.keys(dependencies)).not.toContain('tqCacheGet')
    })
  })

  describe.each(CATEGORIES)('with caching ON (%s)', (category) => {
    it('checks the cache before touching the network', async () => {
      const { code } = await runPlugin({ category, cache: CACHE })

      expect(code).toContain('const __tqKey = tqCacheKey(params)')
      expect(code).toContain('const __tqHit = tqCacheGet("ds1:products", __tqKey)')
      expect(code).toContain('return Promise.resolve(__tqHit)')
    })

    it('stores the rows and the version the server answered with', async () => {
      const { code } = await runPlugin({ category, cache: CACHE })

      expect(code).toContain('tqCacheSetVersion("ds1:products", response?.version)')
      expect(code).toContain(
        'return tqCacheSet("ds1:products", __tqKey, response?.data, 60, response?.version)'
      )
    })

    it('registers the runtime import once', async () => {
      const { dependencies } = await runPlugin({ category, cache: CACHE })

      expect(dependencies.tqCacheGet).toMatchObject({
        type: 'local',
        path: '../utils/tq-cache/client',
        meta: { namedImport: true },
      })
    })

    it('flips the hydration latch and revalidates once per page', async () => {
      const { code } = await runPlugin({ category, cache: CACHE })

      expect(code).toContain('tqMarkHydrated()')
      expect(code).toContain('tqCacheRevalidate(["ds1:products"])')
      expect(code.match(/tqCacheRevalidate/g)).toHaveLength(1)
    })
  })

  /**
   * The flash this feature exists to remove. A cache HIT must return before the
   * in-flight flag is raised, or `persistDataDuringLoading={!ds_0_isFetching}`
   * drops the provider into its loading slot for a frame.
   */
  it('never raises the in-flight flag on a cache hit', async () => {
    const { code } = await runPlugin({ cache: CACHE })

    const hitReturn = code.indexOf('return Promise.resolve(__tqHit)')
    const raise = code.indexOf('setDs_0_isFetching(true)')

    expect(hitReturn).toBeGreaterThan(-1)
    expect(raise).toBeGreaterThan(-1)
    expect(hitReturn).toBeLessThan(raise)
  })

  it('still tracks in-flight fetches on a cache MISS', async () => {
    const { code } = await runPlugin({ cache: CACHE })

    expect(code).toContain('ds_0_fetchesInFlight.current += 1')
    expect(code).toContain('setDs_0_isFetching(true)')
    expect(code).toContain('persistDataDuringLoading={!ds_0_isFetching}')
    // The settle handler belongs to the network chain, not to the early return.
    expect(code).toContain('.finally(')
  })

  it('feeds a cache hit into initialData so a remount paints instantly', async () => {
    const { code } = await runPlugin({ category: 'paginated+search', cache: CACHE })

    expect(code).toContain('const ds_0_params = useMemo(')
    expect(code).toContain('params={ds_0_params}')
    expect(code).toContain('const ds_0_cached = useMemo(')
    expect(code).toContain(
      'tqCacheGet("ds1:products", tqCacheKey(ds_0_params), {\n    sticky: true\n  })'
    )
    expect(code).toContain(': ds_0_cached')
  })

  /**
   * A state-bound sort already suppresses `initialData`, because the prefetch
   * ran without sort params. The peek is `initialData` by another name, so
   * leaving it in would let a stale first page mask the chosen sort.
   */
  it('suppresses the peek when a state-bound sort is active', async () => {
    const { code } = await runPlugin({ cache: CACHE, dynamicSort: true })

    expect(code).not.toContain('ds_0_cached')
    // The fetch-level cache still applies — only the mount-time peek is dropped.
    expect(code).toContain('const __tqHit = tqCacheGet("ds1:products", __tqKey)')
  })

  it('does not cache in the browser when only the server layer is on', async () => {
    const { code } = await runPlugin({ cache: { ...CACHE, client: false } })

    expect(code).not.toContain('tqCacheGet')
    expect(code).not.toContain('ds_0_cached')
  })
})

describe('array-mapper cache — server wiring', () => {
  it('wraps the generated data-source module when the server layer is on', async () => {
    const { extractedResources } = await runPlugin({ cache: CACHE })
    const moduleKey = Object.keys(extractedResources).find((key) => key.startsWith('utils/'))

    expect(moduleKey).toBeDefined()
    const content = extractedResources[moduleKey as string].content as string
    expect(content).toContain("import { tqWithCache } from '../tq-cache/server'")
    expect(content).toContain('"scope":"ds1:products"')
    expect(content).toContain('"scope":"ds1:products:count"')
    expect(content).toContain('"ttl":60')
  })

  it('leaves the module untouched when only the browser layer is on', async () => {
    const { extractedResources } = await runPlugin({ cache: { ...CACHE, server: false } })
    const moduleKey = Object.keys(extractedResources).find((key) => key.startsWith('utils/'))

    expect(moduleKey).toBeDefined()
    expect(extractedResources[moduleKey as string].content).not.toContain('tq-cache')
  })

  it('leaves the module untouched when caching is off entirely', async () => {
    const { extractedResources } = await runPlugin({})
    const moduleKey = Object.keys(extractedResources).find((key) => key.startsWith('utils/'))

    expect(moduleKey).toBeDefined()
    expect(extractedResources[moduleKey as string].content).not.toContain('tq-cache')
  })
})

/**
 * The generated data-source module is shared project-wide, so two pages caching
 * the same table have to agree. If the merge were per-page, page ORDER would
 * decide the TTL — and a page asking for 300s processed second would silently
 * widen the window the 60s page was configured with.
 */
describe('array-mapper cache — one module, many pages', () => {
  const runTwoPages = async (firstTtl: number, secondTtl: number) => {
    // tslint:disable-next-line:no-any
    const extractedResources: Record<string, any> = {}
    // tslint:disable-next-line:no-any
    const sharedOptions: any = {
      dataSources: {
        ds1: {
          id: 'ds1',
          name: 'Store',
          type: 'postgresql',
          config: { host: 'h', database: 'd', user: 'u', password: 'p' },
        },
      },
      extractedResources,
    }

    for (const ttlSeconds of [firstTtl, secondTtl]) {
      const chunk = makeComponentChunk(makeDataProviderJSX())
      const structure: ComponentStructure = {
        uidl: {
          name: 'ProductsList',
          node: makeUidlNode('paginated+search', { ...CACHE, ttlSeconds }),
        },
        chunks: [chunk],
        dependencies: {},
        options: sharedOptions,
      } as never
      await createNextArrayMapperPaginationPlugin()(structure)
    }

    const moduleKey = Object.keys(extractedResources).find((key) => key.startsWith('utils/'))
    return extractedResources[moduleKey as string].content as string
  }

  it('takes the shortest TTL whichever page is generated first', async () => {
    expect(await runTwoPages(300, 60)).toContain('"ttl":60')
    expect(await runTwoPages(60, 300)).toContain('"ttl":60')
  })
})
