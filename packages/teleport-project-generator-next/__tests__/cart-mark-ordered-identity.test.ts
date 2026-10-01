/* tslint:disable:function-constructor */
import { generateCartApiRoute } from '../src/ecommerce/cart-api-routes-generator'

/**
 * `POST /api/cart/mark-ordered` retires carts. Its only caller is the order
 * write in data-create-item, server side, which names the order's owner in
 * `anonymousUserId` and carries the internal-call token the workflow runtime
 * mints. A browser can POST the same body, and a user id is no secret, so the
 * id is honoured only on that server call: from anywhere else it would empty
 * anyone's cart. Executed against a fake pool.
 */

const SIGNED_IN = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const VICTIM = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f'
const MINTED = 'internal-call-token'
const RUNTIME = '../../../utils/workflows/server-runtime'

interface Query {
  sql: string
  params: unknown[]
}

const bootRoute = (options: { signedIn?: boolean; runtime?: boolean }) => {
  const code = generateCartApiRoute('postgresql', {
    connectionString: 'env:DATABASE_URL',
  }) as string
  const queries: Query[] = []
  const required: string[] = []
  class FakePool {
    public async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params })
      return { rows: [] as unknown[], rowCount: 1 }
    }
  }
  const moduleObj: { exports: any } = { exports: {} }
  const fakeRequire = (name: string): any => {
    required.push(name)
    if (name === 'pg') {
      return { Pool: FakePool }
    }
    if (name === 'next-auth/jwt') {
      return { getToken: async () => (options.signedIn ? { id: SIGNED_IN } : null) }
    }
    if (name === '../../../utils/email/email-locale') {
      return { normalizeEmailLocale: (): null => null }
    }
    if (name === RUNTIME && options.runtime !== false) {
      // The runtime's own check: the token only server code can mint.
      return {
        isInternalCall: (req: { headers: Record<string, string> }) =>
          req.headers['x-teleport-internal'] === MINTED,
      }
    }
    throw new Error("Cannot find module '" + name + "'")
  }
  new Function('require', 'module', 'exports', 'process', code)(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    { env: { NEXTAUTH_SECRET: 'secret', DATABASE_URL: 'postgresql://x' } }
  )
  const markOrdered = async (body: Record<string, unknown>, headers: Record<string, string>) => {
    queries.length = 0
    let payload: any = null
    const res = {
      status() {
        return this
      },
      json(value: any) {
        payload = value
        return this
      },
    }
    await moduleObj.exports({ method: 'POST', query: { op: 'mark-ordered' }, headers, body }, res)
    return { payload, updates: queries.filter((query) => /^UPDATE teleport_cart/.test(query.sql)) }
  }
  return { markOrdered, required }
}

describe('cart mark-ordered — whose carts a request may retire', () => {
  it("never retires another user's carts on a browser's word", async () => {
    const { markOrdered } = bootRoute({})
    const { payload, updates } = await markOrdered({ anonymousUserId: VICTIM }, {})
    expect(updates).toHaveLength(0)
    expect(payload).toEqual({ ok: true, updated: 0 })

    // A forged token is no token.
    const forged = await markOrdered(
      { anonymousUserId: VICTIM },
      { 'x-teleport-internal': 'guess' }
    )
    expect(forged.updates).toHaveLength(0)
  })

  it("keeps a browser to its own carts: the session's, or the guest's own session id", async () => {
    const signedIn = await bootRoute({ signedIn: true }).markOrdered(
      { anonymousUserId: VICTIM },
      {}
    )
    expect(signedIn.updates).toHaveLength(1)
    expect(signedIn.updates[0].params).toEqual([SIGNED_IN])
    expect(signedIn.updates[0].sql).not.toContain('OR')

    const guest = await bootRoute({}).markOrdered(
      { anonymousUserId: VICTIM, sessionId: 'guest-session-1' },
      {}
    )
    expect(guest.updates).toHaveLength(1)
    expect(guest.updates[0].params).toEqual(['guest-session-1'])
  })

  it("retires the order owner's carts on the server's own call", async () => {
    const { markOrdered, required } = bootRoute({ signedIn: true })
    const { payload, updates } = await markOrdered(
      { anonymousUserId: VICTIM },
      { 'x-teleport-internal': MINTED }
    )
    expect(payload).toEqual({ ok: true, updated: 1 })
    expect(updates).toHaveLength(1)
    expect(updates[0].params).toEqual([SIGNED_IN, VICTIM])
    expect(updates[0].sql).toContain("WHERE status = 'active' AND (user_id = $1 OR user_id = $2)")
    // pages/api/cart/[op].js → <root>/utils/workflows/server-runtime.js
    expect(required).toContain(RUNTIME)
  })

  it('trusts no call as internal in a project without the workflow runtime', async () => {
    const { markOrdered } = bootRoute({ runtime: false })
    const { updates } = await markOrdered(
      { anonymousUserId: VICTIM },
      { 'x-teleport-internal': MINTED }
    )
    expect(updates).toHaveLength(0)
  })

  it('asks for the runtime only when a request names an owner', async () => {
    const { markOrdered, required } = bootRoute({ signedIn: true })
    await markOrdered({}, {})
    expect(required).not.toContain(RUNTIME)
  })
})
