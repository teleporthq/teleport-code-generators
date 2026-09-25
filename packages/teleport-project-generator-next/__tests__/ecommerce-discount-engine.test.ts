/* tslint:disable:no-eval function-constructor */
import { parse } from '@babel/parser'
import { UIDLEcommerceSettings, UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import { DiscountEngine } from '@teleporthq/teleport-shared'
import { generateEcommerceContextFileContent } from '../src/ecommerce/ecommerce-context-generator'
import { buildWorkflowEcommerceSettingsPayload } from '../src/ecommerce/ecommerce-api-routes-generator'
import { resolveDiscountEngine } from '../src/ecommerce/ecommerce-discount-engine-code'

/**
 * The storefront provider's half of the discount engine.
 *
 * The rule itself is pinned by teleport-shared's parity table. What this pins
 * is the provider around it: the engine prices EVERY store's vouchers (in
 * legacy mode for a checkout built before it), the rule feed — the
 * `teleport_discounts` loader, the shopper context, the mirror for
 * `cart-get-total` — is emitted only for a store whose UIDL carries the block,
 * the emitted module parses, and the projections a page binds are right — run,
 * not pattern-matched.
 */

const baseSettings = (overrides: Partial<UIDLEcommerceSettings> = {}): UIDLEcommerceSettings =>
  ({
    cashOnDelivery: true,
    deliveryEnabled: true,
    storePickupEnabled: true,
    guestCheckout: true,
    stockManagement: false,
    orderNotifications: false,
    deliveryConfig: {
      deliveryPrice: 10,
      freeDeliveryEnabled: false,
      freeDeliveryThreshold: 0,
      allowDeliveryNotes: true,
    },
    stockManagementConfig: null,
    orderNotificationConfig: null,
    paymentProviders: [],
    vouchersEnabled: true,
    ...overrides,
  } as UIDLEcommerceSettings)

const INVOICE = {
  defaultTaxRate: 19,
  taxIncludedInPrice: false,
  companyDetails: {},
} as UIDLInvoiceSettings

const ENGINE = { enabled: true, automaticDiscounts: true, currency: 'EUR' }

const REGIONAL = {
  enabled: true,
  currency: 'EUR',
  countryCodes: { germany: 'DE' },
  storeCountryCode: 'DE',
}

const engineSource = (overrides: Partial<UIDLEcommerceSettings> = {}): string =>
  generateEcommerceContextFileContent(
    baseSettings({ discountEngine: ENGINE, ...overrides }),
    INVOICE,
    'ds-1',
    false,
    false,
    false,
    'teleport'
  )

const legacySource = (): string =>
  generateEcommerceContextFileContent(
    baseSettings(),
    INVOICE,
    'ds-1',
    false,
    false,
    false,
    'teleport'
  )

const grab = (source: string, name: string): string => {
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) {
    throw new Error(`emitted provider is missing function ${name}`)
  }
  const end = source.indexOf('\n}', start)
  return source.slice(start, end + 2)
}

const constant = (source: string, name: string): string => {
  const start = source.indexOf(`const ${name} = `)
  if (start === -1) {
    throw new Error(`emitted provider is missing const ${name}`)
  }
  return source.slice(start, source.indexOf('\n', start))
}

const valueMemoDeps = (source: string): string => {
  const depsAt = source.lastIndexOf('}), [displayCartItems')
  expect(depsAt).toBeGreaterThan(-1)
  return source.slice(depsAt, source.indexOf('])', depsAt))
}

describe('resolveDiscountEngine', () => {
  it('needs the block, the flag and a datasource', () => {
    expect(resolveDiscountEngine(baseSettings({ discountEngine: ENGINE }), 'ds-1')).toEqual(ENGINE)
    expect(resolveDiscountEngine(baseSettings(), 'ds-1')).toBeNull()
    expect(
      resolveDiscountEngine(baseSettings({ discountEngine: { ...ENGINE, enabled: false } }), 'ds-1')
    ).toBeNull()
    expect(resolveDiscountEngine(baseSettings({ discountEngine: ENGINE }), null)).toBeNull()
    // The settings-less fallback context.
    expect(resolveDiscountEngine({} as UIDLEcommerceSettings, null)).toBeNull()
  })
})

describe('EcommerceProvider — the engine is always there, the rule feed is opt-in', () => {
  it('prices a store without the block in legacy mode and loads no rules', () => {
    const legacy = legacySource()
    // The shared helpers exist for every store: vouchers price through them,
    // and hydration stamps categories with their parser.
    expect(legacy).toContain('var __deResolve = function')
    expect(legacy).toContain('function computeDiscountMeta(')
    // …but nothing of the rule feed.
    expect(legacy).not.toContain('DISCOUNTS_TABLE')
    expect(legacy).not.toContain('teleport_discounts')
    expect(legacy).not.toContain('discountRows')
    expect(legacy).not.toContain('loadCustomerFromCartSettings')
    expect(legacy).not.toContain('teleport:discounts-refresh')
    expect(legacy).not.toContain('teleport:customer-changed')
    expect(legacy).toContain(
      '        [],\n        NO_DISCOUNT_CUSTOMER,\n        true,\n        discountChoice\n      ),'
    )
    expect(legacy).toContain('"discountEngineEnabled":false')
    expect(legacy).toContain('"automaticDiscountsEnabled":false')
  })

  it('stays off when the flag is present but disabled, or there is no datasource', () => {
    const disabled = generateEcommerceContextFileContent(
      baseSettings({ discountEngine: { ...ENGINE, enabled: false } }),
      INVOICE,
      'ds-1'
    )
    const noDataSource = generateEcommerceContextFileContent(
      baseSettings({ discountEngine: ENGINE }),
      INVOICE,
      null
    )
    expect(disabled).not.toContain('discountRows')
    expect(noDataSource).not.toContain('discountRows')
  })

  it('compiles the settings-less fallback context in legacy mode', () => {
    const fallback = generateEcommerceContextFileContent({} as UIDLEcommerceSettings)
    expect(() => parse(fallback, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
    expect(fallback).not.toContain('discountRows')
    expect(fallback).toContain('NO_DISCOUNT_CUSTOMER,\n        true')
  })
})

describe('EcommerceProvider — discount engine emitted module', () => {
  const source = engineSource()

  it('parses as the JSX module Next compiles', () => {
    expect(() => parse(source, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })

  it('parses with regional pricing and gift cards emitted beside it', () => {
    const everything = engineSource({
      regionalPricing: REGIONAL,
      giftCards: { enabled: true, currency: 'EUR' },
    })
    expect(() => parse(everything, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
    // Both features count the cart's lines under their own name — a shared
    // `const` would be a duplicate declaration.
    expect(everything).toContain('const cartHasItems = cartItems.length > 0')
    expect(everything).toContain('const discountCartHasItems = cartItems.length > 0')
  })

  it('bakes the engine settings and reads the active rules through the datasource', () => {
    expect(source).toContain('const DISCOUNT_ENGINE = {"automaticDiscounts":true,"currency":"EUR"}')
    expect(source).toContain(`const DISCOUNTS_TABLE = '${DiscountEngine.DISCOUNTS_TABLE}'`)
    expect(source).toContain("'/api/data/' + PRODUCTS_DATA_SOURCE_ID + '/select'")
    expect(source).toContain("filters: [{ field: 'status', value: 'active', operator: '=' }]")
    expect(source).toContain(`limit: ${DiscountEngine.DISCOUNT_RULES_LIMIT}`)
    // In the engine's own order, so a capped read keeps the rules it would apply.
    expect(source).toMatch(
      /sorts: \[\s*\{ field: 'priority', order: 'asc' \},\s*\{ field: 'name', order: 'asc' \},\s*\{ field: 'id', order: 'asc' \},\s*\]/
    )
    // Only when the merchant turned automatic rules on.
    expect(source).toContain('if (!DISCOUNT_ENGINE.automaticDiscounts) return []')
  })

  it("listens for the workflows' refresh and customer signals", () => {
    expect(source).toContain(
      `const DISCOUNTS_REFRESH_EVENT = '${DiscountEngine.DISCOUNTS_REFRESH_EVENT}'`
    )
    expect(source).toContain(
      `const CUSTOMER_CHANGED_EVENT = '${DiscountEngine.CUSTOMER_CHANGED_EVENT}'`
    )
    expect(source).toContain('window.addEventListener(CUSTOMER_CHANGED_EVENT, syncCustomer)')
    expect(source).toContain('window.addEventListener(DISCOUNTS_REFRESH_EVENT, onDiscountsRefresh)')
    expect(source).toContain(
      'window.removeEventListener(DISCOUNTS_REFRESH_EVENT, onDiscountsRefresh)'
    )
  })

  it('mirrors the rule feed into the cart settings for cart-get-total, by merge', () => {
    expect(source).toContain('discounts: {')
    expect(source).toContain('enabled: true,')
    expect(source).toContain('automaticDiscounts: DISCOUNT_ENGINE.automaticDiscounts,')
    expect(source).toContain('rows: discountRows,')
    expect(source).toContain('customer: discountCustomer,')
    expect(source).toContain('Object.assign({}, current, {\n            discounts: {')
  })

  it("carries the shopper context over the provider's own settings write", () => {
    // The whole-key write on mount must not wipe what the checkout page-load
    // workflow wrote before the provider mounted.
    expect(source).toContain('customer = previous.customer')
    expect(source).toContain('customer: customer,')
    expect(source).toContain('vouchersEnabled: true,')
  })

  it('prices with the live rules and shopper context, not in legacy mode', () => {
    expect(source).toContain(
      '        discountRules,\n        discountCustomerContext,\n        false,\n        discountChoice\n      ),'
    )
    expect(source).not.toContain('NO_DISCOUNT_CUSTOMER,\n        true')
  })

  it('hands regional stores lines already grossed in the destination tax', () => {
    const regional = engineSource({ regionalPricing: REGIONAL })
    expect(regional).toContain(
      'computeDiscountMeta(\n        regionalVoucherItems(regionalQuote, cartItems),\n        appliedVoucher,\n        0,'
    )
  })

  it('exposes the automatic-discount bindings and re-renders when they move', () => {
    for (const binding of [
      'automaticDiscount: formatCartMoney(discountMeta.automaticDiscount)',
      'automaticDiscountVisible: discountMeta.automaticDiscountVisible',
      'automaticDiscountLabel: discountMeta.automaticDiscountLabel',
      'discountTotal: formatCartMoney(discountMeta.goodsDiscount)',
      'rawDiscount: formatCartMoney(discountMeta.rawDiscount)',
    ]) {
      expect(source).toContain(binding)
    }
    const deps = valueMemoDeps(source)
    expect(deps).toContain('discountMeta')
    expect(deps).toContain('pickupDiscountMeta')
    expect(deps).toContain('pickupTotal')
  })

  it('puts the flags on both settings projections', () => {
    expect(source).toContain('"discountEngineEnabled":true')
    expect(source).toContain('"automaticDiscountsEnabled":true')
    const payload = buildWorkflowEcommerceSettingsPayload(baseSettings({ discountEngine: ENGINE }))
    expect(payload.discountEngineEnabled).toBe(true)
    expect(payload.automaticDiscountsEnabled).toBe(true)
    const manual = buildWorkflowEcommerceSettingsPayload(
      baseSettings({ discountEngine: { ...ENGINE, automaticDiscounts: false } })
    )
    expect(manual.discountEngineEnabled).toBe(true)
    expect(manual.automaticDiscountsEnabled).toBe(false)
    expect(buildWorkflowEcommerceSettingsPayload(baseSettings()).discountEngineEnabled).toBe(false)
  })

  it('stamps categories and the gift-card flag on every hydrated line', () => {
    for (const emitted of [legacySource(), source]) {
      expect(emitted).toContain(
        'categoryIds: __deStringArray(product.category_filter_ids || product.category_ids),'
      )
      expect(emitted).toContain('isGiftCard: __deBool(product.is_gift_card, false),')
      expect(emitted).toContain(
        "if (String((before && before.categoryIds) || '') !== String(after.categoryIds || '')) return true"
      )
    }
  })
})

interface DiscountMeta {
  goodsDiscount: number
  shippingDiscount: number
  rawDiscount: number
  automaticDiscount: number
  automaticDiscountLabel: string
  automaticDiscountVisible: string
  voucherApplied: string
  voucherCode: string
  voucherFreeShipping: string
  voucherDiscountVisible: string
}

interface EngineApi {
  computeDiscountMeta: (
    cartItems: unknown[],
    voucher: Record<string, unknown> | null,
    taxRatePercent: number,
    shippingMeta: { shippingPrice: number },
    vouchersEnabled: boolean,
    rules: unknown[],
    customer: { isFirstOrder: boolean | null },
    legacy: boolean
  ) => DiscountMeta
  normalizeRule: (row: Record<string, unknown>, source: string) => unknown
  noShippingMeta: { shippingPrice: number }
}

// The delivery-shaped discount keys a checkout binds, and their pickup twins.
const DISCOUNT_KEYS = [
  'rawDiscount',
  'voucherFreeShipping',
  'voucherDiscountVisible',
  'automaticDiscount',
  'automaticDiscountVisible',
  'automaticDiscountLabel',
  'discountTotal',
]
const DISCOUNT_KEYS_WITH_TWINS = [...DISCOUNT_KEYS, ...DISCOUNT_KEYS.map((key) => `${key}Pickup`)]

type CartBindings = (
  discountMeta: DiscountMeta,
  pickupDiscountMeta: DiscountMeta
) => Record<string, string>

// The provider's `Cart` bindings for `keys`, lifted out of the value memo and
// made callable over the two pricings they read — so a test asserts the value a
// page binds, not only the projection behind it.
const liftCartBindings = (source: string, keys: string[]): CartBindings => {
  const start = source.indexOf('    Cart: {')
  const lines = source.slice(start, source.indexOf('\n    },', start)).split('\n')
  const entries = keys.map((key) => {
    const line = lines.find((candidate) => candidate.trim().startsWith(`${key}: `))
    if (!line) {
      throw new Error(`emitted provider is missing Cart.${key}`)
    }
    return line.trim()
  })
  return new Function(
    'discountMeta',
    'pickupDiscountMeta',
    `${grab(source, 'formatCartMoney')}\nreturn { ${entries.join(' ')} }`
  ) as CartBindings
}

describe('EcommerceProvider — discount projections', () => {
  const source = engineSource()
  const api: EngineApi = new Function(
    [
      DiscountEngine.generateDiscountEngineHelperCode(),
      constant(source, 'NO_DISCOUNT_CUSTOMER'),
      constant(source, 'NO_SHIPPING_META'),
      grab(source, 'computeDiscountMeta'),
      'return { computeDiscountMeta: computeDiscountMeta, normalizeRule: __deNormalizeRule, noShippingMeta: NO_SHIPPING_META };',
    ].join('\n')
  )()

  const CART = [
    { productId: 'p1', price: 100, quantity: 2, categoryIds: ['c1'] },
    { productId: 'p2', price: 50, quantity: 1, categoryIds: ['c2'] },
  ]
  const SHIPPING = { shippingPrice: 10 }
  // A fee worth more than the percentage rule and the voucher together (45),
  // so an exclusive free-delivery rule is the set that saves the most.
  const FEE_ABOVE_COMBINATION = { shippingPrice: 60 }
  const TEN_PERCENT = api.normalizeRule(
    {
      id: 'a-ten',
      name: 'Ten percent',
      discount_type: 'percentage',
      discount_value: '10',
      applies_to_all_products: 't',
      priority: 1,
      stackable: 't',
    },
    'automatic'
  )
  const FREE_DELIVERY = api.normalizeRule(
    {
      id: 'a-ship',
      name: 'Free delivery',
      discount_type: 'free_shipping',
      discount_value: '0',
      applies_to_all_products: 't',
      priority: 2,
      stackable: 't',
    },
    'automatic'
  )
  const EXCLUSIVE_DELIVERY = api.normalizeRule(
    {
      id: 'a-ship-only',
      name: 'Free delivery, on its own',
      discount_type: 'free_shipping',
      discount_value: '0',
      applies_to_all_products: 't',
      priority: 1,
      stackable: 'f',
    },
    'automatic'
  )
  const VOUCHER = {
    id: 'v1',
    code: 'SAVE20',
    discount_type: 'fixed',
    discount_value: 20,
    applies_to_all_products: true,
  }

  it('reports an automatic goods discount with the rules that made it', () => {
    const meta = api.computeDiscountMeta(
      CART,
      null,
      0,
      SHIPPING,
      true,
      [TEN_PERCENT, FREE_DELIVERY],
      { isFirstOrder: null },
      false
    )
    expect(meta.automaticDiscount).toBe(25)
    expect(meta.automaticDiscountVisible).toBe('true')
    // The row's amount is goods only, so a rule that only waived shipping
    // stays out of its label.
    expect(meta.automaticDiscountLabel).toBe('Ten percent')
    expect(meta.shippingDiscount).toBe(10)
    expect(meta.goodsDiscount).toBe(25)
    expect(meta.rawDiscount).toBe(0)
    expect(meta.voucherApplied).toBe('false')
  })

  it('offers the sets the shopper may choose between and prices the one they picked', () => {
    // 10% of 250 = 25 against an exclusive 15 off: the best set is the
    // combination, the shopper's pick wins over it, and both are offered.
    const fifteen = api.normalizeRule(
      {
        id: 'a-fifteen',
        name: 'Fifteen off',
        discount_type: 'fixed',
        discount_value: '15',
        applies_to_all_products: 't',
        priority: 5,
        stackable: 'f',
      },
      'automatic'
    )
    const best = api.computeDiscountMeta(
      CART,
      null,
      0,
      SHIPPING,
      true,
      [TEN_PERCENT, fifteen],
      { isFirstOrder: null },
      false,
      ''
    )
    expect(best.automaticDiscount).toBe(25)
    expect(best.discountOptionsVisible).toBe('true')
    expect(
      best.discountOptions.map((option: { key: string; selected: boolean }) => [
        option.key,
        option.selected,
      ])
    ).toEqual([
      ['a-fifteen', false],
      ['combination', true],
    ])
    const picked = api.computeDiscountMeta(
      CART,
      null,
      0,
      SHIPPING,
      true,
      [TEN_PERCENT, fifteen],
      { isFirstOrder: null },
      false,
      'a-fifteen'
    )
    expect(picked.automaticDiscount).toBe(15)
    expect(picked.automaticDiscountLabel).toBe('Fifteen off')
    const alone = api.computeDiscountMeta(
      CART,
      null,
      0,
      SHIPPING,
      true,
      [TEN_PERCENT],
      { isFirstOrder: null },
      false,
      'x'
    )
    expect(alone.discountOptionsVisible).toBe('false')
    expect(alone.discountOptions).toEqual([])
  })

  it('stacks the voucher after the automatic rules and keeps the two figures apart', () => {
    const meta = api.computeDiscountMeta(
      CART,
      VOUCHER,
      0,
      SHIPPING,
      true,
      [TEN_PERCENT],
      { isFirstOrder: null },
      false
    )
    expect(meta.automaticDiscount).toBe(25)
    expect(meta.rawDiscount).toBe(20)
    expect(meta.goodsDiscount).toBe(45)
    expect(meta.voucherApplied).toBe('true')
    expect(meta.voucherCode).toBe('SAVE20')
    expect(meta.voucherDiscountVisible).toBe('true')
  })

  it('ignores the rules in legacy mode', () => {
    const meta = api.computeDiscountMeta(
      CART,
      VOUCHER,
      0,
      SHIPPING,
      true,
      [TEN_PERCENT],
      { isFirstOrder: null },
      true
    )
    expect(meta.automaticDiscount).toBe(0)
    expect(meta.automaticDiscountVisible).toBe('false')
    expect(meta.rawDiscount).toBe(20)
  })

  it('keeps a first-order rule off until the shopper is known to be new', () => {
    const FIRST_ORDER = api.normalizeRule(
      {
        id: 'a-first',
        name: 'Welcome',
        discount_type: 'percentage',
        discount_value: '50',
        applies_to_all_products: 't',
        first_order_only: 't',
        stackable: 't',
      },
      'automatic'
    )
    const unknown = api.computeDiscountMeta(
      CART,
      null,
      0,
      SHIPPING,
      true,
      [FIRST_ORDER],
      { isFirstOrder: null },
      false
    )
    expect(unknown.automaticDiscount).toBe(0)
    const newShopper = api.computeDiscountMeta(
      CART,
      null,
      0,
      SHIPPING,
      true,
      [FIRST_ORDER],
      { isFirstOrder: true },
      false
    )
    expect(newShopper.automaticDiscount).toBe(125)
    expect(newShopper.automaticDiscountLabel).toBe('Welcome')
  })

  it('prices a collected order without the delivery fee, the way the workflow prices it', () => {
    // An exclusive rule takes the whole order when it saves more than the
    // combinable discounts together: in the delivery shape it waives a fee
    // worth more than the percentage and the voucher combined, so those two
    // are left out. A collected order has no fee for it to waive, so it never
    // applies at all — and the engine must be told that, or the summary quotes
    // a discount the place-order workflow does not charge and refuses a
    // voucher it accepts.
    const rules = [EXCLUSIVE_DELIVERY, TEN_PERCENT]
    const delivered = api.computeDiscountMeta(
      CART,
      VOUCHER,
      0,
      FEE_ABOVE_COMBINATION,
      true,
      rules,
      {
        isFirstOrder: null,
      },
      false
    )
    expect(delivered.shippingDiscount).toBe(60)
    expect(delivered.automaticDiscount).toBe(0)
    expect(delivered.rawDiscount).toBe(0)

    const collected = api.computeDiscountMeta(
      CART,
      VOUCHER,
      0,
      { shippingPrice: 0 },
      true,
      rules,
      { isFirstOrder: null },
      false
    )
    expect(collected.shippingDiscount).toBe(0)
    expect(collected.automaticDiscount).toBe(25)
    expect(collected.rawDiscount).toBe(20)
  })

  it('binds what a collected order owes to that second pricing, for every store', () => {
    for (const emitted of [source, legacySource()]) {
      expect(emitted).toContain('const NO_SHIPPING_META = { shippingPrice: 0 }')
      expect(emitted).toContain('const pickupDiscountMeta = useMemo(')
      expect(emitted).toContain(
        'const pickupTotal = Math.max(0, roundMoney(cartGoodsTotal - pickupDiscountMeta.goodsDiscount))'
      )
      // The delivery shape still prices with the quoted fee.
      expect(emitted).toContain(
        'roundMoney(cartGoodsTotal + effectiveShippingPrice - discountMeta.goodsDiscount)'
      )
    }
  })

  it("keeps the shopper's discount choice beside the cart and publishes the chooser's rows in both shapes, for every store", () => {
    for (const emitted of [source, engineSource({ discountEngine: undefined })]) {
      expect(emitted).toContain("const DISCOUNT_CHOICE_STORAGE_KEY = 'workflow_discount_choice'")
      expect(emitted).toContain(
        "const DISCOUNT_CHOICE_CHANGED_EVENT = 'teleport:discount-choice-changed'"
      )
      expect(emitted).toContain("const [discountChoice, setDiscountChoice] = useState('')")
      expect(emitted).toContain(
        'window.addEventListener(DISCOUNT_CHOICE_CHANGED_EVENT, syncChoice)'
      )
      expect(emitted).toContain(
        'discountOptions: formatDiscountOptions(discountMeta.discountOptions),'
      )
      expect(emitted).toContain('discountOptionsVisible: discountMeta.discountOptionsVisible,')
      expect(emitted).toContain(
        'discountOptionsPickup: formatDiscountOptions(pickupDiscountMeta.discountOptions),'
      )
      expect(emitted).toContain(
        'discountOptionsVisiblePickup: pickupDiscountMeta.discountOptionsVisible,'
      )
    }
    // The rows as a page binds them: bare money, string flags.
    const format = new Function(
      `${grab(source, 'formatCartMoney')}\n${grab(
        source,
        'formatDiscountOptions'
      )}\nreturn formatDiscountOptions`
    )() as (options: unknown[]) => unknown[]
    expect(
      format([{ key: 'combination', label: 'Ten percent', saving: 25, selected: true }])
    ).toEqual([{ key: 'combination', label: 'Ten percent', saving: '25.00', selected: 'true' }])
  })

  it('publishes what each discount row shows for a collected order as *Pickup twins, for every store', () => {
    // The delivered order is the exclusive rule's alone — a fee worth more than
    // the rest waived, no goods discount, the voucher refused — while the
    // collected one takes the percentage and the voucher, which is what its
    // total is built from.
    const rules = [EXCLUSIVE_DELIVERY, TEN_PERCENT]
    const delivered = api.computeDiscountMeta(
      CART,
      VOUCHER,
      0,
      FEE_ABOVE_COMBINATION,
      true,
      rules,
      { isFirstOrder: null },
      false
    )
    const collected = api.computeDiscountMeta(
      CART,
      VOUCHER,
      0,
      api.noShippingMeta,
      true,
      rules,
      { isFirstOrder: null },
      false
    )
    const cart = liftCartBindings(source, DISCOUNT_KEYS_WITH_TWINS)(delivered, collected)
    expect(cart).toEqual({
      rawDiscount: '0.00',
      voucherFreeShipping: 'false',
      voucherDiscountVisible: 'false',
      automaticDiscount: '0.00',
      automaticDiscountVisible: 'false',
      automaticDiscountLabel: '',
      discountTotal: '0.00',
      rawDiscountPickup: '20.00',
      voucherFreeShippingPickup: 'false',
      voucherDiscountVisiblePickup: 'true',
      automaticDiscountPickup: '25.00',
      automaticDiscountVisiblePickup: 'true',
      automaticDiscountLabelPickup: 'Ten percent',
      discountTotalPickup: '45.00',
    })
    // A store without the rule feed and the settings-less fallback context
    // bind the same keys to the same pricings.
    for (const emitted of [
      legacySource(),
      generateEcommerceContextFileContent({} as UIDLEcommerceSettings),
    ]) {
      expect(liftCartBindings(emitted, DISCOUNT_KEYS_WITH_TWINS)(delivered, collected)).toEqual(
        cart
      )
    }
  })

  it('never reports free shipping on a collected order', () => {
    const FREE_SHIPPING_VOUCHER = {
      ...VOUCHER,
      code: 'FREESHIP',
      discount_type: 'free_shipping',
      discount_value: 0,
    }
    const price = (shippingMeta: { shippingPrice: number }) =>
      api.computeDiscountMeta(
        CART,
        FREE_SHIPPING_VOUCHER,
        0,
        shippingMeta,
        true,
        [],
        { isFirstOrder: null },
        false
      )
    expect(
      liftCartBindings(source, ['voucherFreeShipping', 'voucherFreeShippingPickup'])(
        price(SHIPPING),
        price(api.noShippingMeta)
      )
    ).toEqual({ voucherFreeShipping: 'true', voucherFreeShippingPickup: 'false' })
  })

  it('prices every active row the feed served, never re-judging its window by the browser clock', () => {
    // The data route serves only the rules the DATABASE calls live — the clock
    // that re-prices the order at submit. A browser clock (or a timezone the
    // row's bounds are read in) that disagrees would price a different set of
    // rules than the server charges.
    const rulesMemo = source.slice(
      source.indexOf('const discountRules = useMemo('),
      source.indexOf('}, [discountRows])')
    )
    expect(rulesMemo).toContain(
      "if (!discountRows[i] || discountRows[i].status !== 'active') continue"
    )
    expect(rulesMemo).not.toContain('Date.now()')
    expect(source).not.toContain('starts_at')
    expect(source).not.toContain('ends_at')
  })
})
