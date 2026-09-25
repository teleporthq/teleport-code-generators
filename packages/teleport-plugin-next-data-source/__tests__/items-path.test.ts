import * as types from '@babel/types'
import generator from '@babel/generator'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { createNextArrayMapperPaginationPlugin } from '../src/pagination-plugin'
import { extractItemsPath } from '../src/items-path'
import { generateRESTAPIFetcher } from '../src/fetchers/rest-api'
import { generateJavaScriptFetcher } from '../src/fetchers/javascript'
import { makeUidlNode, makeWidgetComponentChunk } from './_helpers/pagination-widget-fixture'

/**
 * A paginated list bound to an array INSIDE a REST payload
 * (`{ templates: [...], total }` -> `data?.templates || []`) rendered every row
 * on every page: the fetcher only paged a payload that was itself an array, and
 * the count measured the wrapper as 0 rows.
 */

const runHandler = async (
  code: string,
  query: Record<string, unknown>,
  fetchImpl?: () => Promise<unknown>
) => {
  const withoutImports = code.replace(/^import\s+.*?$/gm, '')
  const factory = new Function(
    'fetch',
    `${withoutImports.replace('export default async function handler', 'async function handler')}
    return handler`
  )
  const handler = factory(fetchImpl)

  let payload: Record<string, unknown> = {}
  const res = {
    status: () => res,
    json: (data: Record<string, unknown>) => {
      payload = data
      return res
    },
  }

  await handler({ query, body: undefined }, res)
  return payload
}

const rows = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: `row ${i + 1}` }))
const respondWith = (body: unknown) => () =>
  Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) })

describe('extractItemsPath', () => {
  it('reads the property chain off the data source render prop', () => {
    expect(extractItemsPath('ds?.templates || []', 'ds', 'rest-api')).toEqual(['templates'])
    expect(extractItemsPath('ds?.data?.items', 'ds', 'rest-api')).toEqual(['data', 'items'])
    expect(extractItemsPath('ds?.["my list"] || []', 'ds', 'javascript')).toEqual(['my list'])
  })

  it('is absent when the list is bound to the payload itself', () => {
    expect(extractItemsPath('ds || []', 'ds', 'rest-api')).toBeUndefined()
    expect(extractItemsPath('ds', 'ds', 'rest-api')).toBeUndefined()
  })

  it('leaves anything it cannot read, and non-wrapping source types, alone', () => {
    expect(extractItemsPath('ds?.items.filter(Boolean)', 'ds', 'rest-api')).toBeUndefined()
    expect(extractItemsPath('other?.items', 'ds', 'rest-api')).toBeUndefined()
    expect(extractItemsPath('ds?.items', 'ds', 'postgresql')).toBeUndefined()
  })
})

interface FetcherSetup {
  code: string
  fetchImpl?: () => Promise<unknown>
}

describe.each<[string, FetcherSetup]>([
  [
    'REST API',
    {
      code: generateRESTAPIFetcher({ url: 'https://api.test/items', method: 'GET' }),
      fetchImpl: respondWith({ templates: rows, total: 25 }),
    },
  ],
  [
    'JavaScript',
    { code: generateJavaScriptFetcher({ code: JSON.stringify({ templates: rows, total: 25 }) }) },
  ],
])('%s fetcher — itemsPath', (_label, setup) => {
  it('pages the inner array and keeps the wrapper', async () => {
    const result = await runHandler(
      setup.code,
      {
        page: '2',
        perPage: '10',
        itemsPath: JSON.stringify(['templates']),
      },
      setup.fetchImpl
    )

    const data = result.data as { templates: Array<{ id: number }>; total: number }
    expect(data.total).toBe(25)
    expect(data.templates.map((r) => r.id)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
  })

  it('searches the inner array', async () => {
    const result = await runHandler(
      setup.code,
      {
        query: 'row 2',
        queryColumns: JSON.stringify(['name']),
        itemsPath: JSON.stringify(['templates']),
      },
      setup.fetchImpl
    )

    const data = result.data as { templates: Array<{ id: number }> }
    expect(data.templates.map((r) => r.id)).toEqual([2, 20, 21, 22, 23, 24, 25])
  })

  it('returns the payload untouched without the param', async () => {
    const result = await runHandler(setup.code, { page: '1', perPage: '10' }, setup.fetchImpl)
    expect((result.data as { templates: unknown[] }).templates).toHaveLength(25)
  })
})

describe('pagination plugin — list bound to a wrapped REST payload', () => {
  const runPlugin = async (source: string): Promise<string> => {
    const node = makeUidlNode({})
    node.content.resourceDefinition.dataSourceType = 'rest-api'
    node.content.nodes.success.content.source = source
    const chunk = makeWidgetComponentChunk({ controls: ['previous', 'next'] })
    const structure: ComponentStructure = {
      uidl: { name: 'TestComponent', node },
      chunks: [chunk],
      dependencies: {},
      options: { dataSources: {}, extractedResources: {} },
    } as never
    await createNextArrayMapperPaginationPlugin()(structure)
    return generator(chunk.content as types.Node).code.replace(/\s+/g, ' ')
  }

  it('sends itemsPath with the page fetch and collectionPath with the count', async () => {
    const flat = await runPlugin('items?.templates || []')

    expect(flat).toContain('itemsPath: "[\\"templates\\"]"')
    expect(flat).toContain('collectionPath: "[\\"templates\\"]"')
  })

  it('sends neither when the list is the payload', async () => {
    const flat = await runPlugin('items || []')

    expect(flat).not.toContain('itemsPath')
    expect(flat).not.toContain('collectionPath')
  })
})
