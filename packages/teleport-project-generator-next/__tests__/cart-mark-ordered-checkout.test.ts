import { generateCheckoutApiRoute } from '../src/ecommerce/ecommerce-api-routes-generator'
import { UIDLEcommerceSettings } from '@teleporthq/teleport-types'

// After /api/ecommerce/checkout creates an order, it must retire the buyer's
// active database cart (status -> 'ordered'). Best-effort: wrapped so a
// failure never aborts the already-successful order response.

const settings: UIDLEcommerceSettings = {
  cashOnDelivery: true,
  deliveryEnabled: true,
  storePickupEnabled: false,
  guestCheckout: true,
  stockManagement: false,
  orderNotifications: false,
  deliveryConfig: null,
  stockManagementConfig: null,
  orderNotificationConfig: null,
  paymentProviders: [],
} as any

describe('generateCheckoutApiRoute — marks the cart ordered', () => {
  const route = generateCheckoutApiRoute(settings, 'postgresql', {
    connectionString: 'env:DATABASE_URL',
  })

  it('updates teleport_cart to ordered using server-resolved identity', () => {
    expect(route).toContain("require('next-auth/jwt')")
    expect(route).toContain('getToken')
    expect(route).toContain("UPDATE teleport_cart SET status = 'ordered'")
    expect(route).toContain("WHERE status = 'active'")
    // Guest checkout forwards a sessionId in the body.
    expect(route).toContain('req.body.sessionId')
  })

  it('wraps the mark-ordered in a catch so it cannot abort the order', () => {
    const idx = route.indexOf("UPDATE teleport_cart SET status = 'ordered'")
    expect(idx).toBeGreaterThan(-1)
    // There is a try/catch around the mark-ordered block.
    const before = route.slice(0, idx)
    expect(before.lastIndexOf('try {')).toBeGreaterThan(before.lastIndexOf('RETURNING id'))
  })

  it('does not emit cart-ordered SQL when there is no database', () => {
    const noDb = generateCheckoutApiRoute(settings, null, null)
    expect(noDb).not.toContain('teleport_cart')
  })
})
