import { generateCartApiRoute } from '../src/ecommerce/cart-api-routes-generator'

/**
 * The cart route reads the session the same way the workflow routes do — and
 * had the same defect.
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
 * The route now resolves the cookie from the REQUEST — see
 * `session-cookie-resolver.ts` in @teleporthq/teleport-plugin-next-workflows.
 */

const PG_CFG = { connectionString: 'env:DATABASE_URL' }

// tslint:disable-next-line:no-var-requires
const { parse } = require('@babel/parser')
const parses = (code: string) =>
  parse(code, { sourceType: 'unambiguous', allowReturnOutsideFunction: true })

describe('the cart route resolves the session cookie from the request', () => {
  const cart = generateCartApiRoute('postgresql', PG_CFG) as string

  it('never asks getToken for the env-derived default', () => {
    expect(cart).toContain('__tqResolveSessionToken')
    expect(cart).toContain('__tqSessionToken(req)')
    expect(cart).not.toMatch(/getToken\(\{\s*req/)
  })

  it('still parses — the snippet is inlined into an ESM handler here', () => {
    expect(() => parses(cart)).not.toThrow()
  })
})
