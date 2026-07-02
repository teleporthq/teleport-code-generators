import generator from '@babel/generator'
import * as types from '@babel/types'
import { createStateDataSourcePlugin } from '../src/state-data-source-plugin'

// Regression guard for the dashboard KPI-duplication defect (FurniFlow run
// be21af83): page states bound to the same dataSource+table were grouped into
// ONE getStaticProps fetch built from the FIRST state's definition, so a
// 1-row aggregate state (stockHealthSummary) received the N-row JOIN result
// of a sibling state (locationBalances) — the 4-KPI block repeated N times
// and two dashboard tables rendered the wrong rows. States may only share a
// fetch when their fetch-relevant definition (rawQuery + sorts + static
// filters) is identical.

const DS_ID = '595ce5d7-d36c-4767-95e1-610e9c9831d6'

const makeState = (query?: string) => ({
  type: 'array',
  defaultValue: [] as unknown[],
  dataSourceBinding: {
    dataSourceId: DS_ID,
    refPath: ['products'],
  },
  ...(query ? { query } : {}),
})

const makeStructure = (stateDefinitions: Record<string, unknown>) => {
  const fetcherFileName = 'teleport-products-595ce5d7'
  return {
    uidl: {
      name: 'InventoryDashboard',
      stateDefinitions,
      node: { type: 'element', content: { elementType: 'container' } },
      outputOptions: { folderPath: [] as string[] },
    },
    chunks: [] as any[],
    dependencies: {} as Record<string, unknown>,
    options: {
      dataSources: {
        [DS_ID]: {
          id: DS_ID,
          type: 'teleport',
          config: {},
        },
      },
      // Pre-extracted fetcher so the plugin never regenerates it — this test
      // only cares about how states are grouped into fetches.
      extractedResources: {
        [`utils/${fetcherFileName}`]: {
          fileName: fetcherFileName,
          fileType: 'js',
          path: ['utils', 'data-sources'],
          content: '// stub',
        },
      },
    },
  }
}

const getStaticPropsCode = (structure: { chunks: any[] }): string => {
  const chunk = structure.chunks.find((c) => c.name === 'getStaticProps')
  expect(chunk).toBeDefined()
  return generator(chunk.content as types.Node).code
}

describe('state-data-source-plugin fetch grouping', () => {
  const plugin = createStateDataSourcePlugin()

  it('emits a separate fetch per distinct rawQuery on the same table (KPI duplication fix)', async () => {
    const aggregateQuery =
      'SELECT COALESCE(SUM(on_hand_quantity),0) AS total_on_hand FROM products WHERE active = TRUE'
    const joinQuery =
      'SELECT l.id AS location_id, COUNT(p.id) AS sku_count FROM locations l LEFT JOIN products p ON p.primary_location_id = l.id GROUP BY l.id'

    const structure = makeStructure({
      locationBalances: makeState(joinQuery),
      stockHealthSummary: makeState(aggregateQuery),
    })

    const result = await plugin(structure as any)
    const meta = (result.chunks.find((c: any) => c.name === 'getStaticProps') as any).meta
      .parallelFetchData

    // Two distinct fetches with distinct generated identifiers
    expect(meta.names).toHaveLength(2)
    expect(new Set(meta.names).size).toBe(2)
    for (const name of meta.names) {
      expect(name).toMatch(/^__stateDs_[A-Za-z0-9_]+_raw$/)
    }

    const code = getStaticPropsCode(result as any)
    // Each state's own query is fetched…
    expect(code).toContain(aggregateQuery)
    expect(code).toContain(joinQuery)
    // …and each state prop extracts from its OWN fetch identifier.
    const balancesProp = code.match(/locationBalances: (\w+)/)
    const healthProp = code.match(/stockHealthSummary: (\w+)/)
    expect(balancesProp).not.toBeNull()
    expect(healthProp).not.toBeNull()
    expect(balancesProp![1]).not.toBe(healthProp![1])
  })

  it('still shares one fetch between states with identical fetch semantics', async () => {
    const query = 'SELECT * FROM products ORDER BY sku ASC LIMIT 200'
    const structure = makeStructure({
      productsList: makeState(query),
      productsMirror: makeState(query),
    })

    const result = await plugin(structure as any)
    const meta = (result.chunks.find((c: any) => c.name === 'getStaticProps') as any).meta
      .parallelFetchData

    expect(meta.names).toHaveLength(1)

    const code = getStaticPropsCode(result as any)
    const listProp = code.match(/productsList: (\w+)/)
    const mirrorProp = code.match(/productsMirror: (\w+)/)
    expect(listProp![1]).toBe(mirrorProp![1])
  })

  it('separates a query-less binding from a queried one on the same table', async () => {
    // Products page shape: productsList has a rawQuery, lowStockAlerts is a
    // bare binding (whole table) — they must not share the LIMIT 200 fetch.
    const structure = makeStructure({
      productsList: makeState('SELECT * FROM products ORDER BY sku ASC LIMIT 200'),
      lowStockAlerts: makeState(),
    })

    const result = await plugin(structure as any)
    const meta = (result.chunks.find((c: any) => c.name === 'getStaticProps') as any).meta
      .parallelFetchData

    expect(meta.names).toHaveLength(2)
  })
})
