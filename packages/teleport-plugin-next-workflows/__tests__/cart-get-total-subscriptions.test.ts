/* tslint:disable:no-eval */
import { cartGetTotal } from '../src/nodes/cart/cart-get-total'

/**
 * `cart-get-total` is what the place-order workflow branches on: a cart
 * holding a subscription opens the provider's checkout in subscription mode,
 * a cart of downloads is charged no delivery. Both facts are read off the
 * flags the add-to-cart node stamps, so a storefront exported before them
 * reads as neither — and a digital-only cart's shipping is zero in every
 * figure the workflow could read it from.
 */

function evalHandler(code: string): any {
  return eval('(' + code + ')')
}

function mount(storage: Record<string, unknown>, fields: Record<string, string> = {}): void {
  const store: Record<string, string> = {}
  for (const key of Object.keys(storage)) {
    store[key] = JSON.stringify(storage[key])
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

const runHandler = async () => evalHandler(cartGetTotal.generateHandler())()

const DELIVERY = {
  deliveryPrice: 10,
  freeDeliveryEnabled: false,
  freeDeliveryThreshold: 0,
  deliveryEnabled: true,
  storePickupEnabled: true,
}

describe('cart-get-total — subscriptions and digital delivery', () => {
  it('reports neither on a cart written before the flags existed', async () => {
    mount({ workflow_cart: [{ price: 100, quantity: 1 }] })
    const out = await runHandler()
    expect(out.hasRecurringLines).toBe(false)
    expect(out.isDigitalOnly).toBe(false)
  })

  it('reports a subscription however its flag is spelled', async () => {
    mount({ workflow_cart: [{ price: 12, quantity: 1, isRecurring: 't', isDigital: true }] })
    const out = await runHandler()
    expect(out.hasRecurringLines).toBe(true)
    expect(out.isDigitalOnly).toBe(true)
  })

  it('calls a cart digital-only when every line is, and never an empty one', async () => {
    mount({
      workflow_cart: [
        { price: 20, quantity: 1, isDigital: true },
        { price: 30, quantity: 2, isDigital: false },
      ],
    })
    expect((await runHandler()).isDigitalOnly).toBe(false)
    mount({ workflow_cart: [] })
    expect((await runHandler()).isDigitalOnly).toBe(false)
  })

  it('charges a digital-only cart no delivery when it prices the discounts', async () => {
    mount({
      workflow_cart: [{ id: 'l1', productId: 'p1', price: 100, quantity: 1, isDigital: true }],
      workflow_cart_settings: {
        deliveryConfig: DELIVERY,
        discounts: { enabled: true, automaticDiscounts: false, rows: [] },
      },
    })
    const out = await runHandler()
    // The amount the buyer was shown: goods only, no fee to waive.
    expect(out.displayedAmountDue).toBe(100)
    expect(out.discounts.shippingDiscount).toBe(0)

    mount({
      workflow_cart: [{ id: 'l1', productId: 'p1', price: 100, quantity: 1, isDigital: false }],
      workflow_cart_settings: {
        deliveryConfig: DELIVERY,
        discounts: { enabled: true, automaticDiscounts: false, rows: [] },
      },
    })
    expect((await runHandler()).displayedAmountDue).toBe(110)
  })

  it('zeroes the zone fee of a digital-only cart on a store with shipping zones', async () => {
    const regional = {
      currency: 'EUR',
      countryCodes: { germany: 'DE' },
      store: {
        countryCode: 'DE',
        deliveryEnabled: true,
        storePickupEnabled: true,
        deliveryPrice: 5,
        freeDeliveryEnabled: false,
        freeDeliveryThreshold: 0,
        defaultTaxRate: 0,
        defaultTaxIncluded: false,
      },
      rows: {
        zones: [{ id: 'z1', name: 'Germany', countries: 'DE', cod_enabled: 't', is_active: 't' }],
        rates: [{ id: 'r1', zone_id: 'z1', name: 'Standard', rate_type: 'flat', price: '10.00' }],
        taxRates: [],
      },
    }
    const address = { billingCountry: 'Germany', state: '' }
    mount(
      {
        workflow_cart: [{ id: 'l1', productId: 'p1', price: 100, quantity: 1, isDigital: true }],
        workflow_cart_settings: { regional },
      },
      address
    )
    const out = await runHandler()
    expect(out.isDigitalOnly).toBe(true)
    expect(out.regional).toMatchObject({
      status: 'ok',
      zoneName: 'Germany',
      shippingNet: 0,
      shippingTax: 0,
      shippingGross: 0,
    })

    mount(
      {
        workflow_cart: [{ id: 'l1', productId: 'p1', price: 100, quantity: 1 }],
        workflow_cart_settings: { regional },
      },
      address
    )
    expect((await runHandler()).regional.shippingGross).toBe(10)
  })

  it("lets a gift card pay the subscription's first charge, never below the provider minimum", async () => {
    mount({
      workflow_cart: [{ id: 'l1', productId: 'sub', price: 50, quantity: 1, isRecurring: true }],
      workflow_cart_settings: {
        deliveryConfig: DELIVERY,
        giftCards: { enabled: true, currency: 'EUR', recurringTender: true },
      },
      workflow_gift_card: { id: 'gc', last4: 'ABCD', balance: 100, currency: 'EUR' },
    })
    const out = await runHandler()
    expect(out.hasRecurringLines).toBe(true)
    expect(out.giftCard).toEqual({
      id: 'gc',
      last4: 'ABCD',
      balance: 100,
      amount: 59.5,
      amountDue: 0.5,
    })
    expect(out.displayedAmountDue).toBe(0.5)
  })

  it('lets no gift card pay for a subscription on a checkout built before the first charge could be reduced', async () => {
    mount({
      workflow_cart: [{ id: 'l1', productId: 'sub', price: 50, quantity: 1, isRecurring: true }],
      workflow_cart_settings: {
        deliveryConfig: DELIVERY,
        giftCards: { enabled: true, currency: 'EUR' },
      },
      workflow_gift_card: { id: 'gc', last4: 'ABCD', balance: 100, currency: 'EUR' },
    })
    const out = await runHandler()
    expect(out.giftCard).toBeNull()
    expect(out.displayedAmountDue).toBe(60)
  })

  it('lets no gift card pay for a subscription that starts with a free trial', async () => {
    mount({
      workflow_cart: [
        { id: 'l1', productId: 'sub', price: 50, quantity: 1, isRecurring: true, trialDays: 14 },
      ],
      workflow_cart_settings: {
        deliveryConfig: DELIVERY,
        giftCards: { enabled: true, currency: 'EUR' },
      },
      workflow_gift_card: { id: 'gc', last4: 'ABCD', balance: 100, currency: 'EUR' },
    })
    const out = await runHandler()
    expect(out.giftCard).toBeNull()
    expect(out.displayedAmountDue).toBe(60)
  })

  it('hands the place-order script the providers that can bill a subscription', async () => {
    // Read from the mirror the storefront wrote at export, so a provider the
    // merchant enabled after the checkout page was built still counts there.
    mount({
      workflow_cart: [{ id: 'l1', productId: 'sub', price: 50, quantity: 1, isRecurring: true }],
      workflow_cart_settings: {
        deliveryConfig: DELIVERY,
        subscriptions: { enabled: true, providers: ['stripe', 'paypal'] },
      },
    })
    expect((await runHandler()).subscriptions).toEqual({
      enabled: true,
      providers: ['stripe', 'paypal'],
    })
  })

  it('adds no subscriptions key for a storefront that never mirrored one', async () => {
    mount({
      workflow_cart: [{ id: 'l1', productId: 'p1', price: 100, quantity: 1 }],
      workflow_cart_settings: { deliveryConfig: DELIVERY },
    })
    expect('subscriptions' in (await runHandler())).toBe(false)
  })
})
