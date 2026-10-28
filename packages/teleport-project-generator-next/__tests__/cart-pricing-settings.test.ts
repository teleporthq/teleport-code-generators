import { buildCartPricingSettings } from '../src/ecommerce/cart-pricing-settings'

// The server pricing snapshot (`utils/ecommerce/cart-pricing-settings.js`) is
// what the checkout's server step trusts. It names how a buyer may pay, so an
// order the store cannot collect is refused on the server, never defaulted.
describe('cart pricing settings: payment methods', () => {
  const settings = (fields: Record<string, unknown>) =>
    ({
      cashOnDelivery: false,
      deliveryEnabled: true,
      storePickupEnabled: false,
      guestCheckout: true,
      stockManagement: false,
      orderNotifications: false,
      deliveryConfig: null,
      stockManagementConfig: null,
      orderNotificationConfig: null,
      paymentProviders: [],
      ...fields,
    } as any)

  it('names the enabled providers and no cash on delivery for a prepaid-only store', () => {
    const snapshot = buildCartPricingSettings(
      settings({
        paymentProviders: [
          { type: 'stripe', name: 'Stripe', supportsSubscriptions: true },
          { type: 'paypal', name: 'PayPal', supportsSubscriptions: false },
        ],
      }),
      undefined,
      'ds-1',
      'postgresql'
    )
    expect(snapshot.paymentMethods).toEqual({
      cashOnDelivery: false,
      providers: ['stripe', 'paypal'],
      codByShippingZone: false,
    })
  })

  it('takes cash on delivery only when the store setting is on', () => {
    expect(
      buildCartPricingSettings(settings({ cashOnDelivery: true }), undefined, 'ds-1', 'postgresql')
        .paymentMethods
    ).toEqual({ cashOnDelivery: true, providers: [], codByShippingZone: false })
    expect(
      buildCartPricingSettings(
        settings({ cashOnDelivery: 'true' }),
        undefined,
        'ds-1',
        'postgresql'
      ).paymentMethods.cashOnDelivery
    ).toBe(false)
  })

  it('says cash on delivery is decided per shipping zone when delivery is priced by zone', () => {
    const regionalPricing = {
      enabled: true,
      currency: 'EUR',
      countryCodes: {},
      storeCountryCode: 'RO',
    }
    expect(
      buildCartPricingSettings(
        settings({ cashOnDelivery: true, regionalPricing }),
        undefined,
        'ds-1',
        'postgresql'
      ).paymentMethods.codByShippingZone
    ).toBe(true)
    expect(
      buildCartPricingSettings(
        settings({ cashOnDelivery: true, regionalPricing: { ...regionalPricing, enabled: false } }),
        undefined,
        'ds-1',
        'postgresql'
      ).paymentMethods.codByShippingZone
    ).toBe(false)
  })

  it('releases stalled stock reservations exactly where the checkout reserves stock', () => {
    const snapshot = (fields: Record<string, unknown>) =>
      buildCartPricingSettings(settings(fields), undefined, 'ds-1', 'postgresql')
        .releaseStalledReservations
    expect(
      snapshot({ stockManagement: true, stockManagementConfig: { allowBackorders: false } })
    ).toBe(true)
    expect(snapshot({ stockManagement: true, stockManagementConfig: null })).toBe(true)
    expect(
      snapshot({ stockManagement: true, stockManagementConfig: { allowBackorders: true } })
    ).toBe(false)
    expect(snapshot({ stockManagement: false })).toBe(false)
  })
})
