/* tslint:disable:function-constructor no-any */
import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import { ContentTables } from '@teleporthq/teleport-shared'
import uidlSample from '../../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../../src'
import NextTemplate from '../../src/project-template'

/**
 * A store-like and a blog-like project for the data-exposure tests: every kind
 * of page a generated site binds a table on, each behind the protection a real
 * site gives it.
 *
 *  - public pages: the shop (products), the blog (posts), the booking page
 *    (bookable items), a team page (a merchant's own table) and the about page,
 *    which binds a table only through a component it renders;
 *  - `/account`: any signed-in visitor (member notes);
 *  - `/staff`: the `staff` role only (staff rotas);
 *  - `/admin/orders`: the admin (orders).
 */

export const DATA_SOURCE_ID = 'ds-store-0001'
export const POSTS_TABLE = ContentTables.contentTablesByKey('blog').posts

export const PUBLIC_TABLES = [
  'teleport_products',
  POSTS_TABLE,
  'teleport_booking_items',
  'team_members',
  'testimonials',
]
export const MEMBER_TABLE = 'member_notes'
export const SUBSCRIBER_TABLE = 'premium_lessons'
export const OWNED_TABLE = 'job_applications'
export const SUBSCRIPTION_PRODUCT = 'plan-pro'
export const STAFF_TABLE = 'staff_rotas'
export const ADMIN_TABLE = 'teleport_orders'

const column = (name: string, type = 'text') => ({ name, type })

const ALL_TABLES = [
  ...PUBLIC_TABLES,
  MEMBER_TABLE,
  STAFF_TABLE,
  ADMIN_TABLE,
  SUBSCRIBER_TABLE,
  OWNED_TABLE,
]

const resourceIdOf = (tableName: string) => `TQ_${DATA_SOURCE_ID.replace(/-/g, '')}${tableName}`

const resourceItem = (tableName: string) => ({
  id: resourceIdOf(tableName),
  name: `fetch_${tableName}`,
  path: {
    baseUrl: { type: 'static', content: '/api/data-source' },
    route: { type: 'static', content: `/${DATA_SOURCE_ID}/${tableName}` },
  },
  params: {
    dataSourceId: { type: 'static', content: DATA_SOURCE_ID },
    dataSourceType: { type: 'static', content: 'teleport' },
    tableName: { type: 'static', content: tableName },
  },
})

const dataSourceListNode = (tableName: string, cache?: Record<string, unknown>) => ({
  type: 'data-source-list',
  content: {
    renderPropIdentifier: `${tableName}Items`,
    elementType: 'DataProvider',
    dependency: {
      type: 'package',
      path: '@teleporthq/react-components',
      version: 'latest',
      meta: { namedImport: true },
    },
    resourceDefinition: {
      type: 'external-data-source',
      dataSourceId: DATA_SOURCE_ID,
      tableName,
      dataSourceType: 'teleport',
    },
    resource: {
      id: resourceIdOf(tableName),
      params: { queryColumns: { type: 'static', content: ['name'] } },
    },
    valuePath: [] as string[],
    nodes: {
      success: {
        type: 'element',
        content: {
          elementType: 'fragment',
          // A paginated, searchable grid: the page re-reads its table through
          // the table's read route as the visitor pages and searches.
          children: [
            {
              type: 'cms-list-repeater',
              content: {
                elementType: 'cms-list-repeater',
                nodes: {
                  list: {
                    type: 'element',
                    content: {
                      elementType: 'text',
                      semanticType: 'p',
                      children: [{ type: 'expr', content: `${tableName}Context?.name` }],
                    },
                  },
                  empty: {
                    type: 'element',
                    content: {
                      elementType: 'container',
                      children: [{ type: 'static', content: '-' }],
                    },
                  },
                },
                source: `${tableName}Items || []`,
                renderPropIdentifier: `${tableName}Context`,
                nodeId: `TQ_list_${tableName}`,
                isCMSListRepeater: false,
                paginated: true,
                perPage: 12,
                searchEnabled: true,
                ...(cache ? { cache } : {}),
              },
            },
          ],
        },
      },
    },
  },
})

const page = (value: string, children: unknown[]) => ({
  type: 'conditional',
  content: {
    reference: { type: 'dynamic', content: { referenceType: 'state', id: 'route' } },
    value,
    node: {
      type: 'element',
      content: { elementType: 'container', children },
    },
  },
})

const route = (value: string, navLink: string, pageId: string) => ({
  value,
  pageId,
  seo: { title: value },
  pageOptions: { navLink, stateDefinitions: {}, propDefinitions: {} },
})

export interface DataExposureFixtureOptions {
  /** Turns the server data cache on for every list on every page. */
  serverCache?: boolean
}

export const buildDataExposureUidl = (options: DataExposureFixtureOptions = {}): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as any
  const cache = options.serverCache ? { enabled: true, server: true, ttlSeconds: 60 } : undefined
  const listNode = (tableName: string) => dataSourceListNode(tableName, cache)

  uidl.dataSources = {
    [DATA_SOURCE_ID]: {
      id: DATA_SOURCE_ID,
      name: 'TeleportHQ database',
      type: 'teleport',
      config: {
        selectedTables: Object.fromEntries(
          ALL_TABLES.map((table) => [
            table,
            {
              name: table,
              columns: [
                column('id', 'uuid'),
                column('name'),
                column('status'),
                column('user_id', 'uuid'),
              ],
            },
          ])
        ),
      },
    },
  }

  uidl.resources = {
    items: Object.fromEntries(
      ALL_TABLES.map((table) => [resourceIdOf(table), resourceItem(table)])
    ),
    resourceMappers: {},
  }

  uidl.components.Testimonials = {
    name: 'Testimonials',
    node: {
      type: 'element',
      content: { elementType: 'container', children: [listNode('testimonials')] },
    },
  }

  uidl.authentication = {
    enabled: true,
    dataSourceId: DATA_SOURCE_ID,
    dataSourceType: 'teleport',
    passwordAuthEnabled: true,
    providers: [],
    roles: ['admin', 'staff', 'member'],
    tables: {},
    pageProtection: {
      TQ_account: {
        requiresAuth: true,
        allowedRoles: [],
        pageName: 'account',
        route: '/account',
      },
      TQ_staff: {
        requiresAuth: true,
        allowedRoles: ['staff'],
        pageName: 'staff',
        route: '/staff',
      },
      TQ_admin_orders: {
        requiresAuth: true,
        allowedRoles: ['admin'],
        pageName: 'orders',
        route: '/admin/orders',
      },
      TQ_lessons: {
        requiresAuth: true,
        allowedRoles: [],
        pageName: 'lessons',
        route: '/lessons',
        requiresSubscription: true,
        subscriptionProductIds: [SUBSCRIPTION_PRODUCT],
      },
      // A row-owned details page: its own SQL is the gate, by the row's owner.
      TQ_applications: {
        requiresAuth: true,
        allowedRoles: [],
        pageName: 'application',
        route: '/applications',
        routePattern: '/applications/[id]',
        rowOwnerColumn: 'user_id',
        rowOwnerTable: OWNED_TABLE,
        rowOwnerDataSourceId: DATA_SOURCE_ID,
        rowOwnerDifferentiator: 'id',
      },
    },
    folderProtection: {},
    authPages: { signIn: { pageId: 'sign-in', pageName: 'sign-in', route: '/sign-in' } },
    callbackBaseUrl: '',
    envKeys: {},
    customUserProperties: [],
  }

  const routes = uidl.root.stateDefinitions.route.values
  const children = uidl.root.node.content.children
  const add = (value: string, navLink: string, pageId: string, nodes: unknown[]) => {
    routes.push(route(value, navLink, pageId))
    children.push(page(value, nodes))
  }

  add('shop', '/shop', 'TQ_shop', [listNode('teleport_products')])
  add('blog', '/blog', 'TQ_blog', [listNode(POSTS_TABLE)])
  add('book', '/book', 'TQ_book', [listNode('teleport_booking_items')])
  add('team', '/team', 'TQ_team', [listNode('team_members')])
  add('account', '/account', 'TQ_account', [listNode(MEMBER_TABLE)])
  add('staff', '/staff', 'TQ_staff', [listNode(STAFF_TABLE)])
  add('admin/orders', '/admin/orders', 'TQ_admin_orders', [listNode(ADMIN_TABLE)])
  add('lessons', '/lessons', 'TQ_lessons', [listNode(SUBSCRIBER_TABLE)])
  add('applications', '/applications/[id]', 'TQ_applications', [listNode(OWNED_TABLE)])

  // The about page renders the component, which binds a table of its own.
  const about = children.find((child: any) => child.content.value === 'about')
  about.content.node.content.children.push({
    type: 'element',
    content: {
      elementType: 'component',
      semanticType: 'Testimonials',
      dependency: { type: 'local' },
    },
  })

  return uidl as ProjectUIDL
}

export const generateDataExposureProject = async (
  options: DataExposureFixtureOptions = {}
): Promise<GeneratedFolder> => {
  const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder
  return createNextProjectGenerator().generateProject(
    buildDataExposureUidl(options) as any,
    template
  )
}

export const folderAt = (root: GeneratedFolder, path: string[]): GeneratedFolder | undefined =>
  path.reduce<GeneratedFolder | undefined>(
    (folder, name) => folder?.subFolders.find((sub) => sub.name === name),
    root
  )

export const fileText = (root: GeneratedFolder, path: string[], name: string): string | null => {
  const folder = folderAt(root, path)
  const file = folder?.files.find((entry) => entry.name === name)
  return file ? file.content : null
}

export interface RouteCall {
  query?: Record<string, string>
  session?: { role?: string; id?: string } | null
  /** Whether the session's user holds an entitled subscription (the entitlement query's answer). */
  entitled?: boolean
  headers?: Record<string, string>
}

export interface RouteReply {
  status: number
  body: any
  queries: string[]
  /** The values bound to each query, in order. */
  params: unknown[][]
}

/**
 * The read route a generated page fetches its table from, booted from the
 * generated files: `pages/api/<file>.js` (inline, or re-exporting the
 * `utils/data-sources/<file>.js` module), run against a fake `pg` that answers
 * every SELECT with `rows`, and a fake session.
 */
export const bootReadRoute = (
  root: GeneratedFolder,
  fileName: string,
  rows: any[] = [{ id: 'r1', name: 'Row', status: 'active', password: 'hash-x' }]
): ((call?: RouteCall) => Promise<RouteReply>) => {
  const apiSource = fileText(root, ['pages', 'api'], fileName)
  if (apiSource === null) {
    throw new Error('no route pages/api/' + fileName)
  }
  const reExport = /import dataSourceModule from '\.\.\/\.\.\/utils\/data-sources\/([^']+)'/.exec(
    apiSource
  )
  const moduleSource = reExport ? fileText(root, ['utils', 'data-sources'], reExport[1]) : apiSource
  if (moduleSource === null) {
    throw new Error('no module for ' + fileName)
  }
  const code = moduleSource
    .replace(
      "import { Client, types as pgTypes } from 'pg'",
      "const { Client, types: pgTypes } = require('pg')"
    )
    .replace(/^import .*$/gm, '')
    .replace(/^export default async function handler/m, 'async function handler')
    .replace(/^export \{[^}]*\}\s*$/m, '')
    .replace(/^export default \{[^}]*\}\s*$/m, '')
    .replace(/^export default \w+\s*$/m, '')
    .concat(
      '\nmodule.exports = {' +
        ' handler: typeof cachedHandler !== "undefined" ? cachedHandler : handler,' +
        ' getCount: typeof cachedGetCount !== "undefined" ? cachedGetCount : (typeof getCount !== "undefined" ? getCount : null)' +
        ' }'
    )
  const exported = /export default dataSourceModule\.getCount/.test(apiSource)
    ? 'getCount'
    : 'handler'

  const queries: string[] = []
  const params: unknown[][] = []
  let session: RouteCall['session'] = null
  let entitled = false
  class FakeClient {
    public async connect(): Promise<void> {
      return
    }
    public async end(): Promise<void> {
      return
    }
    public async query(
      sql: string,
      values?: unknown[]
    ): Promise<{ rows: any[]; rowCount: number }> {
      queries.push(sql)
      params.push(values || [])
      if (/information_schema/i.test(sql)) {
        return { rows: [], rowCount: 0 }
      }
      if (/^SELECT COUNT/i.test(sql)) {
        return { rows: [{ count: String(rows.length) }], rowCount: 1 }
      }
      if (/FROM teleport_subscriptions/i.test(sql)) {
        return entitled ? { rows: [{ '?column?': 1 }], rowCount: 1 } : { rows: [], rowCount: 0 }
      }
      return { rows: rows.map((row) => ({ ...row })), rowCount: rows.length }
    }
  }
  const fakeRequire = (name: string): any => {
    if (name === 'pg') {
      return { Client: FakeClient, types: { setTypeParser: (): void => undefined } }
    }
    if (name === 'next-auth/jwt') {
      return {
        getToken: async () =>
          session ? { sub: session.id || 'u1', id: session.id || 'u1', role: session.role } : null,
      }
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
    {
      env: {
        NEXTAUTH_SECRET: 'server-secret',
        TELEPORT_DB_HOST: 'h',
        TELEPORT_DB_USER: 'u',
        TELEPORT_DB_PASSWORD: 'p',
        TELEPORT_DB_NAME: 'd',
      },
    },
    { log: (): void => undefined, warn: (): void => undefined, error: (): void => undefined }
  )

  return async (call: RouteCall = {}) => {
    session = call.session || null
    entitled = call.entitled === true
    queries.length = 0
    params.length = 0
    const reply: RouteReply = { status: 0, body: null, queries, params }
    const res: any = {
      status(statusCode: number) {
        reply.status = statusCode
        return res
      },
      json(payload: any) {
        reply.body = payload
        return res
      },
      setHeader: (): void => undefined,
    }
    // A signed-in local request carries the plain session cookie (the only name
    // read on http; see teleport-shared session-cookie-resolver).
    const headers = {
      ...(session ? { cookie: 'next-auth.session-token=signed' } : {}),
      ...(call.headers || {}),
    }
    await moduleObj.exports[exported]({ method: 'GET', query: call.query || {}, headers }, res)
    return { ...reply, queries: [...queries], params: [...params] }
  }
}
