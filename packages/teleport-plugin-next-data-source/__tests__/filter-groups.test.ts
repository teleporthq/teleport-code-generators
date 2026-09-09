import * as vm from 'vm'
import { generateCSVFileFetcher } from '../src/fetchers/csv-file'
import { generateDataSourceFetcher } from '../src/data-source-fetchers'
import {
  collectFilterLeafConditions,
  pruneFilterTree,
  generateFilterTreeHelpersCode,
} from '../src/utils'

const CSV = [
  'Index,Title,Category',
  '1,Alpha,Commercial',
  '2,Beta,Narrative',
  '3,Gamma,Commercial',
  '4,Delta,Music Video',
].join('\n')

const condition = (source: string, destination: string, operand = '=') => ({
  type: 'condition',
  source,
  destination,
  operand,
})

const group = (operator: 'and' | 'or', children: unknown[]) => ({
  type: 'group',
  operator,
  children,
})

// Loads the generated CSV API route and calls it the way Next.js would.
const runCsvHandler = async (filters?: unknown): Promise<Array<Record<string, string>>> => {
  const code = generateCSVFileFetcher({
    fileContent: CSV,
    autoDetectHeader: true,
    firstRowIsHeader: true,
  })
  const moduleExports: { default?: (req: unknown, res: unknown) => Promise<void> } = {}
  const context = vm.createContext({ exports: moduleExports, console })
  vm.runInContext(
    code.replace(
      'export default async function handler',
      'exports.default = async function handler'
    ),
    context
  )

  let payload: { data: Array<Record<string, string>> } | null = null
  const res = {
    status: () => res,
    json: (data: never) => {
      payload = data
      return res
    },
  }
  await moduleExports.default!(
    { query: filters === undefined ? {} : { filters: JSON.stringify(filters) }, method: 'GET' },
    res
  )
  return payload!.data
}

const titles = (rows: Array<Record<string, string>>) => rows.map((row) => row.col_1).sort()

describe('filter groups reach the data source', () => {
  it('applies a condition wrapped in the inspector and-group', async () => {
    // The regression: a group has no `.source`, so the old flat-only runtime
    // skipped it and returned every row unfiltered.
    expect(
      titles(await runCsvHandler([group('and', [condition('Category', 'Commercial')])]))
    ).toEqual(['Alpha', 'Gamma'])
  })

  it('leaves rows unfiltered only when there is genuinely no filter', async () => {
    expect(await runCsvHandler()).toHaveLength(4)
    expect(await runCsvHandler([])).toHaveLength(4)
  })

  it('honours an or-group instead of flattening it into ands', async () => {
    const rows = await runCsvHandler([
      group('or', [condition('Category', 'Commercial'), condition('Category', 'Narrative')]),
    ])
    expect(titles(rows)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('honours an or-group nested inside the root and-group', async () => {
    const rows = await runCsvHandler([
      group('and', [
        condition('Title', 'Alpha', '!='),
        group('or', [condition('Category', 'Commercial'), condition('Category', 'Narrative')]),
      ]),
    ])
    expect(titles(rows)).toEqual(['Beta', 'Gamma'])
  })

  it('still accepts the legacy flat and object filter shapes', async () => {
    expect(titles(await runCsvHandler([condition('Category', 'Commercial')]))).toEqual([
      'Alpha',
      'Gamma',
    ])
    expect(titles(await runCsvHandler({ Category: 'Commercial' } as never))).toEqual([
      'Alpha',
      'Gamma',
    ])
  })
})

describe('every data source emits the filter-tree runtime', () => {
  const dataSources: Array<[string, Record<string, unknown>]> = [
    ['postgresql', { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p' }],
    ['mysql', { host: 'h', port: 3306, database: 'd', user: 'u', password: 'p' }],
    ['mariadb', { host: 'h', port: 3306, database: 'd', user: 'u', password: 'p' }],
    ['amazon-redshift', { host: 'h', port: 5439, database: 'd', user: 'u', password: 'p' }],
    ['clickhouse', { url: 'http://h', username: 'u', password: 'p', database: 'd' }],
    ['turso', { databaseUrl: 'libsql://x', token: 't' }],
    ['mongodb', { connectionString: 'mongodb://h', database: 'd' }],
    ['firestore', { serviceAccount: 'teleporthq.secrets.FIRESTORE_SERVICE_ACCOUNT' }],
    ['supabase', { supabaseUrl: 'https://x.supabase.co', serviceRoleKey: 'k' }],
    ['airtable', { personalAccessToken: 'k', baseId: 'b' }],
    ['redis', { host: 'h', port: 6379 }],
    ['rest-api', { url: 'https://example.com/items' }],
    ['javascript', { code: 'return []' }],
  ]

  it.each(dataSources)('%s understands filter groups', (type, config) => {
    const code = generateDataSourceFetcher({ type, config } as never, 'items')
    expect(code).toContain('normalizeFilterTree')
  })

  it('normalizes groups, legacy conditions and object maps into one tree', () => {
    const context: { normalizeFilterTree?: (parsed: unknown) => unknown } = {}
    vm.runInContext(
      generateFilterTreeHelpersCode().replace(/^const /gm, 'this.'),
      vm.createContext(context)
    )
    const normalize = context.normalizeFilterTree!

    expect(normalize([group('and', [condition('Category', 'Commercial')])])).toEqual(
      group('and', [condition('Category', 'Commercial')])
    )
    expect(normalize([{ source: 'Category', destination: 'Commercial' }])).toEqual(
      group('and', [condition('Category', 'Commercial')])
    )
    expect(normalize({ Category: 'Commercial' })).toEqual(
      group('and', [condition('Category', 'Commercial')])
    )
    expect(normalize([])).toBeNull()
    expect(normalize([group('and', [])])).toBeNull()
  })
})

describe('generator-side tree walkers', () => {
  const tree = [
    group('and', [
      condition('Category', 'Commercial'),
      group('or', [condition('Year', '2024'), condition('Year', '2025')]),
    ]),
  ]

  it('finds conditions nested inside groups', () => {
    // The initialData gate and the dynamic-destination checks read destinations
    // through this; asking a group for `.destination` silently answers "static".
    expect(collectFilterLeafConditions(tree)).toHaveLength(3)
  })

  it('prunes rejected conditions without collapsing the group structure', () => {
    const pruned = pruneFilterTree(tree, (c) => (c as { source: string }).source !== 'Year')
    expect(pruned).toEqual([group('and', [condition('Category', 'Commercial')])])
  })

  it('drops a group left empty by pruning', () => {
    expect(pruneFilterTree(tree, () => false)).toEqual([])
  })
})
