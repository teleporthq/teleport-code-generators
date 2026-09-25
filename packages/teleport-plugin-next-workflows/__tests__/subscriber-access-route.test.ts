import { SubscriptionAccess } from '@teleporthq/teleport-shared'
import {
  generateSubscriberAccessHelperModule,
  generateSubscriberAccessRoute,
  hasSubscriberOnlyPages,
  resolveProductDetailsRoute,
  resolveSubscriptionFallbackRoute,
} from '../src/subscriber-access-route-generator'

// The subscriber-access route and the helper module it shares with the
// workflow-route guard are EXECUTED here with a stubbed `pg` client and a
// stubbed session, so the contract is proven on behaviour: 401 without a
// session, one parameterised query with the entitled statuses and the product
// ids, `{ entitled }` never cached, and a product page to send a
// non-subscriber to when the store has one.

interface QueryCall {
  sql: string
  params: unknown[]
}

interface PgStub {
  calls: QueryCall[]
  entitledRows: unknown[]
  productRows: unknown[]
  failWith: Error | null
  connections: number
  ended: number
}

const makePgStub = (): PgStub => ({
  calls: [],
  entitledRows: [],
  productRows: [],
  failWith: null,
  connections: 0,
  ended: 0,
})

const bootHelper = (
  pg: PgStub,
  details: { staticBase: string; differentiatorColumn: string } | null
) => {
  const code = generateSubscriberAccessHelperModule({ productDetails: details })
  class Client {
    public async connect() {
      pg.connections += 1
    }
    public async query(sql: string, params: unknown[]) {
      pg.calls.push({ sql, params })
      if (pg.failWith) {
        throw pg.failWith
      }
      return {
        rows: sql.indexOf('FROM teleport_products') !== -1 ? pg.productRows : pg.entitledRows,
      }
    }
    public async end() {
      pg.ended += 1
    }
  }
  const fakeRequire = (name: string): any => {
    if (name === 'pg') {
      return { Client }
    }
    throw new Error(`unexpected require: ${name}`)
  }
  const moduleObj: { exports: any } = { exports: {} }
  // tslint:disable-next-line:function-constructor
  new Function('require', 'module', 'exports', 'process', code)(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    { env: { TELEPORT_DB_CONNECTION_STRING: 'postgresql://user:pw@db.test/store' } }
  )
  return moduleObj.exports
}

interface RouteResponse {
  statusCode: number | null
  body: unknown
  headers: Record<string, string>
}

const bootRoute = (
  helper: any,
  token: Record<string, unknown> | null,
  secret = 'server-secret'
) => {
  const code = generateSubscriberAccessRoute()
  const fakeRequire = (name: string): any => {
    if (name === 'next-auth/jwt') {
      return { getToken: async () => token }
    }
    if (name === '../../../utils/auth/subscriber-access') {
      return helper
    }
    throw new Error(`unexpected require: ${name}`)
  }
  const moduleObj: { exports: any } = { exports: {} }
  // tslint:disable-next-line:function-constructor
  new Function('require', 'module', 'exports', 'process', 'console', code)(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    { env: { NEXTAUTH_SECRET: secret } },
    { error: () => undefined }
  )
  const handler = moduleObj.exports as (req: unknown, res: unknown) => Promise<unknown>
  return async (req: Record<string, unknown>): Promise<RouteResponse> => {
    const response: RouteResponse = { statusCode: null, body: undefined, headers: {} }
    const res = {
      setHeader: (name: string, value: string) => {
        response.headers[name] = value
      },
      status: (statusCode: number) => {
        response.statusCode = statusCode
        return {
          json: (body: unknown) => {
            response.body = body
            return response
          },
        }
      },
    }
    await handler(
      { method: 'GET', headers: { cookie: 'next-auth.session-token=x' }, query: {}, ...req },
      res
    )
    return response
  }
}

const productDetails = { staticBase: '/products', differentiatorColumn: 'slug' }

describe('the subscriber-access helper module', () => {
  it('runs the one shared entitlement query with the entitled statuses and the ids', async () => {
    const pg = makePgStub()
    pg.entitledRows = [{ '?column?': 1 }]
    const helper = bootHelper(pg, productDetails)

    expect(await helper.isSubscriberEntitled('u1', ['prod-1', ' prod-2 ', 'prod-1', ''])).toBe(true)
    expect(pg.calls).toHaveLength(1)
    expect(pg.calls[0].sql).toBe(SubscriptionAccess.SUBSCRIPTION_ENTITLEMENT_SQL)
    expect(pg.calls[0].params).toEqual([
      'u1',
      SubscriptionAccess.SUBSCRIPTION_ENTITLED_STATUSES,
      ['prod-1', 'prod-2'],
    ])
    expect(helper.SUBSCRIPTION_ENTITLED_STATUSES).toEqual(['trialing', 'active', 'past_due'])
    // The connection is always closed.
    expect(pg.connections).toBe(1)
    expect(pg.ended).toBe(1)
  })

  it('an empty list means any product, and no user means no query', async () => {
    const pg = makePgStub()
    const helper = bootHelper(pg, productDetails)
    expect(await helper.isSubscriberEntitled('u1', [])).toBe(false)
    expect(pg.calls[0].params[2]).toEqual([])
    expect(await helper.isSubscriberEntitled('', ['prod-1'])).toBe(false)
    expect(pg.calls).toHaveLength(1)
  })

  it('surfaces a database failure to its caller and still closes the connection', async () => {
    const pg = makePgStub()
    pg.failWith = new Error('connection refused')
    const helper = bootHelper(pg, productDetails)
    await expect(helper.isSubscriberEntitled('u1', ['prod-1'])).rejects.toThrow(
      'connection refused'
    )
    expect(pg.ended).toBe(1)
  })

  it('resolves the first product to its storefront page, or null', async () => {
    const pg = makePgStub()
    pg.productRows = [{ value: 'coffee club' }]
    const helper = bootHelper(pg, productDetails)
    expect(await helper.resolveProductRedirect(['prod-2', 'prod-1'])).toBe(
      '/products/coffee%20club'
    )
    expect(pg.calls[0].sql).toContain('"slug" AS value FROM teleport_products WHERE id::text = $1')
    expect(pg.calls[0].params).toEqual(['prod-2'])

    pg.productRows = []
    expect(await helper.resolveProductRedirect(['gone'])).toBeNull()
    expect(await helper.resolveProductRedirect([])).toBeNull()
    pg.failWith = new Error('down')
    expect(await helper.resolveProductRedirect(['prod-1'])).toBeNull()

    const noPage = bootHelper(makePgStub(), null)
    expect(await noPage.resolveProductRedirect(['prod-1'])).toBeNull()
    const atRoot = makePgStub()
    atRoot.productRows = [{ value: 'coffee-club' }]
    expect(
      await bootHelper(atRoot, {
        staticBase: '/',
        differentiatorColumn: 'slug',
      }).resolveProductRedirect(['prod-1'])
    ).toBe('/coffee-club')
  })

  it('never bakes a product column that is not a plain identifier', () => {
    const code = generateSubscriberAccessHelperModule({
      productDetails: { staticBase: '/products', differentiatorColumn: 'slug"; DROP TABLE x; --' },
    })
    expect(code).toContain('var PRODUCT_DETAILS = null;')
  })
})

describe('the subscriber-access route', () => {
  it('answers 401 without a session, never cached', async () => {
    const pg = makePgStub()
    const route = bootRoute(bootHelper(pg, productDetails), null)
    const response = await route({ query: { products: 'prod-1' } })
    expect(response.statusCode).toBe(401)
    expect(response.headers['Cache-Control']).toBe('no-store')
    expect(pg.calls).toHaveLength(0)
  })

  it('answers { entitled: true } for a member, from the session id, never a query param', async () => {
    const pg = makePgStub()
    pg.entitledRows = [{ '?column?': 1 }]
    const route = bootRoute(bootHelper(pg, productDetails), { id: 'u1', role: 'user' })
    const response = await route({ query: { products: 'prod-1,prod-2', userId: 'victim' } })
    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ entitled: true })
    expect(response.headers['Cache-Control']).toBe('no-store')
    expect(pg.calls[0].params[0]).toBe('u1')
    expect(pg.calls[0].params[2]).toEqual(['prod-1', 'prod-2'])
  })

  it('falls back to the token subject and reads a repeated query param', async () => {
    const pg = makePgStub()
    pg.entitledRows = [{ '?column?': 1 }]
    const route = bootRoute(bootHelper(pg, productDetails), { sub: 'u2' })
    const response = await route({ query: { products: ['prod-1', 'prod-2'] } })
    expect(response.body).toEqual({ entitled: true })
    expect(pg.calls[0].params[0]).toBe('u2')
    expect(pg.calls[0].params[2]).toEqual(['prod-1', 'prod-2'])
  })

  it('tells a non-subscriber where the product lives', async () => {
    const pg = makePgStub()
    pg.productRows = [{ value: 'coffee-club' }]
    const route = bootRoute(bootHelper(pg, productDetails), { id: 'u1' })
    const response = await route({ query: { products: 'prod-1' } })
    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ entitled: false, redirectTo: '/products/coffee-club' })

    const anyProduct = await route({ query: {} })
    expect(anyProduct.body).toEqual({ entitled: false })
  })

  it('answers 500 when the check itself fails, and 405 to anything but GET', async () => {
    const pg = makePgStub()
    pg.failWith = new Error('down')
    const route = bootRoute(bootHelper(pg, productDetails), { id: 'u1' })
    const failed = await route({ query: { products: 'prod-1' } })
    expect(failed.statusCode).toBe(500)
    expect(failed.headers['Cache-Control']).toBe('no-store')

    const post = await route({ method: 'POST' })
    expect(post.statusCode).toBe(405)
    expect(post.headers.Allow).toBe('GET')
  })
})

describe('what the plugin reads off the UIDL', () => {
  const uidlWith = (values: unknown[]): any => ({
    root: { stateDefinitions: { route: { defaultValue: 'home', values } } },
  })

  it('emits the files only when a page is subscriber-only', () => {
    expect(hasSubscriberOnlyPages(undefined)).toBe(false)
    expect(
      hasSubscriberOnlyPages({
        pageProtection: { A: { requiresAuth: true, allowedRoles: [], route: '/a' } },
      } as any)
    ).toBe(false)
    expect(
      hasSubscriberOnlyPages({
        pageProtection: {
          A: { requiresAuth: true, allowedRoles: [], route: '/a', requiresSubscription: true },
        },
      } as any)
    ).toBe(true)
  })

  it('finds the product page by its details table and the listing by the shared base', () => {
    const uidl = uidlWith([
      { value: 'home', pageId: 'h', pageOptions: { navLink: '/' } },
      { value: 'products', pageId: 'l', pageOptions: { navLink: '/products' } },
      {
        value: 'product-details',
        pageId: 'd',
        pageOptions: {
          navLink: '/products/[slug]',
          dynamicRouteAttribute: 'slug',
          detailsPageInfo: { tableName: 'teleport_products', differentiatorColumn: 'slug' },
        },
      },
    ])
    expect(resolveProductDetailsRoute(uidl)).toEqual({
      staticBase: '/products',
      differentiatorColumn: 'slug',
    })
    expect(resolveSubscriptionFallbackRoute(uidl)).toBe('/products')

    const detailsOnly = uidlWith([
      {
        value: 'product-details',
        pageId: 'd',
        pageOptions: {
          navLink: '/shop/[id]',
          detailsPageInfo: { tableName: 'teleport_products', differentiatorColumn: 'id' },
        },
      },
    ])
    expect(resolveProductDetailsRoute(detailsOnly)?.staticBase).toBe('/shop')
    expect(resolveSubscriptionFallbackRoute(detailsOnly)).toBe('/')

    expect(resolveProductDetailsRoute(uidlWith([]))).toBeNull()
    expect(resolveSubscriptionFallbackRoute(undefined)).toBe('/')
  })
})
