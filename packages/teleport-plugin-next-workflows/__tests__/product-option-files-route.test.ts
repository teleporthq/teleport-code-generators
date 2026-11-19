/* tslint:disable:function-constructor no-any */
import { generatePgClientCode } from '../src/pg-client-code'
import {
  generateProductOptionFilesRoute,
  PRODUCT_OPTION_UPLOAD_FOLDER,
} from '../src/product-option-files-route-generator'

/**
 * The route that deletes the option files an add to cart uploaded but the cart
 * did not take, run as the generated site runs it, over a fake storage worker
 * and a fake database. The ids come from the shopper's browser: only a file
 * storage lists in the product-option folder, and that no order line or saved
 * cart line shows, may go.
 */

const REFUSED_FILE = 'aaaaaaaa-0000-4000-8000-000000000001'
const ORDERED_FILE = 'aaaaaaaa-0000-4000-8000-000000000002'
const PRODUCT_PHOTO = 'bbbbbbbb-0000-4000-8000-000000000003'
const STORAGE = 'https://storage.example'

interface Call {
  method: string
  url: string
}

function loadRoute(options: { configured?: boolean; tables?: string[] } = {}) {
  const calls: Call[] = []
  const queries: Array<{ sql: string; values: unknown[] }> = []
  const fetch = async (url: string, init: { method: string; headers: Record<string, string> }) => {
    calls.push({ method: init.method, url })
    expect(init.headers.Authorization).toBe('Bearer storage-key')
    if (init.method === 'GET') {
      const query = new URL(url).searchParams
      const named = (query.get('ids') || '').split(',')
      const inFolder = query.get('folder') === PRODUCT_OPTION_UPLOAD_FOLDER
      const files = inFolder ? named.filter((id) => id !== PRODUCT_PHOTO).map((id) => ({ id })) : []
      return { ok: true, status: 200, json: async () => ({ files }) }
    }
    return { ok: true, status: 200, json: async () => ({ success: true }) }
  }
  const tables = options.tables ?? ['teleport_order_items', 'teleport_cart_items']
  class Client {
    async connect(): Promise<void> {
      return undefined
    }
    async query(sql: string, values: unknown[]) {
      queries.push({ sql, values })
      if (sql.includes('information_schema')) {
        return { rows: tables.map((table_name) => ({ table_name })) }
      }
      const ids = values[0] as string[]
      return { rows: ids.filter((id) => id === ORDERED_FILE).map((id) => ({ id })) }
    }
    async end(): Promise<void> {
      return undefined
    }
  }
  const security = { rateLimitRequest: async () => true }
  const source = generateProductOptionFilesRoute()
  const body = source
    .replace(generatePgClientCode(), 'var getClient = function () { return new Client(); };')
    .replace('export default async function handler', 'module.exports = async function handler')
  const module = { exports: {} as any }
  const env =
    options.configured === false
      ? {}
      : {
          RUNTIME_STORAGE_URL: STORAGE,
          RUNTIME_STORAGE_API_KEY: 'storage-key',
          RUNTIME_STORAGE_PROJECT_ID: 'project-1',
        }
  new Function('require', 'module', 'exports', 'process', 'fetch', 'Client', body)(
    () => security,
    module,
    module.exports,
    { env },
    fetch,
    Client
  )
  return { handler: module.exports as (req: any, res: any) => Promise<void>, calls, queries }
}

async function post(
  handler: (req: any, res: any) => Promise<void>,
  params: { files: unknown; site?: string; method?: string }
) {
  const answer = { status: 0, json: null as any }
  const res = {
    setHeader: (): void => undefined,
    status(code: number) {
      answer.status = code
      return this
    },
    json(value: unknown) {
      answer.json = value
      return this
    },
  }
  await handler(
    {
      method: params.method ?? 'POST',
      headers: { 'sec-fetch-site': params.site ?? 'same-origin', host: 'site.example' },
      body: { files: params.files },
    },
    res
  )
  return answer
}

const deletedIds = (calls: Call[]) =>
  calls.filter((call) => call.method === 'DELETE').map((call) => call.url.split('/').pop())

describe('the option files route', () => {
  it('deletes only option files of the folder that no order or cart line shows', async () => {
    const { handler, calls, queries } = loadRoute()
    const answer = await post(handler, {
      files: [REFUSED_FILE, ORDERED_FILE, PRODUCT_PHOTO, 'not-an-id', REFUSED_FILE],
    })
    expect(answer).toEqual({ status: 200, json: { success: true, deleted: 1 } })
    expect(deletedIds(calls)).toEqual([REFUSED_FILE])
    const listing = calls.find((call) => call.method === 'GET')!
    expect(listing.url).toContain(`${STORAGE}/project/project-1/files?folder=product-options`)
    expect(listing.url).not.toContain('not-an-id')
    const shown = queries[queries.length - 1]
    expect(shown.sql).toContain('teleport_order_items')
    expect(shown.sql).toContain('teleport_cart_items')
    expect(shown.values).toEqual([[REFUSED_FILE, ORDERED_FILE]])
  })

  it('reads only the line tables the store has', async () => {
    const { handler, calls, queries } = loadRoute({ tables: ['teleport_order_items'] })
    await post(handler, { files: [REFUSED_FILE] })
    expect(queries[queries.length - 1].sql).not.toContain('teleport_cart_items')
    expect(deletedIds(calls)).toEqual([REFUSED_FILE])
  })

  it('never touches storage for a call from another site, or another method', async () => {
    const foreign = loadRoute()
    expect(
      (await post(foreign.handler, { files: [REFUSED_FILE], site: 'cross-site' })).status
    ).toBe(403)
    expect(foreign.calls).toEqual([])
    const read = loadRoute()
    expect((await post(read.handler, { files: [REFUSED_FILE], method: 'GET' })).status).toBe(405)
    expect(read.calls).toEqual([])
  })

  it('answers without touching anything for no usable id or no storage', async () => {
    const none = loadRoute()
    expect((await post(none.handler, { files: 'oops' })).json).toEqual({
      success: true,
      deleted: 0,
    })
    expect(none.calls).toEqual([])
    const unconfigured = loadRoute({ configured: false })
    expect((await post(unconfigured.handler, { files: [REFUSED_FILE] })).json).toEqual({
      success: true,
      deleted: 0,
    })
    expect(unconfigured.calls).toEqual([])
  })
})
