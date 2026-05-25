import { generateStockCheckApiRoute } from '../src/ecommerce/ecommerce-api-routes-generator'
import { UIDLEcommerceSettings } from '@teleporthq/teleport-types'

// The /api/ecommerce/stock-check endpoint is a READ-ONLY availability
// check for the cart UI: given a productId + currently-in-cart qty + a
// requested-additional qty, it returns whether the buyer can add more.
// It MUST NOT mutate teleport_products under any code path (the
// audit in `stock-decrement.ts` enforces that at a higher level; this
// file pins the endpoint shape).
//
// An earlier version of this endpoint shipped a typo'd column name
// (`stock_quantity` instead of the actual `quantity` column). The
// endpoint always returned NULL stock, the availability check
// trivially passed, and the merchant's `allowBackorders=false`
// setting was effectively no-op'd via the cart side. This regression
// guard pins the corrected column name.

const baseSettings = (overrides: Partial<UIDLEcommerceSettings> = {}): UIDLEcommerceSettings => ({
  cashOnDelivery: true,
  deliveryEnabled: true,
  storePickupEnabled: false,
  guestCheckout: true,
  stockManagement: true,
  orderNotifications: false,
  deliveryConfig: null,
  stockManagementConfig: {
    allowBackorders: false,
    lowStockThreshold: 5,
    lowStockAlerts: false,
    outOfStockVisibility: 'visible',
    maxQuantityPerProduct: 5,
  } as any,
  orderNotificationConfig: null,
  paymentProviders: [],
  ...overrides,
})

const POSTGRES_DS: { type: string; cfg: Record<string, unknown> } = {
  type: 'postgresql',
  cfg: { connectionString: 'env:DATABASE_URL' },
}

describe('generateStockCheckApiRoute — read-only availability check', () => {
  const route = generateStockCheckApiRoute(baseSettings(), POSTGRES_DS.type, POSTGRES_DS.cfg)

  it('reads the `quantity` column (not the typo`d `stock_quantity`)', () => {
    expect(route).toContain('SELECT quantity FROM teleport_products')
    expect(route).not.toContain('SELECT stock_quantity FROM teleport_products')
    // Also assert the result-extraction uses the same column name
    expect(route).toContain('result.rows[0].quantity')
    expect(route).not.toContain('result.rows[0].stock_quantity')
  })

  it('NEVER emits a write statement against teleport_products', () => {
    // This is the cart-UI endpoint. Any UPDATE / INSERT / DELETE on the
    // products table here would break the "decrement happens only on
    // order creation" contract.
    expect(route).not.toMatch(/UPDATE\s+teleport_products/i)
    expect(route).not.toMatch(/INSERT\s+INTO\s+teleport_products/i)
    expect(route).not.toMatch(/DELETE\s+FROM\s+teleport_products/i)
  })

  it('bakes the merchant`s maxQuantityPerProduct setting', () => {
    expect(route).toContain('const maxQtyPerProduct = 5')
  })

  it('bakes the merchant`s allowBackorders setting', () => {
    expect(route).toContain('const allowBackorders = false')
  })

  it('respects allowBackorders=true (no upper cap by stock when set)', () => {
    const r = generateStockCheckApiRoute(
      baseSettings({
        stockManagementConfig: { allowBackorders: true, maxQuantityPerProduct: null } as any,
      }),
      POSTGRES_DS.type,
      POSTGRES_DS.cfg
    )
    expect(r).toContain('const allowBackorders = true')
    expect(r).toContain('const maxQtyPerProduct = null')
  })

  it('rejects non-POST methods', () => {
    expect(route).toContain("if (req.method !== 'POST')")
    expect(route).toContain("'Method not allowed'")
  })

  it('returns 404 when the product is missing', () => {
    expect(route).toContain('Product not found')
  })

  it('returns 400 when productId is missing from the request body', () => {
    expect(route).toContain('Product ID is required')
  })
})

describe('generateStockCheckApiRoute — fallback path when no data source', () => {
  it('emits a no-op handler when there is no DB driver wired', () => {
    const r = generateStockCheckApiRoute(baseSettings(), null, null)
    expect(r).toContain('available: true')
    expect(r).not.toContain('db.query')
    // Even the fallback must NOT emit a write statement.
    expect(r).not.toMatch(/UPDATE\s+teleport_products/i)
  })
})
