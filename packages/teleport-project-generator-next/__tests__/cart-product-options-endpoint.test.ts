/* tslint:disable:function-constructor */
import { generateCartApiRoute } from '../src/ecommerce/cart-api-routes-generator'
import { configured } from './_helpers/product-options-fixtures'

/**
 * The database cart and product options. A line bought with options is its own
 * row, keyed by product, variant AND its options' key, and carries its answers
 * — but only where `teleport_cart_items` has the two columns. A store
 * provisioned before them keeps running exactly the SQL it always ran: such a
 * line is skipped at sync (the tab keeps it, told by `configurationsPersisted`)
 * and never merged into the product's plain line. Executed against a fake pool.
 */

const PRODUCT = '6f1c2a9e-2b1d-4c1e-9a55-0d6b1f0c2a11'
const MUG = '8d0e7b1a-4c2f-4b7d-8e1a-5a9c3d2e1f00'
const USER = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

const A3 = configured([
  { key: 'size', value: 'a3' },
  { key: 'paper', value: 'glossy' },
])
const A5 = configured([
  { key: 'size', value: 'a5' },
  { key: 'paper', value: 'matte' },
])

interface Query {
  sql: string
  params: unknown[]
}

interface Scenario {
  columns: boolean
  signedIn?: boolean
  itemRows?: Array<Record<string, unknown>>
  guestCart?: boolean
  userCart?: boolean
}

function bootRoute(scenario: Scenario, database?: (sql: string, params: unknown[]) => unknown) {
  const code = generateCartApiRoute('postgresql', {
    connectionString: 'env:DATABASE_URL',
  }) as string
  const queries: Query[] = []
  let probes = 0
  const answer = (sql: string, params: unknown[]) => {
    if (database) {
      return database(sql, params)
    }
    if (/information_schema/.test(sql)) {
      probes++
      return { rows: [{ n: scenario.columns ? 2 : 0 }] }
    }
    if (/^SELECT product_id, variant_id/.test(sql)) {
      return { rows: scenario.itemRows || [] }
    }
    if (
      /session_id = \$1 AND user_id IS NULL ORDER BY updated_at DESC LIMIT 1 FOR UPDATE/.test(sql)
    ) {
      return { rows: scenario.guestCart ? [{ id: 'guest-cart' }] : [] }
    }
    if (
      /WHERE status = 'active' AND user_id = \$1 ORDER BY updated_at DESC LIMIT 1 FOR UPDATE/.test(
        sql
      )
    ) {
      return { rows: scenario.userCart ? [{ id: 'user-cart' }] : [] }
    }
    if (/SELECT id FROM teleport_cart WHERE status = 'active' AND/.test(sql)) {
      return { rows: [{ id: 'cart-1' }] }
    }
    return { rows: [], rowCount: 0 }
  }
  class FakePool {
    public async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params })
      return answer(sql, params)
    }
    public async connect() {
      return {
        query: async (sql: string, params: unknown[] = []) => {
          queries.push({ sql, params })
          return answer(sql, params)
        },
        release: () => undefined,
      }
    }
  }
  const moduleObj: { exports: any } = { exports: {} }
  const fakeRequire = (name: string): any => {
    if (name === 'pg') {
      return { Pool: FakePool }
    }
    if (name === 'next-auth/jwt') {
      return { getToken: async () => (scenario.signedIn ? { id: USER } : null) }
    }
    if (name === '../../../utils/email/email-locale') {
      return { normalizeEmailLocale: () => null }
    }
    throw new Error('unexpected require: ' + name)
  }
  new Function('require', 'module', 'exports', 'process', code)(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    { env: { NEXTAUTH_SECRET: 'secret', DATABASE_URL: 'postgresql://x' } }
  )
  const run = async (op: string, body: Record<string, unknown>) => {
    queries.length = 0
    let payload: any = null
    const res = {
      status() {
        return this
      },
      json(value: any) {
        payload = value
        return this
      },
    }
    await moduleObj.exports({ method: 'POST', query: { op }, headers: {}, body }, res)
    return { payload, queries: queries.filter((query) => !/information_schema/.test(query.sql)) }
  }
  return { run, probes: () => probes }
}

const inserts = (queries: Query[]) =>
  queries.filter((query) => query.sql.indexOf('INSERT INTO teleport_cart_items') === 0)

const SYNC_ITEMS = [
  { productId: MUG, variantId: null, quantity: 2 },
  { productId: PRODUCT, variantId: null, quantity: 1, ...A3 },
  { productId: PRODUCT, variantId: null, quantity: 1, ...A5 },
  { productId: PRODUCT, variantId: null, quantity: 2, ...A3 },
  // Options that do not read as the provider writes them are dropped.
  { productId: PRODUCT, quantity: 1, configuration: 'not json', configurationKey: 'abc' },
  { productId: PRODUCT, quantity: 1, configuration: '{"key":"size"}', configurationKey: 'abc' },
  { productId: PRODUCT, quantity: 1, configuration: A3.configuration, configurationKey: 'a b' },
  { productId: PRODUCT, quantity: 1, configuration: A3.configuration },
  {
    productId: PRODUCT,
    quantity: 1,
    configuration: JSON.stringify([{ key: 'note', value: 'x'.repeat(8100) }]),
    configurationKey: 'abc',
  },
]

describe('cart route — syncing lines bought with product options', () => {
  it('stores each configuration as its own row, with its answers', async () => {
    const { run } = bootRoute({ columns: true })
    const out = await run('sync', { sessionId: 'guest-1', items: SYNC_ITEMS })
    expect(out.payload).toEqual({ ok: true, configurationsPersisted: true })
    const rows = inserts(out.queries)
    expect(rows.map((query) => query.sql)).toEqual(
      new Array(3).fill(
        'INSERT INTO teleport_cart_items (id, cart_id, product_id, variant_id, quantity, configuration, configuration_key, created_at, updated_at) ' +
          'SELECT $1, $2, $3, $4, $5, $6, $7, NOW(), NOW() WHERE EXISTS (SELECT 1 FROM teleport_products WHERE id = $3)'
      )
    )
    expect(rows.map((query) => query.params.slice(2))).toEqual([
      [MUG, null, 2, null, null],
      [PRODUCT, null, 3, A3.configuration, A3.configurationKey],
      [PRODUCT, null, 1, A5.configuration, A5.configurationKey],
    ])
  })

  it('runs the plain SQL and skips configured lines when the table has no columns for them', async () => {
    const { run } = bootRoute({ columns: false })
    const out = await run('sync', { sessionId: 'guest-1', items: SYNC_ITEMS })
    expect(out.payload).toEqual({ ok: true, configurationsPersisted: false })
    const rows = inserts(out.queries)
    expect(rows).toHaveLength(1)
    expect(rows[0].sql).toBe(
      'INSERT INTO teleport_cart_items (id, cart_id, product_id, variant_id, quantity, created_at, updated_at) ' +
        'SELECT $1, $2, $3, $4, $5, NOW(), NOW() WHERE EXISTS (SELECT 1 FROM teleport_products WHERE id = $3)'
    )
    expect(rows[0].params.slice(2)).toEqual([MUG, null, 2])
  })
})

describe('cart route — loading lines bought with product options', () => {
  const LEGACY_LOAD =
    'SELECT product_id, variant_id, SUM(quantity) AS quantity FROM teleport_cart_items ' +
    "WHERE cart_id = (SELECT id FROM teleport_cart WHERE status = 'active' AND " +
    '(session_id = $1 AND user_id IS NULL) ORDER BY updated_at DESC LIMIT 1) GROUP BY product_id, variant_id'

  it('groups by the options key and hands each configured line its answers', async () => {
    const { run } = bootRoute({
      columns: true,
      itemRows: [
        {
          product_id: MUG,
          variant_id: null,
          configuration_key: '',
          configuration: null,
          quantity: '2',
        },
        {
          product_id: PRODUCT,
          variant_id: 'v1',
          configuration_key: A3.configurationKey,
          configuration: A3.configuration,
          quantity: '3',
        },
      ],
    })
    const out = await run('load', { sessionId: 'guest-1' })
    expect(out.queries[0].sql).toBe(
      "SELECT product_id, variant_id, COALESCE(configuration_key, '') AS configuration_key, " +
        'MAX(configuration) AS configuration, SUM(quantity) AS quantity FROM teleport_cart_items ' +
        "WHERE cart_id = (SELECT id FROM teleport_cart WHERE status = 'active' AND " +
        '(session_id = $1 AND user_id IS NULL) ORDER BY updated_at DESC LIMIT 1) ' +
        "GROUP BY product_id, variant_id, COALESCE(configuration_key, '')"
    )
    expect(out.payload).toEqual({
      ok: true,
      configurationsPersisted: true,
      items: [
        { productId: MUG, variantId: null, quantity: 2 },
        { productId: PRODUCT, variantId: 'v1', quantity: 3, ...A3 },
      ],
    })
  })

  it('runs the plain SQL when the table has no columns for them', async () => {
    const { run } = bootRoute({
      columns: false,
      itemRows: [{ product_id: MUG, variant_id: null, quantity: '2' }],
    })
    const out = await run('load', { sessionId: 'guest-1' })
    expect(out.queries.map((query) => query.sql)).toEqual([LEGACY_LOAD])
    expect(out.payload).toEqual({
      ok: true,
      configurationsPersisted: false,
      items: [{ productId: MUG, variantId: null, quantity: 2 }],
    })
  })
})

describe('cart route — claiming a guest cart with configured lines', () => {
  const claimSql = async (columns: boolean) => {
    const { run } = bootRoute({ columns, signedIn: true, guestCart: true, userCart: true })
    const out = await run('merge', { sessionId: 'guest-1' })
    expect(out.payload).toEqual({ ok: true, merged: true, configurationsPersisted: columns })
    return out.queries.map((query) => query.sql)
  }

  it('runs the plain merge SQL when the table has no columns for them', async () => {
    const sql = await claimSql(false)
    expect(sql.find((text) => text.indexOf('INSERT INTO teleport_cart_items') === 0)).toBe(
      'INSERT INTO teleport_cart_items (id, cart_id, product_id, variant_id, quantity, created_at, updated_at) ' +
        'SELECT gen_random_uuid(), $1, g.product_id, g.variant_id, g.quantity, NOW(), NOW() ' +
        'FROM teleport_cart_items g ' +
        'WHERE g.cart_id = $2 ' +
        '  AND EXISTS (SELECT 1 FROM teleport_products p WHERE p.id = g.product_id) ' +
        '  AND NOT EXISTS (' +
        '    SELECT 1 FROM teleport_cart_items u WHERE u.cart_id = $1 ' +
        '      AND u.product_id = g.product_id ' +
        "      AND COALESCE(u.variant_id, '') = COALESCE(g.variant_id, '')" +
        '  )'
    )
    expect(sql.find((text) => text.indexOf('UPDATE teleport_cart_items u') === 0)).toBe(
      'UPDATE teleport_cart_items u SET quantity = LEAST(' +
        'u.quantity + g.quantity, ' +
        'COALESCE((SELECT p.quantity FROM teleport_products p WHERE p.id = u.product_id), ' +
        'u.quantity + g.quantity)), updated_at = NOW() ' +
        'FROM teleport_cart_items g ' +
        'WHERE g.cart_id = $2 AND u.cart_id = $1 ' +
        '  AND u.product_id = g.product_id ' +
        "  AND COALESCE(u.variant_id, '') = COALESCE(g.variant_id, '')"
    )
  })

  // Both statements run in one transaction, so an UPDATE run after the INSERT
  // matches the lines the INSERT just copied and adds their quantity again.
  it('adds to the account’s own lines before copying the guest-only ones', async () => {
    const sql = await claimSql(false)
    const update = sql.findIndex((text) => text.indexOf('UPDATE teleport_cart_items u') === 0)
    const insert = sql.findIndex((text) => text.indexOf('INSERT INTO teleport_cart_items') === 0)
    expect(update).toBeGreaterThan(-1)
    expect(insert).toBeGreaterThan(update)
  })

  it('answers the merged sync with whether configured lines were kept', async () => {
    const { run } = bootRoute({ columns: false, signedIn: true, guestCart: true, userCart: true })
    const out = await run('sync', { sessionId: 'guest-1', items: SYNC_ITEMS })
    expect(out.payload).toEqual({
      ok: true,
      merged: true,
      items: [],
      configurationsPersisted: false,
    })
  })
})

describe('cart route — a guest merge caps stock across a product’s configurations', () => {
  const RED = configured([{ key: 'colour', value: 'red' }])
  const BLUE = configured([{ key: 'colour', value: 'blue' }])
  const GREEN = configured([{ key: 'colour', value: 'green' }])
  const COLOURS: Record<string, string> = {
    [RED.configurationKey]: 'Red',
    [BLUE.configurationKey]: 'Blue',
    [GREEN.configurationKey]: 'Green',
  }
  const NAMES: Record<string, string> = { [MUG]: 'Mug', [PRODUCT]: 'Print' }

  interface Line {
    product: string
    quantity: number
    variant?: string
    options?: { configuration: string; configurationKey: string }
  }
  interface Row {
    cart_id: string
    product_id: string
    variant_id: string | null
    quantity: number
    configuration: string | null
    configuration_key: string | null
  }

  // Both carts and the catalogue as rows, answering the statements the claim
  // and the load run. Anything else throws, which fails the claim.
  const cartDatabase = (stock: Record<string, number | null>, guest: Line[], account: Line[]) => {
    let guestActive = true
    const toRow =
      (cartId: string) =>
      (line: Line): Row => ({
        cart_id: cartId,
        product_id: line.product,
        variant_id: line.variant || null,
        quantity: line.quantity,
        configuration: line.options ? line.options.configuration : null,
        configuration_key: line.options ? line.options.configurationKey : null,
      })
    const rows = [...guest.map(toRow('guest-cart')), ...account.map(toRow('user-cart'))]
    const same = (a: unknown, b: unknown) => (a || '') === (b || '')
    const grouped = (cartId: string, keyOf: (row: Row) => string) => {
      const groups: Record<string, Row> = {}
      rows
        .filter((row) => row.cart_id === cartId)
        .forEach((row) => {
          const key = keyOf(row)
          groups[key] = groups[key]
            ? { ...groups[key], quantity: groups[key].quantity + row.quantity }
            : { ...row }
        })
      return Object.values(groups)
    }
    return (sql: string, params: any[]): { rows: unknown[]; rowCount?: number } => {
      if (/information_schema/.test(sql)) {
        return { rows: [{ n: 2 }] }
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || /^UPDATE teleport_cart SET updated_at/.test(sql)) {
        return { rows: [], rowCount: 1 }
      }
      if (
        /session_id = \$1 AND user_id IS NULL ORDER BY updated_at DESC LIMIT 1 FOR UPDATE/.test(sql)
      ) {
        return { rows: guestActive ? [{ id: 'guest-cart' }] : [] }
      }
      if (/AND user_id = \$1 ORDER BY updated_at DESC LIMIT 1 FOR UPDATE/.test(sql)) {
        return { rows: [{ id: 'user-cart' }] }
      }
      if (/^UPDATE teleport_cart SET status = 'merged'/.test(sql)) {
        guestActive = false
        return { rows: [], rowCount: 1 }
      }
      // SUM over an INTEGER column comes back as a bigint string.
      if (
        /^SELECT product_id, COALESCE\(variant_id, ''\) AS variant_id, SUM\(quantity\)/.test(sql)
      ) {
        return {
          rows: grouped(params[0], (row) => row.product_id + '|' + (row.variant_id || '')).map(
            (row) => ({
              product_id: row.product_id,
              variant_id: row.variant_id || '',
              quantity: String(row.quantity),
            })
          ),
        }
      }
      if (/^SELECT g\.product_id, .* JOIN teleport_products p ON p\.id = g\.product_id/.test(sql)) {
        return {
          rows: rows
            .filter((row) => row.cart_id === params[0] && row.product_id in stock)
            .map((row) => ({ ...row, stock: stock[row.product_id] })),
        }
      }
      if (/^UPDATE teleport_cart_items SET quantity = quantity \+ \$5/.test(sql)) {
        const [cartId, productId, variantId, key, add] = params
        const hit = rows.find(
          (row) =>
            row.cart_id === cartId &&
            row.product_id === productId &&
            same(row.variant_id, variantId) &&
            same(row.configuration_key, key)
        )
        if (hit) {
          hit.quantity += add
        }
        return { rows: [], rowCount: hit ? 1 : 0 }
      }
      if (
        /^INSERT INTO teleport_cart_items \(id, cart_id, product_id, variant_id, quantity, configuration, configuration_key, created_at, updated_at\) SELECT \$1, \$2, \$3/.test(
          sql
        )
      ) {
        const [, cartId, productId, variantId, quantity, configuration, key] = params
        if (!(productId in stock)) {
          return { rows: [], rowCount: 0 }
        }
        rows.push({
          cart_id: cartId,
          product_id: productId,
          variant_id: variantId,
          quantity,
          configuration,
          configuration_key: key,
        })
        return { rows: [], rowCount: 1 }
      }
      if (/^SELECT product_id, variant_id, COALESCE\(configuration_key, ''\)/.test(sql)) {
        return {
          rows: grouped(
            'user-cart',
            (row) =>
              row.product_id + '|' + (row.variant_id || '') + '|' + (row.configuration_key || '')
          ).map((row) => ({
            ...row,
            configuration_key: row.configuration_key || '',
            quantity: String(row.quantity),
          })),
        }
      }
      throw new Error('unexpected statement: ' + sql)
    }
  }

  const describeLine = (item: any) =>
    NAMES[item.productId] +
    (item.variantId ? '/' + item.variantId : '') +
    (item.configurationKey ? ' ' + COLOURS[item.configurationKey] : '') +
    ' x' +
    item.quantity

  const mergeTwiceThenLoad = async (
    stock: Record<string, number | null>,
    guest: Line[],
    account: Line[]
  ) => {
    const { run } = bootRoute(
      { columns: true, signedIn: true },
      cartDatabase(stock, guest, account)
    )
    const first = await run('merge', { sessionId: 'guest-1' })
    expect(first.payload).toEqual({ ok: true, merged: true, configurationsPersisted: true })
    // The guest cart is retired, so a second claim finds nothing to merge.
    const again = await run('merge', { sessionId: 'guest-1' })
    expect(again.payload).toEqual({ ok: true, merged: false, configurationsPersisted: true })
    const load = await run('load', { sessionId: 'guest-1' })
    expect(load.payload.ok).toBe(true)
    return load.payload.items.map(describeLine).sort()
  }

  it('lets a guest configuration take only the stock the account’s other configuration left', async () => {
    const cart = await mergeTwiceThenLoad(
      { [MUG]: 5 },
      [{ product: MUG, quantity: 3, options: RED }],
      [{ product: MUG, quantity: 3, options: BLUE }]
    )
    expect(cart).toEqual(['Mug Blue x3', 'Mug Red x2'])
  })

  it('counts the room as it copies, so two guest configurations cannot share it', async () => {
    const cart = await mergeTwiceThenLoad(
      { [MUG]: 5 },
      [
        { product: MUG, quantity: 2, options: RED },
        { product: MUG, quantity: 2, options: GREEN },
      ],
      [{ product: MUG, quantity: 2, options: BLUE }]
    )
    expect(cart).toEqual(['Mug Blue x2', 'Mug Green x1', 'Mug Red x2'])
  })

  it('copies every line in full when the product’s stock is untracked', async () => {
    const cart = await mergeTwiceThenLoad(
      { [MUG]: null },
      [
        { product: MUG, quantity: 2, options: RED },
        { product: MUG, quantity: 2, options: GREEN },
      ],
      [{ product: MUG, quantity: 2, options: BLUE }]
    )
    expect(cart).toEqual(['Mug Blue x2', 'Mug Green x2', 'Mug Red x2'])
  })

  it('adds to the same configuration up to the stock', async () => {
    const cart = await mergeTwiceThenLoad(
      { [MUG]: 5 },
      [{ product: MUG, quantity: 3, options: RED }],
      [{ product: MUG, quantity: 3, options: RED }]
    )
    expect(cart).toEqual(['Mug Red x5'])
  })

  it('counts the room per variant', async () => {
    const cart = await mergeTwiceThenLoad(
      { [MUG]: 5 },
      [
        { product: MUG, variant: 'v1', quantity: 3, options: RED },
        { product: MUG, variant: 'v2', quantity: 3 },
      ],
      [{ product: MUG, variant: 'v1', quantity: 3, options: BLUE }]
    )
    expect(cart).toEqual(['Mug/v1 Blue x3', 'Mug/v1 Red x2', 'Mug/v2 x3'])
  })

  // As the handover of a whole guest cart does: the route cannot tell a store
  // that sells on backorder, and the merge only caps what it adds up.
  it('copies a product only the guest held as the guest had it', async () => {
    const cart = await mergeTwiceThenLoad(
      { [MUG]: 5, [PRODUCT]: null },
      [{ product: MUG, quantity: 7, options: RED }],
      [{ product: PRODUCT, quantity: 1 }]
    )
    expect(cart).toEqual(['Mug Red x7', 'Print x1'])
  })

  it('never reduces the account’s own lines', async () => {
    const cart = await mergeTwiceThenLoad(
      { [MUG]: 5 },
      [{ product: MUG, quantity: 1, options: RED }],
      [{ product: MUG, quantity: 7, options: BLUE }]
    )
    expect(cart).toEqual(['Mug Blue x7'])
  })

  it('skips a product deleted since the guest added it', async () => {
    const cart = await mergeTwiceThenLoad(
      { [MUG]: 5 },
      [
        { product: PRODUCT, quantity: 2, options: RED },
        { product: MUG, quantity: 1, options: RED },
      ],
      [{ product: MUG, quantity: 1, options: BLUE }]
    )
    expect(cart).toEqual(['Mug Blue x1', 'Mug Red x1'])
  })
})

describe('cart route — asking whether the columns exist', () => {
  it('asks once when they exist, and again after five minutes when they do not', async () => {
    const present = bootRoute({ columns: true })
    await present.run('load', { sessionId: 'guest-1' })
    await present.run('load', { sessionId: 'guest-1' })
    expect(present.probes()).toBe(1)

    const realNow = Date.now
    let now = 1_000_000
    Date.now = () => now
    try {
      const absent = bootRoute({ columns: false })
      await absent.run('load', { sessionId: 'guest-1' })
      now += 4 * 60 * 1000
      await absent.run('load', { sessionId: 'guest-1' })
      expect(absent.probes()).toBe(1)
      now += 2 * 60 * 1000
      await absent.run('load', { sessionId: 'guest-1' })
      expect(absent.probes()).toBe(2)
    } finally {
      Date.now = realNow
    }
  })
})
