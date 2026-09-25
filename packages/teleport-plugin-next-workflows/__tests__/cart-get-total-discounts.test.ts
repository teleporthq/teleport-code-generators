/* tslint:disable:no-eval */
import { cartGetTotal } from '../src/nodes/cart/cart-get-total'
import { cartClear } from '../src/nodes/cart/cart-clear'
import { resolveHandlerEntryName } from '../src/nodes/types'

/**
 * `cart-get-total` is where the place-order workflow's money comes from, so on
 * a store with the discount engine it re-prices the basket AT SUBMIT — the same
 * shared rule, the same rules and shopper context the provider mirrored — and
 * on a store with gift cards it says how much of that a stored card would pay.
 * The workflow compares its own server-side figure against
 * `displayedAmountDue` and refreshes the summary when they disagree.
 *
 * A store without either feature must come out exactly as before: no
 * `discounts`, `giftCard` or `displayedAmountDue` key, and the untouched
 * single-rate fields.
 */

function evalHandler(code: string): any {
  return eval('(' + code + ')')
}

const runHandler = async () => evalHandler(cartGetTotal.generateHandler())()

function mount(storage: Record<string, unknown>, fields: Record<string, string> = {}): void {
  const store: Record<string, string> = {}
  for (const key of Object.keys(storage)) {
    const value = storage[key]
    store[key] = typeof value === 'string' ? value : JSON.stringify(value)
  }
  ;(global as any).localStorage = {
    getItem: (key: string) => (key in store ? store[key] : null),
  }
  ;(global as any).document = {
    querySelector: (selector: string) => {
      const match = /^\[name="([^"]+)"\]$/.exec(selector)
      const name = match ? match[1] : ''
      return name in fields ? { value: fields[name] } : null
    },
  }
}

afterEach(() => {
  delete (global as any).localStorage
  delete (global as any).document
})

const CART = [
  { id: 'l1', productId: 'p1', price: 100, quantity: 2, categoryIds: ['c1'] },
  { id: 'l2', productId: 'p2', price: 50, quantity: 1, categoryIds: ['c2'] },
]

const TEN_PERCENT = {
  id: 'a-ten',
  name: 'Ten percent',
  status: 'active',
  discount_type: 'percentage',
  discount_value: '10.00',
  applies_to_all_products: 't',
  priority: 1,
  stackable: 't',
  starts_at: null,
  ends_at: null,
}

const FIRST_ORDER = {
  id: 'a-first',
  name: 'Welcome',
  status: 'active',
  discount_type: 'fixed',
  discount_value: '5.00',
  applies_to_all_products: 't',
  first_order_only: 't',
  stackable: 't',
  starts_at: null,
  ends_at: null,
}

const VOUCHER = {
  id: 'v1',
  code: 'SAVE20',
  discount_type: 'fixed',
  discount_value: 20,
  applies_to_all_products: true,
  product_ids: [],
}

const CARD = { id: 'gc-1', last4: 'ABCD', balance: 40, currency: 'EUR', checkedAt: null }

const DELIVERY = {
  deliveryPrice: 10,
  freeDeliveryEnabled: false,
  freeDeliveryThreshold: 0,
  deliveryEnabled: true,
  storePickupEnabled: true,
}

const settingsWith = (extra: Record<string, unknown>) => ({
  maxQuantityPerProduct: null,
  deliveryConfig: DELIVERY,
  taxConfig: { storefrontTaxRate: 0 },
  vouchersEnabled: true,
  ...extra,
})

const discountsWith = (rows: unknown[] | null, customer: unknown = null) => ({
  enabled: true,
  automaticDiscounts: true,
  rows,
  customer,
})

describe('cart-get-total — discount engine and gift-card tender', () => {
  it('stays one function expression whose entry point still resolves', () => {
    const source = cartGetTotal.generateHandler()
    expect(source.trim().startsWith('async function cart_get_total()')).toBe(true)
    expect(resolveHandlerEntryName(source, 'cart-get-total')).toBe('cart_get_total')
    expect(source).toContain('var __deResolve = function')
  })

  it('adds nothing for a store without either feature', async () => {
    mount({
      workflow_cart: CART,
      workflow_cart_settings: settingsWith({}),
      workflow_voucher: VOUCHER,
    })
    const out = await runHandler()
    expect(out.discounts).toBeUndefined()
    expect(out.giftCard).toBeUndefined()
    expect(out.displayedAmountDue).toBeUndefined()
    expect(out.subtotal).toBe(250)
    expect(out.total).toBe(250)
    expect(out.voucher).toEqual(VOUCHER)
  })

  it('prices the automatic rules and the voucher exactly as the summary did', async () => {
    mount({
      workflow_cart: CART,
      workflow_cart_settings: settingsWith({ discounts: discountsWith([TEN_PERCENT]) }),
      workflow_voucher: VOUCHER,
    })
    const out = await runHandler()
    // NET goods stay NET; the discounts arrive additively.
    expect(out.subtotal).toBe(250)
    expect(out.total).toBe(250)
    expect(out.discounts).toMatchObject({
      enabled: true,
      automaticDiscounts: true,
      rows: [TEN_PERCENT],
      customer: null,
      goodsDiscount: 45,
      shippingDiscount: 0,
      automaticDiscount: 25,
      voucherDiscount: 20,
      appliedIds: ['a-ten', 'v1'],
    })
    expect(out.discounts.applied.map((entry: { source: string }) => entry.source)).toEqual([
      'automatic',
      'voucher',
    ])
    // 250 goods + 10 delivery − 45.
    expect(out.displayedAmountDue).toBe(215)
    expect(out.giftCard).toBeUndefined()
  })

  it('reads the shopper context the checkout page-load workflow wrote', async () => {
    mount({
      workflow_cart: CART,
      workflow_cart_settings: settingsWith({
        discounts: discountsWith([FIRST_ORDER]),
        customer: { isFirstOrder: true, resolvedAt: 1 },
      }),
    })
    const out = await runHandler()
    expect(out.discounts.customer).toEqual({ isFirstOrder: true, resolvedAt: 1 })
    expect(out.discounts.automaticDiscount).toBe(5)

    mount({
      workflow_cart: CART,
      workflow_cart_settings: settingsWith({ discounts: discountsWith([FIRST_ORDER]) }),
    })
    expect((await runHandler()).discounts.automaticDiscount).toBe(0)
  })

  it('prices exactly the active rows the feed served, whatever the browser clock says', async () => {
    // The data route narrowed the rows to the rules the DATABASE calls live;
    // the server re-prices with that same clock at submit. Re-judging the
    // window here — by a skewed browser clock, or bounds read in another
    // timezone — would price a different set of rules than the one charged.
    const realNow = Date.now
    Date.now = () => Date.parse('2999-06-01T00:00:00.000Z')
    try {
      mount({
        workflow_cart: CART,
        workflow_cart_settings: settingsWith({
          discounts: discountsWith([
            { ...TEN_PERCENT, ends_at: '2000-01-01T00:00:00.000Z' },
            { ...TEN_PERCENT, id: 'a-off', status: 'disabled' },
          ]),
        }),
      })
      const out = await runHandler()
      expect(out.discounts.appliedIds).toEqual(['a-ten'])
      expect(out.discounts.automaticDiscount).toBe(25)
    } finally {
      Date.now = realNow
    }
  })

  it('prices the order with the set the shopper chose, and reports the sets beside the pick', async () => {
    const fifteen = {
      id: 'a-fifteen',
      name: 'Fifteen off',
      status: 'active',
      discount_type: 'fixed',
      discount_value: '15',
      applies_to_all_products: 't',
      priority: 5,
      stackable: 'f',
    }
    mount({
      workflow_cart: CART,
      workflow_cart_settings: settingsWith({ discounts: discountsWith([TEN_PERCENT, fifteen]) }),
      workflow_discount_choice: 'a-fifteen',
    })
    const picked = await runHandler()
    expect(picked.discounts).toMatchObject({
      automaticDiscount: 15,
      appliedIds: ['a-fifteen'],
      choice: 'a-fifteen',
    })
    expect(
      picked.discounts.options.map((option: { key: string; selected: boolean }) => [
        option.key,
        option.selected,
      ])
    ).toEqual([
      ['a-fifteen', true],
      ['combination', false],
    ])
    // 250 + 10 − 15.
    expect(picked.displayedAmountDue).toBe(245)

    // A pick the engine no longer offers falls back to the best set.
    mount({
      workflow_cart: CART,
      workflow_cart_settings: settingsWith({ discounts: discountsWith([TEN_PERCENT, fifteen]) }),
      workflow_discount_choice: 'gone',
    })
    const best = await runHandler()
    expect(best.discounts).toMatchObject({ automaticDiscount: 25, choice: 'combination' })
  })

  it('loads no rules when the merchant left automatic discounts off, but still prices the voucher through the engine', async () => {
    mount({
      workflow_cart: CART,
      workflow_cart_settings: settingsWith({
        discounts: {
          enabled: true,
          automaticDiscounts: false,
          rows: [TEN_PERCENT],
          customer: null,
        },
      }),
      workflow_voucher: VOUCHER,
    })
    const out = await runHandler()
    expect(out.discounts.automaticDiscount).toBe(0)
    expect(out.discounts.voucherDiscount).toBe(20)
    expect(out.discounts.automaticDiscounts).toBe(false)
  })

  it('honours the vouchers flag the provider mirrored', async () => {
    mount({
      workflow_cart: CART,
      workflow_cart_settings: settingsWith({
        vouchersEnabled: false,
        discounts: discountsWith([]),
      }),
      workflow_voucher: VOUCHER,
    })
    const out = await runHandler()
    expect(out.discounts.voucherDiscount).toBe(0)
    expect(out.discounts.appliedIds).toEqual([])
    // The stored copy is still reported: the workflow decides what to do with it.
    expect(out.voucher).toEqual(VOUCHER)
  })

  it('nets a waived delivery off the amount due exactly once', async () => {
    mount({
      workflow_cart: CART,
      workflow_cart_settings: settingsWith({ discounts: discountsWith([]) }),
      workflow_voucher: { ...VOUCHER, discount_type: 'free_shipping', discount_value: 0 },
    })
    const out = await runHandler()
    expect(out.discounts.shippingDiscount).toBe(10)
    expect(out.discounts.voucherDiscount).toBe(10)
    expect(out.displayedAmountDue).toBe(250)
  })

  it('prices the delivery fee the way the provider does, threshold included', async () => {
    mount({
      workflow_cart: CART,
      workflow_cart_settings: settingsWith({
        deliveryConfig: { ...DELIVERY, freeDeliveryEnabled: true, freeDeliveryThreshold: 200 },
        discounts: discountsWith([]),
      }),
    })
    expect((await runHandler()).displayedAmountDue).toBe(250)

    mount({
      workflow_cart: CART,
      workflow_cart_settings: settingsWith({
        deliveryConfig: { ...DELIVERY, deliveryEnabled: false },
        discounts: discountsWith([]),
      }),
    })
    expect((await runHandler()).displayedAmountDue).toBe(250)
  })

  it('prices gross lines from the tax rate on a single-rate store', async () => {
    mount({
      workflow_cart: [{ id: 'l1', productId: 'p1', price: 100, quantity: 1 }],
      workflow_cart_settings: settingsWith({
        taxConfig: { storefrontTaxRate: 20 },
        discounts: discountsWith([TEN_PERCENT]),
      }),
    })
    const out = await runHandler()
    expect(out.total).toBe(120)
    expect(out.discounts.automaticDiscount).toBe(12)
    expect(out.displayedAmountDue).toBe(118)
  })

  it('prices lines already grossed by the regional quote, with its shipping', async () => {
    mount(
      {
        workflow_cart: [{ id: 'l1', productId: 'p1', price: 100, quantity: 1 }],
        workflow_cart_settings: settingsWith({
          discounts: discountsWith([TEN_PERCENT]),
          regional: {
            store: {
              deliveryEnabled: true,
              storePickupEnabled: true,
              deliveryPrice: 5,
              freeDeliveryEnabled: false,
              freeDeliveryThreshold: 0,
              defaultTaxRate: 20,
              defaultTaxIncluded: false,
            },
            currency: 'EUR',
            countryCodes: { germany: 'DE' },
            rows: {
              zones: [{ id: 'z1', name: 'Germany', countries: 'DE', is_active: 't' }],
              rates: [
                { id: 'r1', zone_id: 'z1', name: 'Standard', rate_type: 'flat', price: '10.00' },
              ],
              taxRates: [
                { id: 't1', country_code: 'DE', rate: '19', tax_mode: 'added', tax_shipping: true },
              ],
            },
          },
        }),
      },
      { billingCountry: 'Germany', state: '' }
    )
    const out = await runHandler()
    expect(out.regional).toMatchObject({ goodsGross: 119, shippingGross: 11.9 })
    // 10% of the 119 gross line, never re-taxed.
    expect(out.discounts.automaticDiscount).toBe(11.9)
    expect(out.displayedAmountDue).toBe(119)
  })

  it('says how much a stored gift card pays of the delivery total', async () => {
    mount({
      workflow_cart: CART,
      workflow_cart_settings: settingsWith({
        discounts: discountsWith([TEN_PERCENT]),
        giftCards: { enabled: true, currency: 'EUR' },
      }),
      workflow_gift_card: CARD,
    })
    const out = await runHandler()
    // 250 + 10 − 25 = 235 owed; the card covers 40 of it.
    expect(out.giftCard).toEqual({
      id: 'gc-1',
      last4: 'ABCD',
      balance: 40,
      amount: 40,
      amountDue: 195,
    })
    expect(out.displayedAmountDue).toBe(195)
  })

  it('takes a gift card without the discount engine, pricing the voucher in legacy mode', async () => {
    mount({
      workflow_cart: CART,
      workflow_cart_settings: settingsWith({ giftCards: { enabled: true, currency: 'EUR' } }),
      workflow_voucher: VOUCHER,
      workflow_gift_card: { ...CARD, balance: 1000 },
    })
    const out = await runHandler()
    expect(out.discounts).toBeUndefined()
    // 250 + 10 − 20 = 240, all of it on the card.
    expect(out.giftCard).toMatchObject({ amount: 240, amountDue: 0 })
    expect(out.displayedAmountDue).toBe(0)
  })

  it('reports no gift card when the stored one pays nothing', async () => {
    const settings = settingsWith({ giftCards: { enabled: true, currency: 'EUR' } })
    // Another currency.
    mount({
      workflow_cart: CART,
      workflow_cart_settings: settings,
      workflow_gift_card: { ...CARD, currency: 'USD' },
    })
    expect((await runHandler()).giftCard).toBeNull()
    // A gift card in the basket.
    mount({
      workflow_cart: [
        ...CART,
        { id: 'l3', productId: 'g1', price: 25, quantity: 1, isGiftCard: true },
      ],
      workflow_cart_settings: settings,
      workflow_gift_card: CARD,
    })
    const out = await runHandler()
    expect(out.giftCard).toBeNull()
    expect(out.displayedAmountDue).toBe(285)
    // Nothing stored, or nothing readable.
    mount({ workflow_cart: CART, workflow_cart_settings: settings })
    expect((await runHandler()).giftCard).toBeNull()
    mount({ workflow_cart: CART, workflow_cart_settings: settings, workflow_gift_card: 'not json' })
    expect((await runHandler()).giftCard).toBeNull()
  })

  it('returns the untouched zeroed shape when localStorage is unreadable', async () => {
    ;(global as any).localStorage = {
      getItem: () => {
        throw new Error('denied')
      },
    }
    const out = await runHandler()
    expect(Object.keys(out).sort()).toEqual(
      [
        'deliveryConfig',
        'itemCount',
        'productDiscountTotal',
        'subtotal',
        'tax',
        'taxConfig',
        'total',
        'voucher',
      ].sort()
    )
  })
})

describe('cart-clear — forgets the applied gift card', () => {
  const handlerCode = cartClear.generateHandler()

  it('forgets the discount choice with the cart, and tells the provider', () => {
    const source = cartClear.generateHandler()
    expect(source).toContain("localStorage.removeItem('workflow_discount_choice')")
    expect(source).toContain("new CustomEvent('teleport:discount-choice-changed')")
  })

  it('removes the stored card and tells the provider', () => {
    // The balance belongs to the shopper, not to the emptied cart: the next
    // order asks for the code again rather than silently spending it.
    expect(handlerCode).toContain("localStorage.removeItem('workflow_gift_card')")
    expect(handlerCode).toContain("dispatchEvent(new CustomEvent('teleport:gift-card-changed'))")
  })
})
