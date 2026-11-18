import { ProjectUIDL } from '@teleporthq/teleport-types'
import {
  BROWSER_READ_DEFAULT_LIMIT,
  BROWSER_READ_MAX_LIMIT,
  CLOSED_COMPONENT_EXPOSURE,
  CLOSED_READ_EXPOSURE,
  componentExposureFor,
  managedDataSourceIds,
  readExposureFor,
  resolveDataExposure,
} from '../../src/utils/data-exposure'
import {
  isCredentialColumnName,
  PRIVATE_CUSTOMER_RECORD_TABLES,
  PRIVATE_RECORD_PARENTS,
  PROTECTED_TABLES,
  resolveStaffRoles,
} from '../../src/utils/table-access'

/**
 * Who may read each table from a browser is decided from the pages that bind
 * it (R1): a page every visitor may open makes its tables public, a protected
 * page admits only its sessions, and a table no page binds is the server's.
 */

const DS = 'ds-1'

const list = (table: string, params: Record<string, unknown> = {}, perPage?: number) => ({
  type: 'data-source-list',
  content: {
    renderPropIdentifier: `${table}Items`,
    resourceDefinition: { type: 'external-data-source', dataSourceId: DS, tableName: table },
    resource: { params },
    nodes: {
      success: perPage
        ? { type: 'cms-list-repeater', content: { paginated: true, perPage } }
        : { type: 'element', content: { elementType: 'container', children: [] as unknown[] } },
    },
  },
})

const page = (value: string, children: unknown[]) => ({
  type: 'conditional',
  content: {
    reference: { type: 'dynamic', content: { referenceType: 'state', id: 'route' } },
    value,
    node: { type: 'element', content: { elementType: 'container', children } },
  },
})

const buildUidl = (): ProjectUIDL =>
  ({
    name: 'p',
    globals: { settings: { title: 't', language: 'en' }, assets: [], meta: [] },
    root: {
      name: 'App',
      stateDefinitions: {
        route: {
          type: 'string',
          defaultValue: 'home',
          values: [
            { value: 'home', pageOptions: { navLink: '/' } },
            {
              value: 'post',
              pageOptions: {
                navLink: '/blog/[slug]',
                dynamicRouteAttribute: 'slug',
                initialPropsData: { exposeAs: { name: 'post' }, resource: { id: 'res-posts' } },
              },
            },
            { value: 'account', pageOptions: { navLink: '/account' } },
            { value: 'lessons', pageOptions: { navLink: '/lessons' } },
            { value: 'vault', pageOptions: { navLink: '/vault' } },
            { value: 'staff', pageOptions: { navLink: '/staff' } },
            {
              value: 'admin/orders',
              pageOptions: {
                navLink: '/admin/orders',
                stateDefinitions: {
                  orderCount: {
                    type: 'number',
                    dataSourceBinding: { dataSourceId: DS, refPath: ['teleport_orders', 0] },
                  },
                },
              },
            },
          ],
        },
      },
      node: {
        type: 'element',
        content: {
          elementType: 'container',
          children: [
            page('home', [
              list('teleport_products', { limit: { type: 'static', content: 24 } }),
              {
                type: 'element',
                content: {
                  elementType: 'component',
                  semanticType: 'Reviews',
                  dependency: { type: 'local' },
                },
              },
            ]),
            page('post', []),
            page('account', [list('member_notes', {}, 12)]),
            page('lessons', [list('premium_lessons', {}, 12)]),
            page('vault', [list('premium_lessons', {}, 12), list('vault_files', {}, 12)]),
            page('staff', [list('staff_rotas', {}, 1000)]),
            page('admin/orders', [list('teleport_orders', {}, 20)]),
            // The layout every page shares.
            {
              type: 'element',
              content: { elementType: 'container', children: [list('site_banners')] },
            },
          ],
        },
      },
    },
    components: {
      Reviews: {
        name: 'Reviews',
        node: {
          type: 'element',
          content: { elementType: 'container', children: [list('testimonials', {}, 6)] },
        },
      },
    },
    resources: {
      items: {
        'res-posts': {
          id: 'res-posts',
          params: {
            dataSourceId: { type: 'static', content: DS },
            tableName: { type: 'static', content: 'teleport_blog_posts' },
          },
        },
      },
    },
    authentication: {
      enabled: true,
      roles: ['admin', 'staff', 'user'],
      pageProtection: {
        account: { requiresAuth: true, allowedRoles: [], pageName: 'account', route: '/account' },
        lessons: {
          requiresAuth: true,
          allowedRoles: [],
          pageName: 'lessons',
          route: '/lessons',
          requiresSubscription: true,
          subscriptionProductIds: ['plan-pro'],
        },
        vault: {
          requiresAuth: true,
          allowedRoles: ['member'],
          pageName: 'vault',
          route: '/vault',
          requiresSubscription: true,
          subscriptionProductIds: [],
        },
        staff: { requiresAuth: true, allowedRoles: ['staff'], pageName: 'staff', route: '/staff' },
        orders: {
          requiresAuth: true,
          allowedRoles: ['admin'],
          pageName: 'orders',
          route: '/admin/orders',
        },
      },
      folderProtection: {},
      authPages: {},
    },
  } as unknown as ProjectUIDL)

describe('resolveDataExposure', () => {
  const exposure = resolveDataExposure(buildUidl())

  it('makes public every table a page any visitor may open binds — directly, in a component, in the layout, through a resource', () => {
    for (const table of [
      'teleport_products',
      'testimonials',
      'site_banners',
      'teleport_blog_posts',
    ]) {
      expect(exposure.tables[`ds-1:${table}`]).toMatchObject({ public: true })
    }
  })

  it('admits only the sessions of the protected pages that bind a table', () => {
    expect(exposure.tables['ds-1:member_notes']).toMatchObject({
      public: false,
      anySession: true,
      roles: [],
    })
    expect(exposure.tables['ds-1:staff_rotas']).toMatchObject({
      public: false,
      anySession: false,
      roles: ['staff'],
    })
    // A list and a state seeded from the table, both on the admin page.
    expect(exposure.tables['ds-1:teleport_orders']).toMatchObject({
      public: false,
      roles: ['admin'],
    })
  })

  it('admits the sessions of a subscriber-only page only with the entitlement it asks for', () => {
    expect(exposure.tables['ds-1:premium_lessons']).toMatchObject({
      public: false,
      anySession: false,
      roles: [],
      subscriberRules: [
        { roles: [], productIds: ['plan-pro'] },
        { roles: ['member'], productIds: [] },
      ],
    })
    expect(exposure.tables['ds-1:vault_files'].subscriberRules).toEqual([
      { roles: ['member'], productIds: [] },
    ])
    // A table a plain signed-in page binds too needs no subscription.
    expect(exposure.tables['ds-1:member_notes'].subscriberRules).toBeUndefined()
  })

  it('closes a table no page binds, and every table when nothing decided', () => {
    expect(readExposureFor(exposure, { tableName: 'contacts' })).toBe(CLOSED_READ_EXPOSURE)
    expect(readExposureFor(undefined, { tableName: 'teleport_products' })).toBe(
      CLOSED_READ_EXPOSURE
    )
    expect(readExposureFor(exposure, { tableName: 'public."Teleport_Products"' }).public).toBe(true)
  })

  it('bounds the rows: the default for a counted list, the maximum for a whole one, more when a binding asks', () => {
    expect(exposure.tables['ds-1:teleport_products']).toMatchObject({
      defaultLimit: BROWSER_READ_DEFAULT_LIMIT,
      maxLimit: BROWSER_READ_MAX_LIMIT,
    })
    // The layout's banner list names no count: it shows every row.
    expect(exposure.tables['ds-1:site_banners'].defaultLimit).toBe(BROWSER_READ_MAX_LIMIT)
    expect(exposure.tables['ds-1:staff_rotas'].maxLimit).toBe(1000)
  })

  it('keys the sources without tables by data source', () => {
    expect(exposure.dataSources[DS].public).toBe(true)
    expect(
      readExposureFor(exposure, { tableName: 'data', dataSourceId: DS, dataSourceType: 'rest-api' })
        .public
    ).toBe(true)
    expect(
      readExposureFor(exposure, {
        tableName: 'data',
        dataSourceId: 'other',
        dataSourceType: 'csv-file',
      })
    ).toBe(CLOSED_READ_EXPOSURE)
  })

  it('makes every table public in a project without authentication', () => {
    const uidl = buildUidl() as any
    uidl.authentication.enabled = false
    const open = resolveDataExposure(uidl)
    expect(open.tables['ds-1:staff_rotas'].public).toBe(true)
  })
})

describe('credential columns and the protected net', () => {
  it('names a credential by its column name, in any table', () => {
    for (const column of [
      'password',
      'password_hash',
      'hashed_password',
      'passwordHash',
      'secret',
      'token',
      'access_token',
      'refreshToken',
      'password_reset_token',
      'email_verification_token',
      'session_token',
      'id_token',
      'api_token',
      'auth_token',
      'bearer_token',
      'csrf_token',
      'client_secret',
      'stripe_webhook_secret',
      'signing_secret',
      'appSecret',
      'api_key',
      'apiKey',
      'stripe_api_key',
    ]) {
      expect(isCredentialColumnName(column)).toBe(true)
    }
  })

  it('never takes a word that merely contains one', () => {
    for (const column of [
      'secret_ingredient',
      'secretary',
      'token_count',
      'tokens_used',
      'design_tokens',
      'sync_claim_token',
      'passwords_reset_count',
      'password_hint',
      'keyword',
      'monkey',
      'name',
      'email',
      'status',
    ]) {
      expect(isCredentialColumnName(column)).toBe(false)
    }
  })

  it('protects the browsing history, the audiences and the app bookkeeping', () => {
    for (const table of [
      'teleport_recently_viewed',
      'teleport_waitlist_entries',
      'teleport_booking_waitlist',
      'teleport_newsletter_issues',
      'teleport_rate_limits',
      'teleport_automation_requests',
      'teleport_password_resets',
    ]) {
      expect(PROTECTED_TABLES).toContain(table)
    }
  })

  // The newsletter's people are rows of `users` (already protected); its
  // issues are the merchant's, never a page's: private records no visitor owns,
  // so a visitor's segment read finds none. The old subscribers table name was
  // never written by anything.
  it('keeps the newsletter issues to the staff and forgets the unused subscribers table', () => {
    expect(PROTECTED_TABLES).toContain('teleport_newsletter_issues')
    expect(PROTECTED_TABLES).toContain('users')
    expect(PRIVATE_CUSTOMER_RECORD_TABLES).toContain('teleport_newsletter_issues')
    expect(PRIVATE_RECORD_PARENTS).not.toHaveProperty('teleport_newsletter_issues')
    expect(PROTECTED_TABLES).not.toContain('teleport_newsletter_subscribers')
  })
})

describe('the staff roles', () => {
  it("are the admin panel's roles and the explicit admin role — never a customer role", () => {
    const auth = {
      enabled: true,
      roles: ['admin', 'manager', 'member', 'user'],
      pageProtection: {},
      folderProtection: { f: { folderName: 'admin-panel', allowedRoles: ['manager'] } },
    } as any
    expect(resolveStaffRoles(auth)).toEqual(['admin', 'manager'])
    expect(resolveStaffRoles(undefined)).toEqual(['admin'])
  })
})

describe('fix round 1: exposure', () => {
  const pageNode = (value: string, children: unknown[]) => ({
    type: 'conditional',
    content: {
      reference: { type: 'dynamic', content: { referenceType: 'state', id: 'route' } },
      value,
      node: { type: 'element', content: { elementType: 'container', children } },
    },
  })
  const listOf = (dataSourceId: string, table: string) => ({
    type: 'data-source-list',
    content: {
      renderPropIdentifier: `${table}Items`,
      resourceDefinition: { type: 'external-data-source', dataSourceId, tableName: table },
      resource: { params: {} },
      nodes: { success: { type: 'cms-list-repeater', content: { paginated: true, perPage: 10 } } },
    },
  })

  it("a row-owned (self-guarded) details page makes its table its owner's, never public (I3)", () => {
    const uidl = {
      name: 'p',
      root: {
        name: 'App',
        stateDefinitions: {
          route: {
            type: 'string',
            defaultValue: 'home',
            values: [
              { value: 'home', pageOptions: { navLink: '/' } },
              {
                value: 'application',
                pageOptions: {
                  navLink: '/applications/[id]',
                  dynamicRouteAttribute: 'id',
                  detailsPageInfo: {
                    dataSourceId: 'ds',
                    dataSourceName: 'db',
                    dataSourceType: 'teleport',
                    tableName: 'job_applications',
                    differentiatorColumn: 'id',
                    featureIdentifier: 'x',
                  },
                },
              },
            ],
          },
        },
        node: {
          type: 'element',
          content: {
            elementType: 'container',
            children: [pageNode('home', []), pageNode('application', [])],
          },
        },
      },
      authentication: {
        enabled: true,
        roles: ['user'],
        pageProtection: {
          application: {
            requiresAuth: true,
            allowedRoles: [],
            pageName: 'application',
            route: '/applications',
            rowOwnerColumn: 'user_id',
            rowOwnerTable: 'job_applications',
            rowOwnerDataSourceId: 'ds',
            rowOwnerDifferentiator: 'id',
          },
        },
        folderProtection: {},
        authPages: {},
      },
    } as unknown as ProjectUIDL
    expect(resolveDataExposure(uidl).tables['ds:job_applications']).toMatchObject({
      public: false,
      anySession: false,
      roles: [],
      ownerRules: [{ column: 'user_id' }],
    })
  })

  it('keys a table by its data source: a public table of one source never opens the same name of another (I7)', () => {
    const uidl = {
      name: 'p',
      root: {
        name: 'App',
        stateDefinitions: {
          route: {
            type: 'string',
            defaultValue: 'home',
            values: [
              { value: 'home', pageOptions: { navLink: '/' } },
              { value: 'staff', pageOptions: { navLink: '/staff' } },
            ],
          },
        },
        node: {
          type: 'element',
          content: {
            elementType: 'container',
            children: [
              pageNode('home', [listOf('ds-rest', 'orders')]),
              pageNode('staff', [listOf('ds-pg', 'orders')]),
            ],
          },
        },
      },
      authentication: {
        enabled: true,
        roles: ['staff'],
        pageProtection: {
          staff: {
            requiresAuth: true,
            allowedRoles: ['staff'],
            pageName: 'staff',
            route: '/staff',
          },
        },
        folderProtection: {},
        authPages: {},
      },
    } as unknown as ProjectUIDL
    const exposure = resolveDataExposure(uidl)
    expect(readExposureFor(exposure, { tableName: 'orders', dataSourceId: 'ds-rest' }).public).toBe(
      true
    )
    expect(readExposureFor(exposure, { tableName: 'orders', dataSourceId: 'ds-pg' })).toMatchObject(
      {
        public: false,
        roles: ['staff'],
      }
    )
    // Asked without a source, two candidates answer nothing.
    expect(readExposureFor(exposure, { tableName: 'orders' })).toBe(CLOSED_READ_EXPOSURE)
  })

  it('is decided from the page bindings even when the UIDL lists no data source (I8)', () => {
    const uidl = {
      name: 'p',
      dataSources: {},
      root: {
        name: 'App',
        stateDefinitions: {
          route: {
            type: 'string',
            defaultValue: 'home',
            values: [{ value: 'home', pageOptions: { navLink: '/' } }],
          },
        },
        node: {
          type: 'element',
          content: {
            elementType: 'container',
            children: [pageNode('home', [listOf('ds-managed', 'teleport_products')])],
          },
        },
      },
    } as unknown as ProjectUIDL
    expect(
      readExposureFor(resolveDataExposure(uidl), {
        tableName: 'teleport_products',
        dataSourceId: 'ds-managed',
      }).public
    ).toBe(true)
  })

  it('remembers the fields a binding names, so a request may name them too (C1)', () => {
    const catalog = listOf('ds', 'catalog') as any
    catalog.content.resource.params = {
      queryColumns: { type: 'static', content: ['title', 'summary'] },
      sorts: { type: 'static', content: [{ field: 'published_on', order: 'desc' }] },
      filters: {
        type: 'expr',
        content:
          'JSON.stringify([{"type":"condition","source":"region","destination":state.region,"operand":"="}])',
      },
    }
    const uidl = {
      name: 'p',
      root: {
        name: 'App',
        stateDefinitions: {
          route: {
            type: 'string',
            defaultValue: 'home',
            values: [{ value: 'home', pageOptions: { navLink: '/' } }],
          },
        },
        node: {
          type: 'element',
          content: { elementType: 'container', children: [pageNode('home', [catalog])] },
        },
      },
    } as unknown as ProjectUIDL
    expect(resolveDataExposure(uidl).tables['ds:catalog'].fields).toEqual(
      expect.arrayContaining(['title', 'summary', 'published_on', 'region'])
    )
  })
})

describe("fix round 3: row-owned pages by the middleware's own patterns (N10), managed sources (N6)", () => {
  const pageNode = (value: string) => ({
    type: 'conditional',
    content: {
      reference: { type: 'dynamic', content: { referenceType: 'state', id: 'route' } },
      value,
      node: { type: 'element', content: { elementType: 'container', children: [] as unknown[] } },
    },
  })
  const uidlServing = (navLink: string, protection: Record<string, unknown>) =>
    ({
      name: 'p',
      root: {
        name: 'App',
        stateDefinitions: {
          route: {
            type: 'string',
            defaultValue: 'home',
            values: [
              { value: 'home', pageOptions: { navLink: '/' } },
              {
                value: 'application',
                pageOptions: {
                  navLink,
                  dynamicRouteAttribute: 'slug',
                  detailsPageInfo: {
                    dataSourceId: 'ds',
                    dataSourceName: 'db',
                    dataSourceType: 'teleport',
                    tableName: 'job_applications',
                    differentiatorColumn: 'id',
                    featureIdentifier: 'x',
                  },
                },
              },
            ],
          },
        },
        node: {
          type: 'element',
          content: {
            elementType: 'container',
            children: [pageNode('home'), pageNode('application')],
          },
        },
      },
      authentication: {
        enabled: true,
        roles: ['user'],
        pageProtection: {
          application: {
            requiresAuth: true,
            allowedRoles: [],
            pageName: 'application',
            rowOwnerColumn: 'user_id',
            rowOwnerTable: 'job_applications',
            rowOwnerDataSourceId: 'ds',
            rowOwnerDifferentiator: 'id',
            ...protection,
          },
        },
        folderProtection: {},
        authPages: {},
      },
    } as unknown as ProjectUIDL)

  it("a route pattern the page names differently (another param, another base) still makes the table its owner's", () => {
    // The middleware self-guards `/me/applications/[id]`, which serves
    // `/me/applications/[slug]` too; the protection's own route is `/me`.
    const uidl = uidlServing('/me/applications/[slug]', {
      route: '/me',
      routePattern: '/me/applications/[id]',
    })
    expect(resolveDataExposure(uidl).tables['ds:job_applications']).toMatchObject({
      public: false,
      ownerRules: [{ column: 'user_id' }],
    })
  })

  it('a page the middleware does not self-guard there is not row-owned there', () => {
    // The pattern `/applications/[id]` never serves `/jobs/[slug]`.
    const uidl = uidlServing('/jobs/[slug]', {
      route: '/applications',
      routePattern: '/applications/[id]',
    })
    expect(resolveDataExposure(uidl).tables['ds:job_applications'].ownerRules).toBeUndefined()
  })

  it('names the TeleportHQ sources as the managed database the data API reads', () => {
    expect(
      managedDataSourceIds({
        dataSources: {
          'ds-tq': { id: 'ds-tq', type: 'teleport' },
          'ds-mysql': { id: 'ds-mysql', type: 'mysql' },
          'ds-tq-2': { type: 'teleport' },
        },
      })
    ).toEqual(['ds-tq', 'ds-tq-2'])
    expect(managedDataSourceIds({})).toEqual([])
  })
})

/**
 * A component is not a page: what it fetches for itself has no protection of
 * its own, so it takes the protection of the pages it is placed on. Whoever may
 * open one of them may read it; nobody else.
 */
describe('who may read what a component fetches for itself', () => {
  const DB = 'ds'
  const pageNode = (value: string, children: unknown[]) => ({
    type: 'conditional',
    content: {
      reference: { type: 'dynamic', content: { referenceType: 'state', id: 'route' } },
      value,
      node: { type: 'element', content: { elementType: 'container', children } },
    },
  })
  // A component as the UIDL names it: by its key.
  const placed = (key: string) => ({
    type: 'element',
    content: { elementType: 'component', semanticType: key, dependency: { type: 'local' } },
  })
  const component = (name: string, children: unknown[] = []) => ({
    name,
    node: { type: 'element', content: { elementType: 'container', children } },
  })
  const tableList = (table: string) => ({
    type: 'data-source-list',
    content: {
      renderPropIdentifier: `${table}Items`,
      resourceDefinition: { type: 'external-data-source', dataSourceId: DB, tableName: table },
      resource: { params: {} },
      nodes: { success: { type: 'cms-list-repeater', content: { paginated: true, perPage: 10 } } },
    },
  })

  const PAGES: Array<[string, string]> = [
    ['home', '/'],
    ['account', '/account'],
    ['staff', '/staff'],
    ['lessons', '/lessons'],
    ['application', '/applications/[id]'],
    ['admin/orders', '/admin/orders'],
    ['admin/stock', '/admin/stock'],
  ]

  const buildProject = (
    placements: Record<string, unknown[]>,
    components: Record<string, unknown>,
    layout: unknown[] = []
  ): ProjectUIDL =>
    ({
      name: 'p',
      root: {
        name: 'App',
        stateDefinitions: {
          route: {
            type: 'string',
            defaultValue: 'home',
            values: PAGES.map(([value, navLink]) => ({
              value,
              pageId: `id-${value}`,
              pageOptions: { navLink },
            })),
          },
        },
        node: {
          type: 'element',
          content: {
            elementType: 'container',
            children: [
              ...PAGES.map(([value]) => pageNode(value, placements[value] || [])),
              ...layout,
            ],
          },
        },
      },
      components,
      authentication: {
        enabled: true,
        roles: ['admin', 'staff', 'user'],
        pageProtection: {
          'id-account': { requiresAuth: true, allowedRoles: [], route: '/account' },
          'id-staff': { requiresAuth: true, allowedRoles: ['staff'], route: '/staff' },
          'id-lessons': {
            requiresAuth: true,
            allowedRoles: [],
            route: '/lessons',
            requiresSubscription: true,
            subscriptionProductIds: ['plan-pro'],
          },
          'id-application': {
            requiresAuth: true,
            allowedRoles: [],
            route: '/applications',
            rowOwnerColumn: 'user_id',
            rowOwnerTable: 'job_applications',
            rowOwnerDataSourceId: DB,
            rowOwnerDifferentiator: 'id',
          },
          'id-admin/orders': {
            requiresAuth: true,
            allowedRoles: ['admin'],
            route: '/admin/orders',
          },
          'id-admin/stock': { requiresAuth: true, allowedRoles: ['admin'], route: '/admin/stock' },
        },
        folderProtection: {},
        authPages: {},
      },
    } as unknown as ProjectUIDL)

  const readersOf = (uidl: ProjectUIDL, name: string) =>
    componentExposureFor(resolveDataExposure(uidl), name)

  it('every visitor, when a page every visitor may open renders it', () => {
    const uidl = buildProject({ home: [placed('hero')] }, { hero: component('hero') })

    expect(readersOf(uidl, 'hero')).toEqual({ public: true, pages: [], readsAsStore: false })
  })

  it('only the sessions of the protected page that renders it', () => {
    const uidl = buildProject(
      { account: [placed('notes')], staff: [placed('rota')], lessons: [placed('lesson-list')] },
      {
        notes: component('notes'),
        rota: component('rota'),
        'lesson-list': component('lesson-list'),
      }
    )

    expect(readersOf(uidl, 'notes')).toEqual({
      public: false,
      pages: [{ allowedRoles: [] }],
      readsAsStore: false,
    })
    expect(readersOf(uidl, 'rota')).toEqual({
      public: false,
      pages: [{ allowedRoles: ['staff'] }],
      readsAsStore: false,
    })
    expect(readersOf(uidl, 'lesson-list')).toEqual({
      public: false,
      pages: [
        { allowedRoles: [], requiresSubscription: true, subscriptionProductIds: ['plan-pro'] },
      ],
      readsAsStore: false,
    })
  })

  it('whoever one of its pages admits, when several render it — and every visitor once one of them is open to all', () => {
    const onTwoProtected = buildProject(
      { account: [placed('badge')], staff: [placed('badge')] },
      { badge: component('badge') }
    )
    expect(readersOf(onTwoProtected, 'badge').pages).toEqual([
      { allowedRoles: ['staff'] },
      { allowedRoles: [] },
    ])

    const alsoOnHome = buildProject(
      { home: [placed('badge')], staff: [placed('badge')] },
      { badge: component('badge') }
    )
    expect(readersOf(alsoOnHome, 'badge')).toEqual({ public: true, pages: [], readsAsStore: false })
  })

  it('counts two pages that demand the same once', () => {
    const uidl = buildProject(
      { 'admin/orders': [placed('totals')], 'admin/stock': [placed('totals')] },
      { totals: component('totals') }
    )

    expect(readersOf(uidl, 'totals').pages).toEqual([{ allowedRoles: ['admin'] }])
  })

  it('follows a component into the components it renders', () => {
    const uidl = buildProject(
      { staff: [placed('board')] },
      { board: component('board', [placed('card')]), card: component('card', [placed('board')]) }
    )

    expect(readersOf(uidl, 'card').pages).toEqual([{ allowedRoles: ['staff'] }])
  })

  it('every visitor for the layout every page shares, and for a row-owned page the middleware lets through', () => {
    const uidl = buildProject(
      { staff: [placed('footer')], application: [placed('steps')] },
      { footer: component('footer'), steps: component('steps') },
      [{ type: 'element', content: { elementType: 'container', children: [placed('footer')] } }]
    )

    expect(readersOf(uidl, 'footer').public).toBe(true)
    expect(readersOf(uidl, 'steps').public).toBe(true)
  })

  it('no browser at all for a component no page renders, or one nothing decided', () => {
    const uidl = buildProject({}, { orphan: component('orphan') })

    expect(readersOf(uidl, 'orphan')).toBe(CLOSED_COMPONENT_EXPOSURE)
    expect(readersOf(uidl, 'unknown')).toBe(CLOSED_COMPONENT_EXPOSURE)
    expect(componentExposureFor(undefined, 'orphan')).toBe(CLOSED_COMPONENT_EXPOSURE)
    expect(componentExposureFor(resolveDataExposure(uidl), undefined)).toBe(
      CLOSED_COMPONENT_EXPOSURE
    )
    expect(CLOSED_COMPONENT_EXPOSURE).toEqual({ public: false, pages: [], readsAsStore: false })
  })

  it('reads as the store only when every page that renders it does', () => {
    const adminOnly = buildProject(
      { 'admin/orders': [placed('totals')] },
      { totals: component('totals') }
    )
    expect(readersOf(adminOnly, 'totals')).toEqual({
      public: false,
      pages: [{ allowedRoles: ['admin'] }],
      readsAsStore: true,
    })

    const alsoForMembers = buildProject(
      { 'admin/orders': [placed('totals')], account: [placed('totals')] },
      { totals: component('totals') }
    )
    expect(readersOf(alsoForMembers, 'totals').readsAsStore).toBe(false)
  })

  it('is public for every component of a project without authentication', () => {
    const uidl = buildProject({ staff: [placed('rota')] }, { rota: component('rota') }) as any
    delete uidl.authentication

    expect(readersOf(uidl, 'rota')).toEqual({ public: true, pages: [], readsAsStore: false })
  })

  // THE DEFECT: the project generator resolves the local dependencies before the
  // exposure is read, and writes the component's CLASS name over the element's
  // `semanticType` (`product-card` → `ProductCard`). The walk looked the element
  // up among the component KEYS only, so a component named as every real
  // project names them was taken for one no page renders: a table bound only
  // inside it was closed, and a visitor of a public page was refused its rows.
  describe('once the project generator resolved the local dependencies', () => {
    const resolved = (className: string, path: string) => ({
      type: 'element',
      content: {
        elementType: 'component',
        semanticType: className,
        dependency: { type: 'local', path },
      },
    })
    const withClassName = (name: string, className: string, children: unknown[] = []) => ({
      ...component(name, children),
      outputOptions: { componentClassName: className, fileName: name },
    })

    it('THE DEFECT: still finds a component named by its class, and the tables it binds', () => {
      const uidl = buildProject(
        { home: [resolved('ProductCard', '../components/product-card')] },
        { 'product-card': withClassName('product-card', 'ProductCard', [tableList('reviews')]) }
      )
      const exposure = resolveDataExposure(uidl)

      expect(exposure.tables['ds:reviews']).toMatchObject({ public: true })
      expect(componentExposureFor(exposure, 'product-card').public).toBe(true)
    })

    it('keeps a component behind its protected page', () => {
      const uidl = buildProject(
        { staff: [resolved('StaffRota', '../components/staff-rota')] },
        { 'staff-rota': withClassName('staff-rota', 'StaffRota', [tableList('staff_rotas')]) }
      )
      const exposure = resolveDataExposure(uidl)

      expect(exposure.tables['ds:staff_rotas']).toMatchObject({
        public: false,
        anySession: false,
        roles: ['staff'],
      })
      expect(componentExposureFor(exposure, 'staff-rota').pages).toEqual([
        { allowedRoles: ['staff'] },
      ])
    })

    it('never takes a class name for the key another component has', () => {
      // `Card` is one component's key and — resolved — the other one's class.
      const components = {
        Card: withClassName('Card', 'Card1', [tableList('staff_rotas')]),
        card: withClassName('card', 'Card', [tableList('reviews')]),
      }
      const exposure = resolveDataExposure(
        buildProject({ home: [resolved('Card', '../components/card')] }, components)
      )

      expect(componentExposureFor(exposure, 'card').public).toBe(true)
      expect(componentExposureFor(exposure, 'Card')).toBe(CLOSED_COMPONENT_EXPOSURE)
      expect(exposure.tables['ds:reviews']).toMatchObject({ public: true })
      expect(exposure.tables['ds:staff_rotas']).toBeUndefined()

      // Unresolved, the same name is the key.
      const unresolved = resolveDataExposure(buildProject({ home: [placed('Card')] }, components))
      expect(componentExposureFor(unresolved, 'Card').public).toBe(true)
      expect(componentExposureFor(unresolved, 'card')).toBe(CLOSED_COMPONENT_EXPOSURE)
    })
  })
})
