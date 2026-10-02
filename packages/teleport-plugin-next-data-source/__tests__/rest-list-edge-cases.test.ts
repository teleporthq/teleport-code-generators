import * as types from '@babel/types'
import generator from '@babel/generator'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { createNextArrayMapperPaginationPlugin } from '../src/pagination-plugin'
import { extractItemsPath } from '../src/items-path'
import { generateRESTAPIFetcher } from '../src/fetchers/rest-api'
import { buildAccumulatingResponseHandler, getInfiniteScrollVars } from '../src/infinite-scroll'
import { DEFAULT_REPEATER_PER_PAGE, resolveRepeaterPerPage } from '../src/repeater-page-size'
import {
  makeUidlNode,
  makeWidgetComponentChunk,
  type RepeaterOptions,
} from './_helpers/pagination-widget-fixture'

/**
 * A list bound to a REST API payload, in the shapes the editor lets a builder
 * bind: a list wrapped in an object, a list inside an item of a list, an
 * appending list, a list whose page size was never set.
 */

const runHandler = async (
  code: string,
  query: Record<string, unknown>,
  body: unknown
): Promise<{ data?: unknown; url?: string }> => {
  let requestedURL: string | undefined
  const fetchImpl = (url: string) => {
    requestedURL = url
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(JSON.parse(JSON.stringify(body))),
    })
  }
  const handler = new Function(
    'fetch',
    `${code
      .replace(/^import\s+.*?$/gm, '')
      .replace('export default async function handler', 'async function handler')}
    return handler`
  )(fetchImpl)

  let payload: { data?: unknown } = {}
  const res = {
    status: () => res,
    json: (data: { data?: unknown }) => {
      payload = data
      return res
    },
  }
  await handler({ query, body: undefined }, res)
  return { data: payload.data, url: requestedURL }
}

const rows = Array.from({ length: 25 }, (_, index) => ({ id: index + 1 }))
const restFetcher = (config: Record<string, unknown> = {}) =>
  generateRESTAPIFetcher({ url: 'https://api.test/items', method: 'GET', ...config })

describe('a list inside an item of a list (`source?.[0]?.items`)', () => {
  it('reads the index as a path segment', () => {
    expect(extractItemsPath('ds?.[0]?.items || []', 'ds', 'rest-api')).toEqual(['0', 'items'])
    expect(extractItemsPath('ds?.data?.[2]?.["my list"]', 'ds', 'rest-api')).toEqual([
      'data',
      '2',
      'my list',
    ])
  })

  it('pages that inner list and keeps the list around it', async () => {
    const { data } = await runHandler(
      restFetcher(),
      { page: '2', perPage: '10', itemsPath: JSON.stringify(['0', 'items']) },
      [{ items: rows }, { items: [] }]
    )

    const payload = data as Array<{ items: Array<{ id: number }> }>
    expect(payload).toHaveLength(2)
    expect(payload[0].items.map((row) => row.id)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
    expect(payload[1].items).toEqual([])
  })

  it('leaves the payload alone when the index is past the end of the list', async () => {
    const { data } = await runHandler(
      restFetcher(),
      { limit: '10', itemsPath: JSON.stringify(['3', 'items']) },
      [{ items: rows }]
    )

    expect((data as Array<{ items: unknown[] }>)[0].items).toHaveLength(25)
  })
})

describe('an appending (infinite scroll) list over a wrapped payload', () => {
  const runAccumulator = (itemsPath: string[] | undefined) => {
    const vars = getInfiniteScrollVars(0)
    const source = generator(buildAccumulatingResponseHandler(vars, 2, itemsPath)).code
    const accumRef = { current: { sig: '', pages: {} } }
    const hasMore: boolean[] = []
    return (params: Record<string, unknown>, data: unknown) =>
      new Function(vars.accumRefVar, vars.setHasMoreFlagVar, 'params', `return (${source})`)(
        accumRef,
        (value: boolean) => hasMore.push(value),
        params
      )({ data }) as unknown
  }

  it('reads the rows at the path and puts every page back there', () => {
    const accumulate = runAccumulator(['data', 'items'])

    accumulate({ page: 1 }, { data: { items: [{ id: 1 }, { id: 2 }] }, total: 3 })
    const second = accumulate({ page: 2 }, { data: { items: [{ id: 3 }] }, total: 3 }) as {
      data: { items: Array<{ id: number }> }
      total: number
    }

    expect(second.data.items.map((row) => row.id)).toEqual([1, 2, 3])
    expect(second.total).toBe(3)
  })

  it('still accumulates a payload that IS the list', () => {
    const accumulate = runAccumulator(undefined)

    accumulate({ page: 1 }, [{ id: 1 }, { id: 2 }])
    expect(accumulate({ page: 2 }, [{ id: 3 }])).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
  })

  it('is wired for a list bound inside a REST payload', async () => {
    const code = await runPaginationPlugin({ infiniteScroll: true }, 'items?.templates || []')

    expect(code).toContain('const rows = response?.data?.templates || []')
    expect(code).toContain('...response?.data,')
    expect(code).toContain('templates: Object.keys(ds_0_accumRef.current.pages)')
  })
})

describe('a paginated list with no page size', () => {
  it('pages by the editor default instead of failing the project', async () => {
    const code = await runPaginationPlugin({}, 'items?.templates || []', (node) => {
      delete node.content.nodes.success.content.perPage
    })

    expect(code).toContain(`perPage: ${DEFAULT_REPEATER_PER_PAGE}`)
  })

  it.each([
    [undefined, DEFAULT_REPEATER_PER_PAGE],
    [null, DEFAULT_REPEATER_PER_PAGE],
    ['', DEFAULT_REPEATER_PER_PAGE],
    [0, DEFAULT_REPEATER_PER_PAGE],
    [-5, DEFAULT_REPEATER_PER_PAGE],
    [NaN, DEFAULT_REPEATER_PER_PAGE],
    ['abc', DEFAULT_REPEATER_PER_PAGE],
    [12, 12],
    ['24', 24],
    [7.9, 7],
  ])('reads %p as %p', (perPage, expected) => {
    expect(resolveRepeaterPerPage(perPage)).toBe(expected)
  })
})

describe('the query params configured on a REST API data source', () => {
  it('are sent with every request, as the editor sends them', async () => {
    const { url } = await runHandler(
      restFetcher({ queryParams: { per_page: '10', category: 'a b' } }),
      {},
      rows
    )

    expect(url).toBe('https://api.test/items?per_page=10&category=a+b')
  })

  it('join the params already in the URL', async () => {
    const { url } = await runHandler(
      generateRESTAPIFetcher({
        url: 'https://api.test/items?sort=new',
        method: 'GET',
        queryParams: { page: '2' },
      }),
      {},
      rows
    )

    expect(url).toBe('https://api.test/items?sort=new&page=2')
  })

  it('leave the URL exactly as configured when there are none', () => {
    expect(restFetcher({ queryParams: {} })).toBe(restFetcher())
    expect(restFetcher()).toContain('const url = "https://api.test/items"')
  })
})

async function runPaginationPlugin(
  repeater: RepeaterOptions,
  source: string,
  adjust: (node: ReturnType<typeof makeUidlNode>) => void = () => undefined
): Promise<string> {
  const node = makeUidlNode(repeater)
  node.content.resourceDefinition.dataSourceType = 'rest-api'
  node.content.nodes.success.content.source = source
  adjust(node)
  const chunk = makeWidgetComponentChunk({ controls: ['previous', 'next'] })
  const structure: ComponentStructure = {
    uidl: { name: 'TestComponent', node },
    chunks: [chunk],
    dependencies: {},
    options: { dataSources: {}, extractedResources: {} },
  } as never
  await createNextArrayMapperPaginationPlugin()(structure)
  return generator(chunk.content as types.Node).code
}
