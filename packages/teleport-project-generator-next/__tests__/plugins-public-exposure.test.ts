/* tslint:disable:function-constructor no-any */
import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { NextInstantSearchProjectPlugin } from '../src/instant-search/project-plugin'
import { NextItemComparisonProjectPlugin } from '../src/item-comparison/project-plugin'
import { withoutCredentialColumns } from '../src/plugins/public-exposure'
import { generateRawQueryApiRoute } from '../src/global-state/data-source-utils'

/**
 * The plugins' public routes (the instant search, the item comparison) index
 * and serve only what a page every visitor may open shows: a table only
 * signed-in or subscriber pages bind is never indexed, nor a page behind a
 * sign-in, nor a credential-named column. And an app-wide global state over a
 * protected table answers the project's staff.
 */

const APP_CONTENT = `const MyApp = ({ Component, pageProps }) => <Component {...pageProps} />

export default MyApp
`

const details = (navLink: string, tableName: string) => ({
  value: navLink.split('/')[1],
  pageOptions: {
    navLink,
    dynamicRouteAttribute: 'slug',
    detailsPageInfo: {
      dataSourceId: 'ds',
      dataSourceName: 'Teleport',
      dataSourceType: 'teleport',
      tableName,
      differentiatorColumn: 'slug',
      featureIdentifier: '',
    },
  },
})

const structureWith = (plugins: Record<string, unknown>): ProjectPluginStructure => {
  const files = new Map()
  files.set('_app', {
    path: ['pages'],
    files: [{ name: '_app', fileType: FileType.JS, content: APP_CONTENT }],
  })
  return {
    uidl: {
      name: 'p',
      globals: { settings: { title: 'P', language: 'en' }, assets: [] },
      dataSources: { ds: { id: 'ds', name: 'Teleport', type: 'teleport', config: {} } },
      ecommerceSettings: { paymentProviders: [] },
      blogSettings: {},
      bookingSettings: {},
      plugins,
      authentication: {
        enabled: true,
        roles: ['admin', 'user'],
        pageProtection: {
          // The posts are a subscriber's, the booking items a member's.
          blog: {
            requiresAuth: true,
            allowedRoles: [],
            pageName: 'blog',
            route: '/blog',
            requiresSubscription: true,
            subscriptionProductIds: [],
          },
          book: { requiresAuth: true, allowedRoles: [], pageName: 'book', route: '/book' },
          members: { requiresAuth: true, allowedRoles: [], pageName: 'members', route: '/members' },
        },
        folderProtection: {},
        authPages: {},
      },
      root: {
        name: 'App',
        stateDefinitions: {
          route: {
            type: 'string',
            values: [
              { value: 'home', pageOptions: { navLink: '/' } },
              details('/products/[slug]', 'teleport_products'),
              details('/blog/[slug]', 'teleport_blog_posts'),
              details('/book/[slug]', 'teleport_booking_items'),
            ],
          },
        },
      },
    },
    files,
    dependencies: {},
    devDependencies: {},
    template: { files: [], subFolders: [] },
  } as unknown as ProjectPluginStructure
}

describe('the plugins index and serve only what a public page shows', () => {
  it('the instant search reads no table a protected or subscriber page binds, and no protected page', async () => {
    const structure = structureWith({
      instantSearch: {
        settings: { sections: ['pages', 'products', 'posts', 'bookingItems'] },
        data: {
          pages: [
            { title: 'About', route: '/', text: 'Our story' },
            { title: 'Members', route: '/members', text: 'The secret handshake' },
          ],
        },
      },
    })
    await new NextInstantSearchProjectPlugin().runAfter(structure)

    const route = structure.files.get('instant-search-route').files[0].content as string
    expect(route).toContain('key: "products"')
    expect(route).not.toContain('key: "posts"')
    expect(route).not.toContain('key: "bookingItems"')
    const index = structure.files.get('instant-search-index').files[0].content as string
    expect(index).toContain('Our story')
    expect(index).not.toContain('secret handshake')
  })

  it('the item comparison compares no table a protected page binds', async () => {
    const structure = structureWith({ itemComparison: { settings: {} } })
    await new NextItemComparisonProjectPlugin().runAfter(structure)

    const route = structure.files.get('item-comparison-route').files[0].content as string
    expect(route).toContain('"products": {')
    expect(route).not.toContain('"bookingItems": {')
  })

  it('never indexes the table of a row-owned (self-guarded) details page (I3)', async () => {
    const structure = structureWith({
      instantSearch: { settings: { sections: ['products'] }, data: { pages: [] } },
    })
    ;(structure.uidl as any).authentication.pageProtection.products = {
      requiresAuth: true,
      allowedRoles: [],
      pageName: 'product',
      route: '/products',
      routePattern: '/products/[slug]',
      rowOwnerColumn: 'user_id',
      rowOwnerDifferentiator: 'slug',
    }
    await new NextInstantSearchProjectPlugin().runAfter(structure)
    const route = structure.files.get('instant-search-route').files[0].content as string
    expect(route).not.toContain('key: "products"')
  })

  it('never names a credential column', () => {
    expect(
      withoutCredentialColumns(['name', 'api_key', 'secret_ingredient', 'access_token'])
    ).toEqual(['name', 'secret_ingredient'])
  })
})

describe('an app-wide global state over a protected table', () => {
  const boot = (staffRoles: string[]) => {
    const code = generateRawQueryApiRoute(
      { id: 'ds', name: 'db', type: 'teleport', config: {} } as any,
      "SELECT COUNT(*) AS pending FROM teleport_orders WHERE status = 'pending'",
      staffRoles
    )
      .replace(
        /^import \{ Client, types as pgTypes \} from 'pg'$/m,
        "const { Client, types: pgTypes } = require('pg')"
      )
      .replace(/^export default async function handler/m, 'module.exports = async function handler')
    let session: any = null
    class FakeClient {
      public async connect(): Promise<void> {
        return
      }
      public async end(): Promise<void> {
        return
      }
      public async query(): Promise<{ rows: any[] }> {
        return { rows: [{ pending: 3 }] }
      }
    }
    const fakeRequire = (name: string): any => {
      if (name === 'pg') {
        return { Client: FakeClient, types: { setTypeParser: (): void => undefined } }
      }
      if (name === 'next-auth/jwt') {
        return { getToken: async () => session }
      }
      if (name === 'crypto') {
        return require('crypto')
      }
      throw new Error('unexpected require: ' + name)
    }
    const moduleObj: { exports: any } = { exports: {} }
    new Function('require', 'module', 'exports', 'process', 'console', code)(
      fakeRequire,
      moduleObj,
      moduleObj.exports,
      { env: { NEXTAUTH_SECRET: 'server-secret' } },
      { log: (): void => undefined, warn: (): void => undefined, error: (): void => undefined }
    )
    return async (who: any) => {
      session = who
      const reply: any = {}
      const res: any = {
        status(c: number) {
          reply.status = c
          return res
        },
        json(p: any) {
          reply.body = p
          return res
        },
      }
      // A signed-in local request carries the plain session cookie.
      const headers = who ? { cookie: 'next-auth.session-token=signed' } : {}
      await moduleObj.exports({ method: 'GET', query: {}, headers }, res)
      return reply
    }
  }

  it("answers the project's staff, and no one else", async () => {
    const route = boot(['admin', 'manager'])
    expect((await route({ sub: 'a1', role: 'admin' })).status).toBe(200)
    expect((await route({ sub: 'm1', role: 'manager' })).status).toBe(200)
    expect((await route({ sub: 'u1', role: 'member' })).status).toBe(403)
    expect((await route(null)).status).toBe(401)
  })
})
