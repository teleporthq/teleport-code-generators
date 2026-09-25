/* tslint:disable:function-constructor */
import { UIDLEcommerceSettings } from '@teleporthq/teleport-types'
import { DiscountEngine } from '@teleporthq/teleport-shared'
import { generateEcommerceContextFileContent } from '../src/ecommerce/ecommerce-context-generator'

/**
 * The storefront provider's half of subscriptions and digital delivery: what
 * the checkout's gates read off `Cart` (`hasRecurringLines`, `isDigitalOnly`),
 * the sentence its summary prints (`recurringSummary`), the per-cycle charge
 * (`recurringAmount`), the providers a recurring cart is offered
 * (`subscriptionPaymentProviders`) and the two `Settings` flags the product
 * surfaces gate on. The words are pinned by a parity table the editor's copy
 * runs too — run, not pattern-matched.
 *
 * ⚠️ `SUMMARY_FIXTURES` IS SHARED. It is byte-identical to the table in
 * teleport-gui's `features/e-commerce/utils/__tests__/recurring-summary-parity.spec.ts`,
 * which runs it against the canvas simulator's copy. Two specs, one table.
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
    paymentProviders: [
      { type: 'stripe', name: 'Stripe', supportsSubscriptions: true },
      { type: 'paypal', name: 'PayPal', supportsSubscriptions: true },
      { type: 'mollie', name: 'Mollie' },
    ],
    vouchersEnabled: true,
    ...overrides,
  } as UIDLEcommerceSettings)

const emit = (overrides: Partial<UIDLEcommerceSettings> = {}): string =>
  generateEcommerceContextFileContent(
    baseSettings(overrides),
    undefined,
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

/** SHARED PARITY TABLE — keep byte-identical with the GUI spec. */
const SUMMARY_FIXTURES: Array<{
  interval: unknown
  count: unknown
  trialDays: unknown
  period: string
  summary: string
}> = [
  {
    interval: 'month',
    count: 1,
    trialDays: null,
    period: 'month',
    summary: 'Billed every month · first charge today',
  },
  {
    interval: 'month',
    count: 3,
    trialDays: null,
    period: '3 months',
    summary: 'Billed every 3 months · first charge today',
  },
  {
    interval: 'year',
    count: 1,
    trialDays: 14,
    period: 'year',
    summary: 'Billed every year · free for 14 days, then every year',
  },
  {
    interval: 'week',
    count: 2,
    trialDays: 1,
    period: '2 weeks',
    summary: 'Billed every 2 weeks · free for 1 day, then every 2 weeks',
  },
  {
    interval: ' DAY ',
    count: '7',
    trialDays: '0',
    period: '7 days',
    summary: 'Billed every 7 days · first charge today',
  },
  {
    interval: 'fortnight',
    count: 0,
    trialDays: -3,
    period: 'month',
    summary: 'Billed every month · first charge today',
  },
  {
    interval: null,
    count: null,
    trialDays: undefined,
    period: 'month',
    summary: 'Billed every month · first charge today',
  },
]

interface SubscriptionApi {
  period: (interval: unknown, count: unknown) => string
  summary: (line: Record<string, unknown>) => string
  recurringLine: (items: unknown[]) => Record<string, unknown> | null
  digitalOnly: (items: unknown[]) => boolean
  shippingMeta: (goodsTotal: number) => Record<string, unknown>
}

const loadApi = (): SubscriptionApi => {
  const source = emit()
  return new Function(
    [
      DiscountEngine.generateDiscountEngineHelperCode(),
      grab(source, 'roundMoney'),
      "const TQ_BILLING_INTERVALS = ['day', 'week', 'month', 'year']",
      grab(source, 'tqIsRecurringProduct'),
      grab(source, 'tqNormalizeBillingInterval'),
      grab(source, 'tqNormalizeBillingIntervalCount'),
      grab(source, 'tqPositiveCount'),
      grab(source, 'formatBillingPeriod'),
      grab(source, 'cartRecurringLine'),
      grab(source, 'cartRecurringSummary'),
      grab(source, 'isDigitalOnlyCart'),
      grab(source, 'digitalOnlyShippingMeta'),
      'return { period: formatBillingPeriod, summary: cartRecurringSummary, recurringLine: cartRecurringLine, digitalOnly: isDigitalOnlyCart, shippingMeta: digitalOnlyShippingMeta };',
    ].join('\n')
  )()
}

describe('EcommerceProvider — the words a subscription is described with', () => {
  const api = loadApi()

  it.each(SUMMARY_FIXTURES)(
    'bills $interval × $count with $trialDays trial days as "$summary"',
    ({ interval, count, trialDays, period, summary }) => {
      expect(api.period(interval, count)).toBe(period)
      expect(
        api.summary({ recurringInterval: interval, recurringIntervalCount: count, trialDays })
      ).toBe(summary)
    }
  )

  it('finds the one subscription in the basket, however the flag is spelled', () => {
    const line = { productId: 'sub', isRecurring: 't' }
    expect(api.recurringLine([{ isRecurring: false }, line])).toBe(line)
    expect(api.recurringLine([{ isRecurring: false }, {}, null])).toBeNull()
    expect(api.recurringLine([])).toBeNull()
  })

  it('calls a cart digital-only when every line is a download or a gift card, and never an empty one', () => {
    expect(api.digitalOnly([{ isDigital: true }, { isDigital: 'true' }])).toBe(true)
    expect(api.digitalOnly([{ isGiftCard: true }, { isGiftCard: 't' }])).toBe(true)
    expect(api.digitalOnly([{ isDigital: true }, { isDigital: false }])).toBe(false)
    expect(api.digitalOnly([{ isGiftCard: true }, {}])).toBe(false)
    expect(api.digitalOnly([{ isDigital: true }, {}])).toBe(false)
    expect(api.digitalOnly([])).toBe(false)
  })

  it('prices a cart of downloads with no shipping at all', () => {
    expect(api.shippingMeta(45.5)).toEqual({
      shippingIsFree: true,
      shippingPrice: 0,
      totalWithShipping: 45.5,
      freeDeliveryProgress: '100%',
      freeDeliveryRemaining: 0,
    })
  })
})

describe('EcommerceProvider — what the pages bind', () => {
  const source = emit()

  it('tells the checkout about a gift card in the basket and a free trial ahead', () => {
    expect(source).toContain("hasGiftCardLines: hasGiftCardLines ? 'true' : 'false',")
    expect(source).toContain("hasRecurringTrial: recurringTrial ? 'true' : 'false',")
    expect(source).toContain(
      'const recurringTrial = recurringLine !== null && tqPositiveCount(recurringLine.trialDays) !== null'
    )
    expect(source).toContain(
      'const hasGiftCardLines = useMemo(() => cartHasGiftCardLine(cartItems), [cartItems])'
    )
  })

  it('publishes the four Cart keys and the two Settings flags', () => {
    expect(source).toContain("hasRecurringLines: recurringLine ? 'true' : 'false',")
    expect(source).toContain("isDigitalOnly: digitalOnly ? 'true' : 'false',")
    expect(source).toContain(
      "recurringSummary: recurringLine ? cartRecurringSummary(recurringLine) : '',"
    )
    expect(source).toContain('recurringAmount: formatCartMoney(effectiveTotal),')
    expect(source).toContain('"subscriptionsEnabled":false')
    expect(source).toContain('"digitalProductsEnabled":false')
    expect(
      emit({ subscriptions: { enabled: true, providers: ['stripe'], currency: 'EUR' } })
    ).toContain('"subscriptionsEnabled":true')
    expect(
      emit({
        digitalProducts: {
          enabled: true,
          withdrawalExemption: false,
          revokeOnRefund: true,
        },
      })
    ).toContain('"digitalProductsEnabled":true')
  })

  it('bakes only the providers that can bill a subscription, and mirrors them for the workflows', () => {
    expect(source).toContain(
      'const subscriptionPaymentProviders = useMemo(() => ([{"type":"stripe","name":"Stripe","supportsSubscriptions":true},{"type":"paypal","name":"PayPal","supportsSubscriptions":true}]), [])'
    )
    expect(source).toContain('subscriptions: {"enabled":false,"providers":["stripe","paypal"]},')
    expect(source).toContain('    subscriptionPaymentProviders,\n')
    // A store exported before the capability reads every provider as unable.
    const legacy = emit({ paymentProviders: [{ type: 'stripe', name: 'Stripe' }] })
    expect(legacy).toContain('const subscriptionPaymentProviders = useMemo(() => ([]), [])')
  })

  it('sets the shipping quote aside for a digital-only cart, in both pricing shapes', () => {
    expect(source).toContain('digitalOnly ? null : settings.Delivery,')
    const regional = emit({
      regionalPricing: {
        enabled: true,
        countryCodes: ['DE'],
        currency: 'EUR',
        store: {
          countryCode: 'DE',
          deliveryEnabled: true,
          storePickupEnabled: true,
          deliveryPrice: 5,
          freeDeliveryEnabled: false,
          freeDeliveryThreshold: 0,
          defaultTaxRate: 19,
          defaultTaxIncluded: false,
        },
      } as unknown as UIDLEcommerceSettings['regionalPricing'],
    })
    expect(regional).toContain(
      'digitalOnly ? digitalOnlyShippingMeta(regionalQuote.goodsGross) : regionalShippingMeta(regionalQuote),'
    )
  })

  it('stamps the billing schedule and the delivery kind onto every hydrated line', () => {
    expect(source).toContain('isRecurring: tqIsRecurringProduct(product),')
    expect(source).toContain('isDigital: __deBool(product.is_digital, false),')
    expect(source).toContain('quantity: tqIsRecurringProduct(product) ? 1 : item.quantity,')
    expect(source).toContain("isRecurring: __deBool(item.isRecurring, false) ? 'true' : 'false',")
    expect(source).toContain("isDigital: __deBool(item.isDigital, false) ? 'true' : 'false',")
  })
})

describe('EcommerceProvider — hydration of a subscription line', () => {
  const loadEnrich = (rows: unknown[]): ((items: unknown[]) => Promise<unknown[]>) => {
    const source = emit()
    const start = source.indexOf('function __pdRound2')
    const end = source.indexOf('function saveCartToStorage')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    return new Function(
      'rows',
      `
      const PRODUCTS_DATA_SOURCE_ID = 'ds-1'
      const fetch = async () => ({ ok: true, json: async () => ({ rows }) })
      ${source.slice(start, end)}
      return enrichCartItems
      `
    )(rows) as (items: unknown[]) => Promise<unknown[]>
  }

  it('re-reads the schedule off the product and keeps the line at one unit', async () => {
    const enrich = loadEnrich([
      {
        id: 'sub',
        name: 'Pro plan',
        price: 12,
        payment_type: 'recurring',
        recurring_interval: 'Month',
        recurring_interval_count: '3',
        trial_days: 14,
        is_digital: 't',
      },
    ])
    const [line] = await enrich([{ productId: 'sub', quantity: 4 }])
    expect(line).toMatchObject({
      isRecurring: true,
      recurringInterval: 'month',
      recurringIntervalCount: 3,
      trialDays: 14,
      isDigital: true,
      quantity: 1,
    })
  })

  it('reads a one-time physical product as neither', async () => {
    const enrich = loadEnrich([{ id: 'p1', name: 'Mug', price: 8, payment_type: 'one_time' }])
    const [line] = await enrich([{ productId: 'p1', quantity: 2 }])
    expect(line).toMatchObject({
      isRecurring: false,
      recurringInterval: null,
      recurringIntervalCount: null,
      trialDays: null,
      isDigital: false,
      quantity: 2,
    })
  })
})

describe('EcommerceProvider — one kind of line per cart', () => {
  interface KindApi {
    refusal: (
      items: unknown[],
      item: Record<string, unknown>
    ) => { added: boolean; reason: string; message: string } | null
  }

  // `addToCart` answers the same verdict and wording as the add-to-cart
  // workflow node, so a custom caller is told what the storefront button says.
  const loadKinds = (): KindApi => {
    const source = emit()
    return new Function(
      [
        DiscountEngine.generateDiscountEngineHelperCode(),
        grab(source, 'tqCartLineKind'),
        "const TQ_CART_KIND_LABELS = { subscription: 'Subscriptions', 'gift-card': 'Gift cards', digital: 'Digital products', physical: 'Physical products' }",
        grab(source, 'tqCartKindRefusal'),
        'return { refusal: tqCartKindRefusal };',
      ].join('\n')
    )()
  }

  it('lets a line join an empty cart or a cart of its own kind', () => {
    const api = loadKinds()
    expect(api.refusal([], { productId: 'a', isDigital: true })).toBeNull()
    expect(
      api.refusal([{ productId: 'a', isDigital: true }], { productId: 'b', isDigital: 'true' })
    ).toBeNull()
    expect(api.refusal([{ productId: 'a' }], { productId: 'a', quantity: 2 })).toBeNull()
  })

  it('names the kind that needs its own order', () => {
    const api = loadKinds()
    expect(api.refusal([{ productId: 'mug' }], { productId: 'ebook', isDigital: true })).toEqual({
      added: false,
      reason: 'mixed-cart',
      message:
        'Digital products need a separate order. Complete your current order or remove the other items from your cart first.',
    })
    expect(
      api.refusal([{ productId: 'ebook', isDigital: true }], { productId: 'mug' })?.message
    ).toMatch(/^Physical products need a separate order\./)
  })

  it('keeps gift cards on their own order', () => {
    const api = loadKinds()
    expect(api.refusal([{ productId: 'mug' }], { productId: 'card', isGiftCard: true })).toEqual({
      added: false,
      reason: 'mixed-cart',
      message:
        'Gift cards need a separate order. Complete your current order or remove the other items from your cart first.',
    })
    expect(
      api.refusal([{ productId: 'card', isGiftCard: 't' }], { productId: 'ebook', isDigital: true })
        ?.message
    ).toMatch(/^Digital products need a separate order\./)
    expect(
      api.refusal([{ productId: 'card', isGiftCard: true }], {
        productId: 'card-100',
        isGiftCard: 'true',
      })
    ).toBeNull()
  })

  it('keeps a subscription alone, and never doubles it', () => {
    const api = loadKinds()
    const alone = {
      added: false,
      reason: 'one-subscription',
      message:
        'Subscriptions are checked out on their own. Finish or empty your current cart first.',
    }
    expect(api.refusal([{ productId: 'mug' }], { productId: 'plan', isRecurring: true })).toEqual(
      alone
    )
    expect(api.refusal([{ productId: 'plan', isRecurring: true }], { productId: 'mug' })).toEqual(
      alone
    )
    expect(
      api.refusal([{ productId: 'plan', isRecurring: true }], {
        productId: 'plan',
        isRecurring: true,
      })
    ).toEqual(alone)
  })
})
