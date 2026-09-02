import { generateEcommerceContextFileContent } from '../src/ecommerce/ecommerce-context-generator'
import { UIDLEcommerceSettings } from '@teleporthq/teleport-types'

/**
 * `enrichCartItems` is the one regenerated choke point that can heal a cart
 * line whose price has drifted. A per-product discount starts and expires on a
 * schedule, so a line added at full price yesterday must be re-priced today —
 * and the re-priced cart has to be PERSISTED, because `cart-get-total` reads
 * localStorage directly when the order is placed.
 *
 * The provider only persists (and re-renders) when enrichment returns a NEW
 * array, so this also pins the no-op contract: an unchanged cart must come back
 * by reference.
 */

const settings = { paymentProviders: [] } as unknown as UIDLEcommerceSettings

interface CartLine {
  productId: string
  quantity: number
  price?: number
  name?: string
  originalPrice?: number | null
  discountType?: string | null
  discountAmount?: number
  [key: string]: unknown
}

interface ProductRow {
  id: string
  name: string
  price: number
  currency?: string
  discounts?: string | null
  [key: string]: unknown
}

/**
 * Evaluates the emitted provider's `enrichCartItems` against a stubbed
 * `/api/data` response, so the real generated source is what gets tested.
 */
function loadEnrich(rows: ProductRow[]): (items: CartLine[]) => Promise<CartLine[]> {
  const source = generateEcommerceContextFileContent(settings, undefined, 'ds-1')
  // From the discount helpers (emitted just above the enrich function, and used
  // by it) through to the next top-level declaration. Starting any later would
  // leave `__pdResolveActive` undefined, and enrichment swallows its own errors
  // — the test would then pass against a function that never ran.
  const start = source.indexOf('function __pdRound2')
  const end = source.indexOf('function saveCartToStorage')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const helpers = source.slice(start, end)
  expect(helpers).toContain('function enrichCartItems')

  const factory = new Function(
    'rows',
    `
    const PRODUCTS_DATA_SOURCE_ID = 'ds-1'
    const fetch = async (url) => {
      if (String(url).indexOf('/api/ecommerce/variants') === 0) {
        return { ok: true, json: async () => ({ variants: [] }) }
      }
      return { ok: true, json: async () => ({ rows }) }
    }
    ${helpers}
    return enrichCartItems
    `
  )
  return factory(rows) as (items: CartLine[]) => Promise<CartLine[]>
}

const discountColumn = (value: number, type = 'percentage') =>
  JSON.stringify([{ id: 'd1', type, value, startsAt: null, endsAt: null }])

describe('generated cart provider — per-product discounts on hydration', () => {
  it('re-prices a line that was added before the discount started', async () => {
    const enrich = loadEnrich([
      { id: 'p1', name: 'P', price: 100, currency: 'USD', discounts: discountColumn(10) },
    ])
    // Stored at full price, as an older session would have left it.
    const [line] = await enrich([{ productId: 'p1', quantity: 2, price: 100, name: 'P' }])

    expect(line.price).toBe(90)
    expect(line.originalPrice).toBe(100)
    expect(line.discountType).toBe('percentage')
    expect(line.discountAmount).toBe(10)
  })

  it('clears the markdown from a line whose discount has expired', async () => {
    const enrich = loadEnrich([
      { id: 'p1', name: 'P', price: 100, currency: 'USD', discounts: null },
    ])
    const [line] = await enrich([
      {
        productId: 'p1',
        quantity: 1,
        price: 90,
        name: 'P',
        originalPrice: 100,
        discountType: 'percentage',
        discountAmount: 10,
      },
    ])

    // Back to the list price, and the stale saving is cleared rather than kept.
    expect(line.price).toBe(100)
    expect(line.originalPrice).toBeNull()
    expect(line.discountType).toBeNull()
    expect(line.discountAmount).toBe(0)
  })

  it('returns the SAME array when nothing changed, so no redundant write happens', async () => {
    const enrich = loadEnrich([
      { id: 'p1', name: 'P', price: 100, currency: 'USD', discounts: discountColumn(10) },
    ])
    const items: CartLine[] = [{ productId: 'p1', quantity: 1, price: 100, name: 'P' }]

    const first = await enrich(items)
    expect(first).not.toBe(items)

    // Feeding the already-enriched cart back in must be a no-op.
    const second = await enrich(first)
    expect(second).toBe(first)
  })

  it('leaves a line whose product no longer exists exactly as it was', async () => {
    const enrich = loadEnrich([])
    const items: CartLine[] = [{ productId: 'gone', quantity: 1, price: 42, name: 'Old' }]
    const result = await enrich(items)
    expect(result[0].price).toBe(42)
    expect(result[0].name).toBe('Old')
  })
})

/**
 * What the cart and checkout TEMPLATES bind. `enrichCartItems` stores the
 * markdown NET and per-unit; the display projection has to gross it up and
 * multiply it out exactly like `price`, or the struck "was" figure prints
 * BELOW the price it is struck against on any taxed store or any line holding
 * more than one unit.
 */
interface DisplayHelpers {
  cartItemHasDiscount: (item: Record<string, unknown>) => boolean
  cartItemLineTotal: (item: Record<string, unknown>) => number
  cartItemOriginalLineTotal: (item: Record<string, unknown>) => number
  formatCartMoney: (amount: unknown) => string
}

function loadDisplayHelpers(taxRate: number): DisplayHelpers {
  const invoiceSettings = {
    enabled: true,
    invoicePrefix: 'INV-',
    defaultTaxRate: taxRate,
    taxIncludedInPrice: false,
    showDiscount: false,
    autoGenerateOnPayment: true,
    companyDetails: {},
  } as unknown as Parameters<typeof generateEcommerceContextFileContent>[1]
  const source = generateEcommerceContextFileContent(settings, invoiceSettings, 'ds-1')

  // From the money primitives (STOREFRONT_TAX_RATE is declared inside this
  // block) up to the first helper that does not belong to a single line.
  const start = source.indexOf('function roundMoney')
  const end = source.indexOf('function computeCartMeta')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const helpers = source.slice(start, end)
  // Guard the slice itself: a missing helper would leave the eval throwing
  // somewhere a passing assertion could hide.
  expect(helpers).toContain('function cartItemHasDiscount')
  expect(helpers).toContain('function cartItemOriginalLineTotal')

  return new Function(
    `${helpers}
    return { cartItemHasDiscount, cartItemLineTotal, cartItemOriginalLineTotal, formatCartMoney }`
  )() as DisplayHelpers
}

describe('generated cart provider — the struck "was" price', () => {
  it('publishes both display fields off the same test', () => {
    const source = generateEcommerceContextFileContent(settings, undefined, 'ds-1')
    const start = source.indexOf('const displayCartItems')
    expect(start).toBeGreaterThan(-1)
    const projection = source.slice(start, start + 1500)

    expect(projection).toContain('originalPrice: cartItemHasDiscount(item)')
    expect(projection).toContain('formatCartMoney(cartItemOriginalLineTotal(item))')
    // A 'true'/'false' STRING: a rendering condition compares operands as
    // strings, and `!= ''` passes for a field the line does not carry.
    expect(projection).toContain("hasDiscount: cartItemHasDiscount(item) ? 'true' : 'false'")
  })

  it('grosses and multiplies the original exactly like the charged price', () => {
    const { cartItemLineTotal, cartItemOriginalLineTotal, formatCartMoney } = loadDisplayHelpers(19)
    const line = { price: 90, originalPrice: 100, quantity: 2 }

    // 90 net + 19% = 107.10 charged each; struck through 100 net + 19% = 119.00.
    expect(formatCartMoney(cartItemLineTotal(line))).toBe('214.20')
    expect(formatCartMoney(cartItemOriginalLineTotal(line))).toBe('238.00')
    expect(cartItemOriginalLineTotal(line)).toBeGreaterThan(cartItemLineTotal(line))
  })

  it('needs no tax to agree', () => {
    const { cartItemOriginalLineTotal, formatCartMoney } = loadDisplayHelpers(0)
    expect(formatCartMoney(cartItemOriginalLineTotal({ price: 90, originalPrice: 100 }))).toBe(
      '100.00'
    )
  })

  it('reads every shape of "no markdown" as undiscounted', () => {
    const { cartItemHasDiscount } = loadDisplayHelpers(19)

    // Cleared by enrichCartItems when the discount expired.
    expect(cartItemHasDiscount({ price: 100, originalPrice: null })).toBe(false)
    // A line written by the provider's own addToCart, before the next
    // hydration re-stamps it.
    expect(cartItemHasDiscount({ price: 100 })).toBe(false)
    // A saving of nothing is not a discount worth striking a price for.
    expect(cartItemHasDiscount({ price: 100, originalPrice: 100 })).toBe(false)
    expect(cartItemHasDiscount({ price: 90, originalPrice: 100 })).toBe(true)
  })
})
