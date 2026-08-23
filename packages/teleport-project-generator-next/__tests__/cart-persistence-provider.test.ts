import { generateEcommerceContextFileContent } from '../src/ecommerce/ecommerce-context-generator'
import { UIDLEcommerceSettings } from '@teleporthq/teleport-types'

// The EcommerceProvider gains a best-effort database cart layered on top of
// localStorage when cartDbEnabled is true: a stable guest session id, a
// load-or-backup reconcile on mount, and a debounced sync on every change.
// When cartDbEnabled is false the output must be byte-identical to the
// pure-localStorage cart (no /api/cart, no session id) so non-Postgres / no-DB
// projects are completely unaffected.

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

describe('EcommerceProvider — database cart layer', () => {
  it('emits session id + load/sync/persist when cartDbEnabled', () => {
    const out = generateEcommerceContextFileContent(settings, undefined, 'ds-1', true)
    expect(out).toContain('workflow_cart_session_id')
    expect(out).toContain('getOrCreateSessionId')
    expect(out).toContain('crypto.randomUUID')
    expect(out).toContain("typeof window === 'undefined'") // SSR guard in session id helper
    expect(out).toContain('/api/cart/load')
    expect(out).toContain('/api/cart/sync')
    expect(out).toContain('persistCartToDb')
    // Local-first reconcile: local cart wins, else hydrate from DB.
    expect(out).toContain('loadCartFromStorage()')
    expect(out).toContain('cartDbInitRef')
    // Debounce + first-render skip (no echo of the just-loaded cart).
    expect(out).toContain('cartPersistPrimedRef')
    expect(out).toContain('setTimeout')
    // DB-hydrated items are enriched with product details.
    expect(out).toContain('enrichCartItems(mapped)')
    // Variant fidelity: variantId is sent on sync and preserved (with a
    // unique composite local id) when hydrating from the DB.
    expect(out).toContain('variantId: i.variantId || null')
    expect(out).toContain('variantId: vid')
    expect(out).toContain("d.productId + (vid ? '__' + vid : '')")
  })

  it('persists the empty cart too (so an order clears the DB cart — no stale rehydrate)', () => {
    const out = generateEcommerceContextFileContent(settings, undefined, 'ds-1', true)
    // The persist effect must NOT bail out on an empty cart.
    expect(out).not.toContain('cartItems.length === 0) return')
  })

  it('is unchanged (pure localStorage) when cartDbEnabled is false', () => {
    const withFlagOff = generateEcommerceContextFileContent(settings, undefined, 'ds-1', false)
    const noArg = generateEcommerceContextFileContent(settings, undefined, 'ds-1')
    expect(withFlagOff).toBe(noArg) // 4th arg defaulting must match omission
    expect(withFlagOff).not.toContain('/api/cart/')
    expect(withFlagOff).not.toContain('workflow_cart_session_id')
    expect(withFlagOff).not.toContain('persistCartToDb')
  })
})

describe('EcommerceProvider — deliberate-clear guard', () => {
  const clearGuardSettings = { cashOnDelivery: true } as any
  const withDb = generateEcommerceContextFileContent(clearGuardSettings, undefined, 'ds-1', true)

  it('skips the DB re-hydration when the cart was just cleared on purpose', () => {
    // Without this, the post-order redirect mounts the provider with an empty
    // localStorage cart, the /api/cart/load round trip beats the in-flight
    // empty sync, and the buyer's confirmation page shows a full cart again.
    expect(withDb).toContain('function wasCartJustCleared()')
    expect(withDb).toContain('if (wasCartJustCleared()) return')
    expect(withDb).toContain("const CART_CLEARED_AT_KEY = 'workflow_cart_cleared_at'")
  })

  it('expires the stamp so a later visit can still restore a cross-device cart', () => {
    expect(withDb).toContain('CART_CLEARED_GRACE_MS')
    expect(withDb).toContain('localStorage.removeItem(CART_CLEARED_AT_KEY)')
  })

  it('checks the stamp only AFTER a non-empty local cart has won', () => {
    const localWinsAt = withDb.indexOf('persistCartToDb(local)')
    const guardAt = withDb.indexOf('if (wasCartJustCleared()) return')
    expect(localWinsAt).toBeGreaterThan(-1)
    expect(guardAt).toBeGreaterThan(localWinsAt)
  })

  it('emits none of the guard when the DB cart layer is off', () => {
    const noDb = generateEcommerceContextFileContent(clearGuardSettings, undefined, 'ds-1', false)
    expect(noDb).not.toContain('wasCartJustCleared')
    expect(noDb).not.toContain('workflow_cart_cleared_at')
  })
})
