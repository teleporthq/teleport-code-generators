import { generateSharedTransformationCode } from '../src/transformations/shared-utils'
import {
  getTransformExpression,
  getTransformWrapperCode,
  RAW_ROWS_PARAM,
} from '../src/transformations'

// The generated admin's edit forms write every column they load back, so they
// ask a transformed table (products, blog posts, custom pages) for its rows AS
// STORED. Fed the product view model instead, a digital product's form showed
// it as not digital, ticked the gift-card switch of a product that is not one,
// lost its discounts, and every save wrote `discounts`, `category_ids`,
// `download_limit`, … back blank. These evaluate the EMITTED code.

type Runtime = {
  rawRecords: (records: unknown, getClient: unknown) => Promise<Array<Record<string, unknown>>>
  wantsRawRows: (query: unknown) => boolean
}

const ASSET_ID = 'asset-7f3c'
const ASSET_URL = 'https://cdn.example.com/uploads/cover.png'

// `getAssetMap` reads the project's asset table through `getClient()`; the
// fake client answers that one query with a single uploaded asset.
const fakeGetClient = () => ({
  connect: async () => undefined,
  end: async () => undefined,
  query: async () => ({ rows: [{ id: ASSET_ID, remote_src: ASSET_URL, src: ASSET_URL }] }),
})

const load = (tableName: string): Runtime => {
  const bundle = generateSharedTransformationCode() + '\n' + getTransformWrapperCode(tableName)
  return new Function(
    bundle + '\nreturn { rawRecords: rawRecords, wantsRawRows: __tqWantsRawRows };'
  )() as Runtime
}

const storedProduct = () => ({
  id: 'p-1',
  name: 'test',
  status: null,
  is_digital: true,
  is_gift_card: false,
  discounts: '[{"id":"d1","type":"fixed","value":10,"startsAt":null,"endsAt":null}]',
  category_ids: '["cat_1"]',
  download_limit: 3,
  image_url: ASSET_ID,
  gallery_images: `["https://img.example.com/a.png","${ASSET_ID}"]`,
  metadata: '{"note":"asset-7f3c is only text here"}',
})

describe('raw-rows mode of a transformed table', () => {
  it('is chosen by the request parameter, as sent by a server call or over HTTP', () => {
    const { wantsRawRows } = load('teleport_products')
    expect(wantsRawRows({ [RAW_ROWS_PARAM]: true })).toBe(true)
    expect(wantsRawRows({ [RAW_ROWS_PARAM]: 'true' })).toBe(true)
    expect(wantsRawRows({ [RAW_ROWS_PARAM]: 'false' })).toBe(false)
    expect(wantsRawRows({})).toBe(false)
    expect(wantsRawRows(undefined)).toBe(false)
  })

  it('returns every stored column untouched — booleans, NULLs and the columns the view model drops', async () => {
    const [row] = await load('teleport_products').rawRecords([storedProduct()], fakeGetClient)
    expect(row.is_digital).toBe(true)
    expect(row.is_gift_card).toBe(false)
    expect(row.status).toBeNull()
    expect(row.discounts).toBe(storedProduct().discounts)
    expect(row.category_ids).toBe('["cat_1"]')
    expect(row.download_limit).toBe(3)
    expect(Object.keys(row).sort()).toEqual(Object.keys(storedProduct()).sort())
  })

  it('turns an uploaded asset id into its URL, alone or inside a JSON list, and nothing else', async () => {
    const [row] = await load('teleport_products').rawRecords([storedProduct()], fakeGetClient)
    expect(row.image_url).toBe(ASSET_URL)
    expect(JSON.parse(row.gallery_images as string)).toEqual([
      'https://img.example.com/a.png',
      ASSET_URL,
    ])
    // An object column that merely mentions the id is not a reference.
    expect(row.metadata).toBe(storedProduct().metadata)
  })

  it('passes the rows through when the asset lookup fails', async () => {
    const failingClient = () => ({
      connect: async () => {
        throw new Error('down')
      },
      end: async () => undefined,
      query: async () => ({ rows: [] }),
    })
    const [row] = await load('teleport_products').rawRecords([storedProduct()], failingClient)
    expect(row.image_url).toBe(ASSET_ID)
  })

  it('is carried by every transformed table, and the handler picks it per request', async () => {
    for (const table of ['teleport_products', 'teleport_blog_posts', 'teleport_pages']) {
      expect(getTransformWrapperCode(table)).toContain('async function rawRecords(')
      const expression = getTransformExpression(table)!
      expect(expression).toContain('__tqWantsRawRows(req.query)')
      expect(expression).toContain('rawRecords(safeData, getClient)')
      expect(expression).toContain('transformRecords(safeData, getClient, req.query)')
    }
    expect(getTransformExpression('orders')).toBeNull()
    const [page] = await load('teleport_pages').rawRecords(
      [{ id: 'pg', blocks: '[]', no_index: 'true' }],
      fakeGetClient
    )
    expect(page).toEqual({ id: 'pg', blocks: '[]', no_index: 'true' })
  })
})
