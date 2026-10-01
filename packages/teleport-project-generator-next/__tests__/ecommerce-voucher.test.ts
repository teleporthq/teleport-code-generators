/* tslint:disable:no-eval function-constructor */
import { generateEcommerceContextFileContent } from '../src/ecommerce/ecommerce-context-generator'
import { buildWorkflowEcommerceSettingsPayload } from '../src/ecommerce/ecommerce-api-routes-generator'
import { UIDLEcommerceSettings } from '@teleporthq/teleport-types'
import { DiscountEngine } from '@teleporthq/teleport-shared'

/**
 * The published storefront's half of the voucher rule.
 *
 * Vouchers are priced by the shared discount engine — the same `__de` helpers
 * the checkout workflows bake in and the editor mirrors, pinned to the cent by
 * teleport-shared's parity table. What this pins is the provider's PROJECTION
 * of the engine's result (`computeDiscountMeta`): a store built before the
 * engine prices in legacy mode, and the numbers it shows must be exactly what
 * the flat voucher rule always showed — by running the emitted function rather
 * than matching substrings of it.
 *
 * The invariant: a discount is taken on the GROSS eligible subtotal, clamped so
 * an order can reach zero but never go below it, and a free-shipping voucher
 * touches only the delivery fee.
 */

const baseSettings = (overrides: Partial<UIDLEcommerceSettings>): UIDLEcommerceSettings =>
  ({
    cashOnDelivery: true,
    deliveryEnabled: true,
    storePickupEnabled: false,
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
  } as any)

interface VoucherMeta {
  rawDiscount: number
  goodsDiscount: number
  shippingDiscount: number
  automaticDiscount: number
  automaticDiscountVisible: string
  voucherApplied: string
  voucherCode: string
  voucherFreeShipping: string
  voucherDiscountVisible: string
}

interface CartLine {
  productId: string
  price: number
  quantity: number
}

/**
 * Lifts the emitted projection out of the provider and makes it callable the
 * way the legacy-mode memo calls it: no automatic rules, no shopper context.
 */
function evalVoucherMath(
  source: string
): (
  cartItems: CartLine[],
  voucher: Record<string, unknown> | null,
  taxRatePercent: number,
  shippingMeta: { shippingPrice: number },
  vouchersEnabled: boolean
) => VoucherMeta {
  const grab = (name: string): string => {
    const start = source.indexOf(`function ${name}(`)
    if (start === -1) {
      throw new Error(`emitted provider is missing function ${name}`)
    }
    const end = source.indexOf('\n}', start)
    return source.slice(start, end + 2)
  }
  const constant = (name: string): string => {
    const start = source.indexOf(`const ${name} = `)
    if (start === -1) {
      throw new Error(`emitted provider is missing const ${name}`)
    }
    return source.slice(start, source.indexOf('\n', start))
  }
  const computeDiscountMeta = new Function(
    [
      DiscountEngine.generateDiscountEngineHelperCode(),
      constant('NO_DISCOUNT_CUSTOMER'),
      grab('computeDiscountMeta'),
      'return computeDiscountMeta',
    ].join('\n')
  )()
  return (cartItems, voucher, taxRatePercent, shippingMeta, vouchersEnabled) =>
    computeDiscountMeta(
      cartItems,
      voucher,
      taxRatePercent,
      shippingMeta,
      vouchersEnabled,
      [],
      { isFirstOrder: null },
      true
    )
}

const CART: CartLine[] = [
  { productId: 'p1', price: 100, quantity: 2 },
  { productId: 'p2', price: 50, quantity: 1 },
]

const PERCENTAGE = {
  id: 'v1',
  code: 'SAVE10',
  discount_type: 'percentage',
  discount_value: 10,
  applies_to_all_products: true,
}

const FIXED = { ...PERCENTAGE, code: 'TAKE20', discount_type: 'fixed', discount_value: 20 }

const FREE_SHIPPING = {
  ...PERCENTAGE,
  code: 'FREESHIP',
  discount_type: 'free_shipping',
  discount_value: 0,
}

const RESTRICTED = {
  ...PERCENTAGE,
  code: 'LAMPONLY',
  discount_value: 50,
  applies_to_all_products: false,
  product_ids: ['p2'],
}

describe('EcommerceProvider — voucher discount', () => {
  const computeVoucherMeta = evalVoucherMath(
    generateEcommerceContextFileContent(baseSettings({}), undefined, 'ds-1')
  )
  const shipping = { shippingPrice: 10 }

  it('reports nothing when no voucher is applied', () => {
    const meta = computeVoucherMeta(CART, null, 0, shipping, true)
    expect(meta.rawDiscount).toBe(0)
    expect(meta.voucherApplied).toBe('false')
    expect(meta.voucherDiscountVisible).toBe('false')
  })

  it('takes a percentage off the whole cart', () => {
    const meta = computeVoucherMeta(CART, PERCENTAGE, 0, shipping, true)
    expect(meta.rawDiscount).toBe(25)
    expect(meta.voucherApplied).toBe('true')
    expect(meta.voucherCode).toBe('SAVE10')
    expect(meta.voucherDiscountVisible).toBe('true')
  })

  it('computes the percentage on the GROSS subtotal when tax is added on top', () => {
    // Per-unit gross rounding: round(19.99 * 1.19) = 23.79, × 3 = 71.37.
    const meta = computeVoucherMeta(
      [{ productId: 'p1', price: 19.99, quantity: 3 }],
      PERCENTAGE,
      19,
      shipping,
      true
    )
    expect(meta.rawDiscount).toBe(7.14)
  })

  it('takes a fixed amount off', () => {
    expect(computeVoucherMeta(CART, FIXED, 0, shipping, true).rawDiscount).toBe(20)
  })

  it('clamps a fixed amount larger than the cart instead of going negative', () => {
    const meta = computeVoucherMeta(CART, { ...FIXED, discount_value: 100000 }, 0, shipping, true)
    expect(meta.rawDiscount).toBe(250)
  })

  it('discounts only the eligible products for a restricted voucher', () => {
    const meta = computeVoucherMeta(CART, RESTRICTED, 0, shipping, true)
    expect(meta.rawDiscount).toBe(25)
  })

  it('shows a restricted voucher as applied but invisible when it matches nothing', () => {
    const meta = computeVoucherMeta(
      CART,
      { ...RESTRICTED, product_ids: ['nothing-here'] },
      0,
      shipping,
      true
    )
    expect(meta.voucherApplied).toBe('true')
    expect(meta.rawDiscount).toBe(0)
    // The summary row hides rather than printing a £0.00 discount line.
    expect(meta.voucherDiscountVisible).toBe('false')
  })

  it('treats a free-shipping voucher as waived delivery, not a goods discount', () => {
    const meta = computeVoucherMeta(CART, FREE_SHIPPING, 0, shipping, true)
    // Double-subtracting is the bug this guards: the waiver must reach the total
    // through the zeroed shipping price, never also through rawDiscount.
    expect(meta.rawDiscount).toBe(0)
    expect(meta.voucherFreeShipping).toBe('true')
    expect(meta.voucherDiscountVisible).toBe('false')
  })

  it('reports a free-shipping voucher as inert when delivery is already free', () => {
    const meta = computeVoucherMeta(CART, FREE_SHIPPING, 0, { shippingPrice: 0 }, true)
    expect(meta.voucherFreeShipping).toBe('false')
  })

  it('ignores a stored voucher entirely once the merchant turns the feature off', () => {
    // A shopper can have a voucher in localStorage from before the toggle was
    // switched off; hiding the input alone would keep discounting their order.
    const meta = computeVoucherMeta(CART, PERCENTAGE, 0, shipping, false)
    expect(meta.rawDiscount).toBe(0)
    expect(meta.voucherApplied).toBe('false')
  })

  it('ignores lines with a zero or malformed quantity', () => {
    const meta = computeVoucherMeta(
      [
        { productId: 'p1', price: 100, quantity: 0 },
        { productId: 'p3', price: 20, quantity: 1 },
      ],
      PERCENTAGE,
      0,
      shipping,
      true
    )
    expect(meta.rawDiscount).toBe(2)
  })

  it('reports no automatic discount in legacy mode, whatever the voucher did', () => {
    // A checkout built before the engine has no automatic-discount row and no
    // rule feed; the projection must say so rather than leave the key absent.
    const meta = computeVoucherMeta(CART, PERCENTAGE, 0, shipping, true)
    expect(meta.automaticDiscount).toBe(0)
    expect(meta.automaticDiscountVisible).toBe('false')
    expect(meta.goodsDiscount).toBe(25)
    expect(meta.shippingDiscount).toBe(0)
  })

  it('folds a free-shipping voucher into shippingDiscount, the figure the totals net off', () => {
    const meta = computeVoucherMeta(CART, FREE_SHIPPING, 0, shipping, true)
    expect(meta.shippingDiscount).toBe(10)
    expect(meta.goodsDiscount).toBe(0)
  })
})

describe('EcommerceProvider — voucher plumbing', () => {
  it('publishes vouchersEnabled to the workflow settings payload', () => {
    // This is the only channel by which the standalone cart-get-total handler
    // learns whether a stored voucher should be honoured at all.
    expect(buildWorkflowEcommerceSettingsPayload(baseSettings({})).vouchersEnabled).toBe(true)
    expect(
      buildWorkflowEcommerceSettingsPayload(baseSettings({ vouchersEnabled: false } as never))
        .vouchersEnabled
    ).toBe(false)
    // A storefront exported before vouchers existed has no flag at all, and
    // must read as off rather than undefined.
    const legacy = baseSettings({})
    delete (legacy as unknown as Record<string, unknown>).vouchersEnabled
    expect(buildWorkflowEcommerceSettingsPayload(legacy).vouchersEnabled).toBe(false)
  })

  it('re-reads the voucher on the same signals as the cart', () => {
    const source = generateEcommerceContextFileContent(baseSettings({}), undefined, 'ds-1')
    expect(source).toContain("window.addEventListener('teleport:voucher-changed'")
    expect(source).toContain("window.removeEventListener('teleport:voucher-changed'")
    // Another tab clearing the voucher has to reach this one too.
    expect(source).toContain('if (e.key === VOUCHER_STORAGE_KEY)')
  })

  it('exposes the checkout bindings the summary rows are built from', () => {
    const source = generateEcommerceContextFileContent(baseSettings({}), undefined, 'ds-1')
    for (const binding of [
      'rawDiscount:',
      'rawSubtotalAfterDiscount:',
      'voucherApplied:',
      'voucherCode:',
      'voucherFreeShipping:',
      'voucherDiscountVisible:',
    ]) {
      expect(source).toContain(binding)
    }
  })

  it('puts vouchersEnabled on the Settings object the checkout page gates on', () => {
    // `buildSettingsObject` IS `E-commerce.Settings` on the storefront. The
    // generated checkout reads
    // `ecommerce?.['Settings']?.['vouchersEnabled']?.toString() === 'true'`, so
    // omitting the key hid the whole voucher block on every published store —
    // and, because the provider also gates `computeVoucherMeta` on it, silently
    // zeroed the discount. The workflow payload carrying the flag is NOT enough:
    // it is a different object.
    const on = generateEcommerceContextFileContent(baseSettings({}), undefined, 'ds-1')
    expect(on).toContain('"vouchersEnabled":true')

    const off = generateEcommerceContextFileContent(
      baseSettings({ vouchersEnabled: false } as never),
      undefined,
      'ds-1'
    )
    expect(off).toContain('"vouchersEnabled":false')

    // A document exported before the flag existed reads as off, never undefined.
    const legacy = baseSettings({})
    delete (legacy as unknown as Record<string, unknown>).vouchersEnabled
    expect(generateEcommerceContextFileContent(legacy, undefined, 'ds-1')).toContain(
      '"vouchersEnabled":false'
    )
  })

  it('prices the discount off the baked tax rate, not off a settings key that does not exist', () => {
    // `settings` carries no `storefrontTaxRate`, so reading it there handed
    // `computeVoucherMeta` a rate of 0 — discounting a NET subtotal while the
    // place-order workflow discounted the GROSS one.
    const source = generateEcommerceContextFileContent(baseSettings({}), undefined, 'ds-1')
    expect(source).toContain('        STOREFRONT_TAX_RATE,\n        shippingMeta,')
    expect(source).not.toContain('settings.storefrontTaxRate')
  })

  it('re-renders consumers when the voucher changes', () => {
    // The context `value` memo is what every page reads. `discountMeta` is the
    // only thing that moves when a code is applied or removed — leaving it out
    // of the dep array returned the previous object, so the order summary only
    // caught up on a full page reload.
    const source = generateEcommerceContextFileContent(baseSettings({}), undefined, 'ds-1')
    const depsAt = source.lastIndexOf('}), [displayCartItems')
    expect(depsAt).toBeGreaterThan(-1)
    const deps = source.slice(depsAt, source.indexOf('])', depsAt))
    expect(deps).toContain('discountMeta')
    expect(deps).toContain('effectiveShippingPrice')
    expect(deps).toContain('effectiveTotal')
  })

  it('formats every summary amount, so the storefront reads like the canvas', () => {
    // A bound text node prints what it is given. Left raw, a 12.5 discount
    // rendered "12.5" beside per-line prices that said "12.50".
    const source = generateEcommerceContextFileContent(baseSettings({}), undefined, 'ds-1')
    for (const binding of [
      'rawSubtotal: formatCartMoney(',
      'rawTotal: formatCartMoney(',
      'rawSubtotalAfterDiscount: formatCartMoney(',
      'rawShipping: formatCartMoney(',
      'rawDiscount: formatCartMoney(',
    ]) {
      expect(source).toContain(binding)
    }
  })

  it('emits a provider whose voucher helpers actually parse', () => {
    // `evalVoucherMath` above compiles the lifted helpers, so a syntax error
    // inside them fails loudly here rather than at `next build` time in a
    // generated project.
    expect(() =>
      evalVoucherMath(generateEcommerceContextFileContent(baseSettings({}), undefined, 'ds-1'))
    ).not.toThrow()
  })
})
