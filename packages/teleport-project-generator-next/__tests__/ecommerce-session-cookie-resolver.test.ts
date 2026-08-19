import { generateCartApiRoute } from '../src/ecommerce/cart-api-routes-generator'
import { generateCheckoutApiRoute } from '../src/ecommerce/ecommerce-api-routes-generator'

/**
 * The cart and checkout routes read the session the same way the workflow
 * routes do — and had the same defect.
 *
 * ## ⛔ THE REPORTED DEFECT
 *
 * next-auth v4 derives the session-cookie NAME from `process.env.NEXTAUTH_URL`,
 * which a generated project ships as a localhost default and repairs from the
 * request only inside `/api/auth/[...nextauth]` — process-locally. On a
 * published https domain every other lambda therefore looked for the non-secure
 * cookie and reported a signed-in caller as anonymous. Measured on a live
 * deployment: 50 concurrent POSTs to one workflow route returned 33 × 401.
 *
 * Here the same miss is silent and worse than a 401: a logged-in buyer is
 * treated as a GUEST, so their cart is keyed by an anonymous session id instead
 * of their user id, and `mark-ordered` retires the wrong cart.
 *
 * Both routes now resolve the cookie from the REQUEST — see
 * `session-cookie-resolver.ts` in @teleporthq/teleport-plugin-next-workflows.
 */

const PG_CFG = { connectionString: 'env:DATABASE_URL' }

// tslint:disable-next-line:no-var-requires
const { parse } = require('@babel/parser')
const parses = (code: string) =>
  parse(code, { sourceType: 'unambiguous', allowReturnOutsideFunction: true })

describe('the ecommerce routes resolve the session cookie from the request', () => {
  const cart = generateCartApiRoute('postgresql', PG_CFG) as string
  const checkout = generateCheckoutApiRoute({ guestCheckout: true } as never, 'postgresql', PG_CFG)

  it('the cart route never asks getToken for the env-derived default', () => {
    expect(cart).toContain('__tqResolveSessionToken')
    expect(cart).toContain('__tqSessionToken(req)')
    expect(cart).not.toMatch(/getToken\(\{\s*req/)
  })

  it('the checkout route never asks getToken for the env-derived default', () => {
    expect(checkout).toContain('__tqResolveSessionToken')
    expect(checkout).toContain('__tqSessionToken(req)')
    expect(checkout).not.toMatch(/getToken\(\{\s*req/)
  })

  it('both still parse — the snippet is inlined into an ESM handler here', () => {
    expect(() => parses(cart)).not.toThrow()
    expect(() => parses(checkout)).not.toThrow()
  })

  it('a checkout route with no database emits no resolver it cannot use', () => {
    const noDb = generateCheckoutApiRoute({ guestCheckout: true } as never, null, null)
    expect(noDb).not.toContain('__tqResolveSessionToken')
    expect(() => parses(noDb)).not.toThrow()
  })
})
