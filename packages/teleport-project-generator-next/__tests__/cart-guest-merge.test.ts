import { generateCartApiRoute } from '../src/ecommerce/cart-api-routes-generator'
import { generateEcommerceContextFileContent } from '../src/ecommerce/ecommerce-context-generator'
import type { UIDLEcommerceSettings } from '@teleporthq/teleport-types'

/**
 * The guest cart a shopper fills before signing in.
 *
 * ## The bug this closes
 *
 * `ownerClause` is mutually exclusive: once a NextAuth token is present it
 * matches ONLY `user_id`, so the row written while logged out
 * (`session_id = X AND user_id IS NULL`) becomes unreachable the instant the
 * shopper signs in. On a device whose localStorage is empty — a second device,
 * a cleared browser, a private window — that cart is gone with no message.
 *
 * ## The second half, which is easy to miss
 *
 * Claiming the guest cart is not enough. The provider's next `sync` pushes the
 * snapshot it had BEFORE signing in, and a `sync` REPLACES the account cart's
 * lines — so it would immediately overwrite the freshly merged cart with the
 * guest half alone, discarding whatever the account already had elsewhere. The
 * endpoint therefore refuses to sync over a merge it just performed and returns
 * the union instead, which the provider adopts.
 */

const PG_CFG = { connectionString: 'env:DATABASE_URL' }
const route = generateCartApiRoute('postgresql', PG_CFG) as string

const settings = {
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
} as unknown as UIDLEcommerceSettings

describe('cart endpoint — claiming a guest cart', () => {
  it('is valid JavaScript', () => {
    expect(() => new Function(route)).not.toThrow()
  })

  it('exposes an explicit merge op alongside the existing three', () => {
    expect(route).toContain("if (op === 'merge') return await handleMerge(req, res, body)")
    // The three that already existed must keep working.
    for (const op of ['load', 'sync', 'mark-ordered']) {
      expect(route).toContain(`if (op === '${op}')`)
    }
  })

  // Automatic, so a shopper who never triggers an explicit merge still gets one.
  it('claims on load and on sync, not only on the explicit op', () => {
    expect(route).toMatch(/async function handleLoad[\s\S]*?await claimGuestCart\(identity\)/)
    expect(route).toMatch(/async function handleSync[\s\S]*?claimGuestCart\(identity\)/)
  })

  it('only claims when BOTH identities are present', () => {
    expect(route).toMatch(
      /async function claimGuestCart\(identity\) \{\s*if \(!identity\.userId \|\| !identity\.sessionId\) return \{ merged: false \}/
    )
  })

  // Two tabs, or a sync racing a load, must not both claim the same cart and
  // double its quantities.
  it('locks both carts before touching them', () => {
    const claim = route.slice(route.indexOf('async function claimGuestCart'))
    const lockCount = (claim.match(/FOR UPDATE/g) || []).length
    expect(lockCount).toBeGreaterThanOrEqual(2)
  })

  it('hands the row over wholesale when the account has no cart yet', () => {
    expect(route).toContain(
      'UPDATE teleport_cart SET user_id = $1, session_id = NULL, updated_at = NOW() WHERE id = $2'
    )
  })

  it('adds quantities where both carts hold the same line', () => {
    expect(route).toContain('u.quantity + g.quantity')
  })

  // A merge must never build a line the checkout would then reject.
  it('caps a merged quantity at the product stock', () => {
    expect(route).toContain('LEAST(')
    expect(route).toContain('SELECT p.quantity FROM teleport_products p WHERE p.id = u.product_id')
  })

  // NULL means untracked stock; capping to it would zero the line.
  it('leaves an untracked-stock product uncapped', () => {
    expect(route).toMatch(/COALESCE\(\(SELECT p\.quantity[\s\S]*?u\.quantity \+ g\.quantity\)\)/)
  })

  it('treats a null variant and an empty variant as the same line', () => {
    // Otherwise a flat product would merge as two separate lines.
    expect(route).toContain("COALESCE(u.variant_id, '') = COALESCE(g.variant_id, '')")
  })

  it('skips a product deleted since the guest added it', () => {
    expect(route).toContain('EXISTS (SELECT 1 FROM teleport_products p WHERE p.id = g.product_id)')
  })

  // Not deleted: the row is evidence for anything already referencing it (an
  // abandoned-cart reminder mid-flight), and a status the active lookup ignores
  // is enough to stop a second merge.
  it('retires the guest cart by status rather than deleting it', () => {
    expect(route).toContain("UPDATE teleport_cart SET status = 'merged'")
    expect(route).not.toContain('DELETE FROM teleport_cart WHERE')
  })

  it('rolls back and reports failure rather than throwing', () => {
    const claim = route.slice(
      route.indexOf('async function claimGuestCart'),
      route.indexOf('async function handleMerge')
    )
    expect(claim).toContain('ROLLBACK')
    expect(claim).toContain('return { merged: false }')
    expect(claim).toContain('client.release()')
  })
})

describe('cart endpoint — sync must not bury a merge', () => {
  it('returns the merged cart instead of accepting the pre-login snapshot', () => {
    expect(route).toMatch(
      /var claim = await claimGuestCart\(identity\)\s*if \(claim\.merged\) \{[\s\S]*?merged: true, items: await readCartItems\(identity\)/
    )
  })

  it('reads the cart through one shared helper, so load and merge agree', () => {
    expect(route).toContain('async function readCartItems(identity)')
    expect(route).toMatch(/handleLoad[\s\S]*?await readCartItems\(identity\)/)
  })
})

describe('cart provider — adopting a merged cart', () => {
  const provider = generateEcommerceContextFileContent(settings, undefined, 'ds1', true, false)

  it('reads the sync response instead of firing and forgetting', () => {
    expect(provider).toContain('persistCartToDb(local).then(adoptMergedCart)')
    expect(provider).toContain('persistCartToDb(snapshot).then(adoptMergedCart)')
  })

  it('adopts only when the server says it merged', () => {
    expect(provider).toMatch(
      /if \(response && response\.merged\) \{\s*applyServerCart\(response\.items\)/
    )
  })

  // One implementation, so a shopper cannot tell which path filled their cart.
  it('applies a server cart through one shared function', () => {
    expect(provider).toContain('const applyServerCart = useCallback')
    expect(provider).toContain('applyServerCart(data && data.items)')
  })

  it('still writes an adopted cart to state, meta and localStorage', () => {
    const apply = provider.slice(
      provider.indexOf('const applyServerCart = useCallback'),
      provider.indexOf('const adoptMergedCart')
    )
    expect(apply).toContain('setCartItems(mapped)')
    expect(apply).toContain('setCartMeta(computeCartMeta(mapped))')
    expect(apply).toContain('saveCartToStorage(mapped)')
    expect(apply).toContain('enrichCartItems(mapped)')
  })

  it('is a no-op on an empty server cart', () => {
    expect(provider).toMatch(/const rows = dbItems \|\| \[\]\s*if \(!rows\.length\) return/)
  })

  // The whole database cart is opt-in; a localStorage-only store must be
  // byte-identical to what it was.
  it('emits none of this when the database cart is disabled', () => {
    const localOnly = generateEcommerceContextFileContent(settings, undefined, 'ds1', false, false)
    expect(localOnly).not.toContain('applyServerCart')
    expect(localOnly).not.toContain('adoptMergedCart')
    expect(localOnly).not.toContain('/api/cart/sync')
  })
})
