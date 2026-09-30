/* tslint:disable:function-constructor */
import { generateDataAPIRoute } from '../src/data-api-route-generator'

/**
 * Product options added columns to tables every store already has: the option
 * definitions on `teleport_products` and the chosen configuration on
 * `teleport_order_items`. `data-create-item` names every mapped column in the
 * INSERT, even an `undefined` one, so a checkout writing an order line on a
 * store whose table never gained the column would fail the whole statement —
 * and lose the line. The route drops such a column, and only such a column,
 * when it can read the table's columns. Executed against a fake pg client.
 */

const SECRET = 'server-secret'
const INTERNAL = { 'x-internal-data-secret': SECRET }

interface Query {
  sql: string
  params: unknown[]
}

function bootRoute(columnsByTable: Record<string, string[] | null>) {
  const code = generateDataAPIRoute()
  const queries: Query[] = []
  const warnings: string[] = []
  class FakeClient {
    public async connect(): Promise<void> {
      return
    }
    public async end(): Promise<void> {
      return
    }
    public async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params })
      if (/information_schema/i.test(sql)) {
        const columns = columnsByTable[String(params[1])]
        if (columns === null) {
          throw new Error('permission denied for information_schema')
        }
        return {
          rows: (columns || []).map((name) => ({
            column_name: name,
            data_type: name === 'id' ? 'uuid' : 'text',
          })),
          rowCount: 0,
        }
      }
      return { rows: [{ id: '5b7c1f5e-8f1d-4a57-9d8f-0c6c9a7a2b11' }], rowCount: 1 }
    }
  }
  const moduleObj: { exports: any } = { exports: {} }
  const fakeRequire = (name: string): any => {
    if (name === 'pg') {
      return { Client: FakeClient }
    }
    throw new Error('unexpected require: ' + name)
  }
  new Function('require', 'module', 'exports', 'process', 'console', code)(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    { env: { NEXTAUTH_SECRET: SECRET, TELEPORT_DB_CONNECTION_STRING: 'postgresql://x' } },
    {
      error: () => undefined,
      log: () => undefined,
      warn: (message: string) => warnings.push(message),
    }
  )
  const run = async (operation: string, body: Record<string, unknown>) => {
    queries.length = 0
    warnings.length = 0
    let status = 0
    let payload: any = null
    const res = {
      status(statusCode: number) {
        status = statusCode
        return this
      },
      json(value: any) {
        payload = value
        return this
      },
    }
    await moduleObj.exports(
      { method: 'POST', query: { params: ['ds-1', operation] }, headers: INTERNAL, body },
      res
    )
    const writes = queries.filter((query) => !/information_schema/i.test(query.sql))
    return { status, payload, writes, warnings: warnings.slice() }
  }
  return run
}

const ORDER_ITEM = [
  { column: 'order_id', value: 'ord-1' },
  { column: 'product_name', value: 'Photo print' },
  { column: 'unit_price', value: '27.00' },
  { column: 'configuration', value: '{"v":1,"entries":[]}' },
  { column: 'configuration_label', value: 'Size: A3' },
]

const LEGACY_ORDER_ITEMS = ['id', 'order_id', 'product_name', 'unit_price']
const CURRENT_ORDER_ITEMS = LEGACY_ORDER_ITEMS.concat(['configuration', 'configuration_label'])

describe('data API — columns product options added', () => {
  it('writes an order line without the configuration on a store that lacks the columns', async () => {
    const run = bootRoute({ teleport_order_items: LEGACY_ORDER_ITEMS })
    const out = await run('create', {
      tableName: 'teleport_order_items',
      columnMappings: ORDER_ITEM,
    })
    expect(out.status).toBe(200)
    expect(out.writes).toHaveLength(1)
    expect(out.writes[0].sql).toBe(
      'INSERT INTO teleport_order_items (order_id, product_name, unit_price, id) VALUES ($1, $2, $3, $4) RETURNING *'
    )
    expect(out.warnings).toEqual([
      '[data-api] teleport_order_items has no configuration, configuration_label column; written without it.',
    ])
  })

  it('writes the configuration once the columns exist', async () => {
    const run = bootRoute({ teleport_order_items: CURRENT_ORDER_ITEMS })
    const out = await run('create', {
      tableName: 'teleport_order_items',
      columnMappings: ORDER_ITEM,
    })
    expect(out.writes[0].sql).toContain(
      '(order_id, product_name, unit_price, configuration, configuration_label, id)'
    )
    expect(out.writes[0].params.slice(3, 5)).toEqual(['{"v":1,"entries":[]}', 'Size: A3'])
    expect(out.warnings).toEqual([])
  })

  it('leaves the write exactly as it was when the columns cannot be read', async () => {
    const run = bootRoute({ teleport_order_items: null })
    const out = await run('create', {
      tableName: 'teleport_order_items',
      columnMappings: ORDER_ITEM,
    })
    expect(out.writes[0].sql).toBe(
      'INSERT INTO teleport_order_items (order_id, product_name, unit_price, configuration, configuration_label) VALUES ($1, $2, $3, $4, $5) RETURNING *'
    )
  })

  it('drops only the optional columns: any other missing column still reaches Postgres', async () => {
    const run = bootRoute({ teleport_order_items: LEGACY_ORDER_ITEMS })
    const out = await run('create', {
      tableName: 'teleport_order_items',
      columnMappings: [
        { column: 'order_id', value: 'ord-1' },
        { column: 'gift_note', value: 'Hi' },
      ],
    })
    expect(out.writes[0].sql).toContain('(order_id, gift_note, id)')
  })

  it('updates a product without its option definitions on a store that lacks the column', async () => {
    const run = bootRoute({ teleport_products: ['id', 'name', 'price'] })
    const out = await run('update', {
      tableName: 'teleport_products',
      columnMappings: [
        { column: 'name', value: 'Photo print' },
        { column: 'option_groups', value: '[]' },
      ],
      filters: [{ field: 'id', value: '5b7c1f5e-8f1d-4a57-9d8f-0c6c9a7a2b11' }],
    })
    expect(out.writes[0].sql).toBe(
      'UPDATE teleport_products SET name = $1 WHERE id = $2 RETURNING *'
    )
    expect(out.warnings).toHaveLength(1)
  })

  it('answers an update that only named a missing optional column with nothing updated', async () => {
    const run = bootRoute({ teleport_products: ['id', 'name', 'price'] })
    const out = await run('update', {
      tableName: 'teleport_products',
      columnMappings: [{ column: 'option_groups', value: '[]' }],
      filters: [{ field: 'id', value: '5b7c1f5e-8f1d-4a57-9d8f-0c6c9a7a2b11' }],
    })
    expect(out.status).toBe(200)
    expect(out.payload).toEqual({ updatedCount: 0, item: null, id: null })
    expect(out.writes).toEqual([])
  })

  it('writes the option definitions once the product column exists', async () => {
    const run = bootRoute({ teleport_products: ['id', 'name', 'price', 'option_groups'] })
    const out = await run('update', {
      tableName: 'teleport_products',
      columnMappings: [{ column: 'option_groups', value: '[{"key":"size"}]' }],
      filters: [{ field: 'id', value: '5b7c1f5e-8f1d-4a57-9d8f-0c6c9a7a2b11' }],
    })
    expect(out.writes[0].sql).toBe(
      'UPDATE teleport_products SET option_groups = $1 WHERE id = $2 RETURNING *'
    )
  })

  it('updates a product without its product page on a store that lacks the column', async () => {
    const run = bootRoute({ teleport_products: ['id', 'name', 'price', 'option_groups'] })
    const out = await run('update', {
      tableName: 'teleport_products',
      columnMappings: [
        { column: 'name', value: 'Postcard' },
        { column: 'product_page', value: 'personalise' },
      ],
      filters: [{ field: 'id', value: '5b7c1f5e-8f1d-4a57-9d8f-0c6c9a7a2b11' }],
    })
    expect(out.writes[0].sql).toBe(
      'UPDATE teleport_products SET name = $1 WHERE id = $2 RETURNING *'
    )
    expect(out.warnings).toEqual([
      '[data-api] teleport_products has no product_page column; written without it.',
    ])
  })

  it('writes the product page once the column exists', async () => {
    const run = bootRoute({ teleport_products: ['id', 'name', 'price', 'product_page'] })
    const out = await run('update', {
      tableName: 'teleport_products',
      columnMappings: [{ column: 'product_page', value: 'personalise' }],
      filters: [{ field: 'id', value: '5b7c1f5e-8f1d-4a57-9d8f-0c6c9a7a2b11' }],
    })
    expect(out.writes[0].sql).toBe(
      'UPDATE teleport_products SET product_page = $1 WHERE id = $2 RETURNING *'
    )
  })

  it('never touches a table the feature does not own', async () => {
    const run = bootRoute({ teleport_orders: ['id', 'order_number'] })
    const out = await run('create', {
      tableName: 'teleport_orders',
      columnMappings: [
        { column: 'order_number', value: 'ORD-1' },
        { column: 'configuration', value: 'x' },
      ],
    })
    expect(out.writes[0].sql).toContain('(order_number, configuration, id)')
    expect(out.warnings).toEqual([])
  })
})
