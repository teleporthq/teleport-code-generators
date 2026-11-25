/* tslint:disable:function-constructor */
import type { DataReadExposure, ProjectDataExposure } from '@teleporthq/teleport-types'
import { DataExposure } from '@teleporthq/teleport-shared'
import { generateDataSourceFetcherWithCore } from '../src/data-source-fetchers'
import { RELATED_NAMES_CONFIG_KEY, relatedNamesOf } from '../src/fetchers/utils/related-names'
import { RAW_ROWS_PARAM } from '../src/transformations'
import {
  isSecurityRuntimeSpecifier,
  loadSecurityRuntime,
} from '../../teleport-plugin-next-workflows/__tests__/_helpers/load-security-runtime'

const securityRuntime = loadSecurityRuntime()

/**
 * A table whose data source declares, per foreign key, the related record and
 * the column that names it: a read for the store's own server code or for a
 * trusted reader (the generated admin) gives each row `<column>__name`, read
 * in ONE keyed statement over the rows' keys. These run the EMITTED route.
 */

const SECRET = 'server-secret'
const ADMIN_ROLES = ['admin']

const ORDER_8 = '6f0c2a54-6a7e-4c8f-9a51-1d2e3f405162'
const ORDER_9 = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const ORDER_DELETED = '00000000-0000-4000-8000-000000000000'

interface Executed {
  sql: string
  params: unknown[] | undefined
}

interface RouteAnswer {
  status: number
  body: any
  executed: Executed[]
}

interface Scenario {
  /** The table read, and the related table its foreign key names. */
  table: string
  column: string
  relatedTable: string
  displayColumn: string
  /** The related records that exist, by key. */
  related: Record<string, string>
  rows: Array<Record<string, unknown>>
}

const columnsOf = (names: string[], types: Record<string, string> = {}) =>
  names.map((name) => ({ name, type: types[name] || 'VARCHAR(255)' }))

const exposureFor = (
  table: string,
  read: Partial<DataReadExposure>
): { dataExposure: ProjectDataExposure } => {
  const tables: Record<string, DataReadExposure> = {
    [DataExposure.tableExposureKey(null, table)]: {
      public: false,
      anySession: false,
      roles: [],
      defaultLimit: DataExposure.BROWSER_READ_DEFAULT_LIMIT,
      maxLimit: DataExposure.BROWSER_READ_MAX_LIMIT,
      ...read,
    },
  }
  return { dataExposure: { tables, dataSources: {} } }
}

const quiet = (): undefined => undefined

function bootRoute(
  scenario: Scenario,
  options: {
    type?: 'teleport' | 'postgresql'
    exposure?: Partial<DataReadExposure>
    declare?: unknown
    failNames?: boolean
  } = {}
) {
  const type = options.type || 'teleport'
  const declared = options.declare ?? [
    {
      column: scenario.column,
      table: scenario.relatedTable,
      matchColumn: 'id',
      displayColumn: scenario.displayColumn,
    },
  ]
  const dataSource = {
    id: 'ds-1',
    name: 'db',
    type,
    config: {
      ...(type === 'teleport'
        ? {
            host: 'teleporthq.secrets.TELEPORT_DB_HOST',
            user: 'teleporthq.secrets.TELEPORT_DB_USER',
            password: 'teleporthq.secrets.TELEPORT_DB_PASSWORD',
            database: 'teleporthq.secrets.TELEPORT_DB_NAME',
          }
        : { host: 'db.example.com', user: 'u', password: 'p', database: 'd' }),
      port: 5432,
      selectedTables: {
        [scenario.table]: {
          columns: columnsOf(['id', scenario.column, 'status', 'created_at'], {
            id: 'UUID',
            [scenario.column]: 'UUID',
          }),
        },
        [scenario.relatedTable]: {
          columns: columnsOf(['id', scenario.displayColumn, 'password'], { id: 'UUID' }),
        },
      },
      [RELATED_NAMES_CONFIG_KEY]: { [scenario.table]: declared },
    },
  }
  const esm = generateDataSourceFetcherWithCore(dataSource as never, scenario.table, false, {
    trustedReaderRoles: ADMIN_ROLES,
    ...exposureFor(scenario.table, options.exposure || { roles: ADMIN_ROLES }),
  })
  const code = esm
    .replace(
      "import { Client, types as pgTypes } from 'pg'",
      "const { Client, types: pgTypes } = require('pg')"
    )
    .replace(/^export default async function handler/m, 'async function handler')
    .replace(/^export \{[^}]*\}\s*$/m, '')
    .replace(/^export default \{[^}]*\}\s*$/m, '')
    .concat('\nmodule.exports = { handler: handler, fetchData: fetchData }')

  const executed: Executed[] = []
  let session: { role: string } | null = null
  class FakeClient {
    public async connect(): Promise<void> {
      return
    }
    public async end(): Promise<void> {
      return
    }
    public async query(sql: string, params?: unknown[]) {
      executed.push({ sql, params })
      if (/"lookup"/.test(sql)) {
        if (options.failNames) {
          throw new Error('relation does not exist')
        }
        const keys = ((params || [])[0] as string[]) || []
        const rows = keys
          .filter((key) => Object.prototype.hasOwnProperty.call(scenario.related, key))
          .map((key) => ({ lookup: 0, key, name: scenario.related[key] }))
        return { rows, rowCount: rows.length }
      }
      return { rows: scenario.rows.map((row) => ({ ...row })), rowCount: scenario.rows.length }
    }
  }
  const fakeRequire = (name: string): any => {
    if (name === 'pg') {
      return { Client: FakeClient, types: { setTypeParser: quiet } }
    }
    if (name === 'next-auth/jwt') {
      return { getToken: async () => (session ? { sub: 'u1', role: session.role } : null) }
    }
    if (isSecurityRuntimeSpecifier(name)) {
      return securityRuntime
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
        NEXTAUTH_SECRET: SECRET,
        TELEPORT_DB_HOST: 'h',
        TELEPORT_DB_USER: 'u',
        TELEPORT_DB_PASSWORD: 'p',
        TELEPORT_DB_NAME: 'd',
      },
    },
    { error: quiet, warn: quiet, log: quiet }
  )

  const read = async (
    request: {
      query?: Record<string, string>
      headers?: Record<string, string>
      session?: { role: string } | null
    } = {}
  ): Promise<RouteAnswer> => {
    executed.length = 0
    session = request.session || null
    let status = 0
    let body: any = null
    const res = {
      status(statusCode: number) {
        status = statusCode
        return res
      },
      json(payload: any) {
        body = payload
        return res
      },
    }
    await moduleObj.exports.handler(
      {
        method: 'GET',
        query: { page: '1', perPage: '10', ...(request.query || {}) },
        headers: {
          cookie: session ? 'next-auth.session-token=signed' : '',
          ...(request.headers || {}),
        },
      },
      res
    )
    return { status, body, executed: executed.slice() }
  }

  const serverRead = async (asVisitor = false): Promise<{ rows: any; executed: Executed[] }> => {
    executed.length = 0
    session = null
    const rows = await moduleObj.exports.fetchData(
      { page: 1, perPage: 10 },
      asVisitor ? { as: 'visitor' } : {}
    )
    return { rows, executed: executed.slice() }
  }

  return { read, serverRead, code }
}

const shipments = (rows: Array<Record<string, unknown>>): Scenario => ({
  table: 'teleport_shipments',
  column: 'order_id',
  relatedTable: 'teleport_orders',
  displayColumn: 'order_number',
  related: { [ORDER_8]: 'ORD-8', [ORDER_9]: 'ORD-9' },
  rows,
})

const ADMIN = { role: 'admin' }

describe('a list read names the related record of each foreign key', () => {
  const route = bootRoute(
    shipments([
      { id: 's1', order_id: ORDER_8, status: 'shipped' },
      { id: 's2', order_id: ORDER_9.toUpperCase(), status: 'shipped' },
      { id: 's3', order_id: ORDER_8, status: 'delivered' },
      { id: 's4', order_id: null, status: 'voided' },
    ])
  )

  it("gives an administrator's read each order's number, from one keyed statement", async () => {
    const answer = await route.read({ session: ADMIN })
    expect(answer.status).toBe(200)
    expect(answer.body.data.map((row: any) => [row.id, row.order_id__name])).toEqual([
      ['s1', 'ORD-8'],
      ['s2', 'ORD-9'],
      ['s3', 'ORD-8'],
      ['s4', null],
    ])
    // The row's own key stays: the cell links by it.
    expect(answer.body.data[0].order_id).toBe(ORDER_8)

    expect(answer.executed).toHaveLength(2)
    const [page, names] = answer.executed
    expect(page.sql).toMatch(/FROM teleport_shipments/)
    expect(names.sql).toBe(
      'SELECT 0 AS "lookup", CAST(x0."id" AS text) AS "key", CAST(x0."order_number" AS text) AS "name" ' +
        'FROM "teleport_orders" x0 WHERE x0."id" = ANY($1::uuid[])'
    )
    // Each key once, whatever the number of rows that hold it.
    expect(names.params).toEqual([[ORDER_8, ORDER_9]])
  })

  it('names nothing for a related record that no longer exists, and keeps its key', async () => {
    const deleted = bootRoute(shipments([{ id: 's9', order_id: ORDER_DELETED }]))
    const answer = await deleted.read({ session: ADMIN })
    expect(answer.body.data).toEqual([
      expect.objectContaining({ id: 's9', order_id: ORDER_DELETED, order_id__name: null }),
    ])
  })

  it("gives the store's own server code the names: a page's prefetch and a server segment", async () => {
    const prefetch = await route.serverRead()
    expect(prefetch.rows.map((row: any) => row.order_id__name)).toEqual([
      'ORD-8',
      'ORD-9',
      'ORD-8',
      null,
    ])
    const segment = await route.read({ headers: { 'x-internal-data-secret': SECRET } })
    expect(segment.body.data[1].order_id__name).toBe('ORD-9')
  })

  it("leaves the rows of an edit form's read as stored, with no second statement", async () => {
    const answer = await route.read({ session: ADMIN, query: { [RAW_ROWS_PARAM]: 'true' } })
    expect(answer.status).toBe(200)
    expect(answer.executed).toHaveLength(1)
    answer.body.data.forEach((row: any) => expect(row).not.toHaveProperty('order_id__name'))
  })

  it('serves the rows without names when the names cannot be read', async () => {
    const failing = bootRoute(shipments([{ id: 's1', order_id: ORDER_8 }]), { failNames: true })
    const answer = await failing.read({ session: ADMIN })
    expect(answer.status).toBe(200)
    expect(answer.body.data).toEqual([expect.objectContaining({ id: 's1', order_id: ORDER_8 })])
    expect(answer.body.data[0]).not.toHaveProperty('order_id__name')
  })

  it('reads nothing more for a page of rows without a key', async () => {
    const keyless = bootRoute(shipments([{ id: 's4', order_id: null }]))
    const answer = await keyless.read({ session: ADMIN })
    expect(answer.executed).toHaveLength(1)
    expect(answer.body.data[0].order_id__name).toBeNull()
  })

  it('is served the same by a Postgres source', async () => {
    const postgres = bootRoute(shipments([{ id: 's1', order_id: ORDER_9 }]), {
      type: 'postgresql',
    })
    const answer = await postgres.read({ session: ADMIN })
    expect(answer.status).toBe(200)
    expect(answer.body.data[0].order_id__name).toBe('ORD-9')
    expect(answer.executed).toHaveLength(2)
  })
})

describe('the four admin lists that name a related record', () => {
  const scenarios: Array<[string, Scenario, string]> = [
    ['Shipments: the order number', shipments([{ id: 'r1', order_id: ORDER_8 }]), 'ORD-8'],
    [
      'Activity Log: the order number',
      { ...shipments([{ id: 'r1', order_id: ORDER_9 }]), table: 'teleport_events' },
      'ORD-9',
    ],
    [
      "Shipping Rates: the zone's name",
      {
        table: 'teleport_shipping_rates',
        column: 'zone_id',
        relatedTable: 'teleport_shipping_zones',
        displayColumn: 'name',
        related: { [ORDER_8]: 'Europe' },
        rows: [{ id: 'r1', zone_id: ORDER_8 }],
      },
      'Europe',
    ],
    [
      "Blog Comments: the post's title",
      {
        table: 'teleport_blog_comments',
        column: 'post_id',
        relatedTable: 'teleport_blog_posts',
        displayColumn: 'title',
        related: { [ORDER_9]: 'Hello world' },
        rows: [{ id: 'r1', post_id: ORDER_9 }],
      },
      'Hello world',
    ],
  ]

  it.each(scenarios)('%s', async (_label, scenario, name) => {
    const answer = await bootRoute(scenario).read({ session: ADMIN })
    expect(answer.status).toBe(200)
    expect(answer.body.data[0][`${scenario.column}__name`]).toBe(name)
    expect(answer.executed).toHaveLength(2)
  })
})

describe('who is given the names', () => {
  // Shipping rates are read by visitors too: a checkout page every visitor opens binds them.
  const rates: Scenario = {
    table: 'teleport_shipping_rates',
    column: 'zone_id',
    relatedTable: 'teleport_shipping_zones',
    displayColumn: 'name',
    related: { [ORDER_8]: 'Internal: courier pilot' },
    rows: [{ id: 'r1', zone_id: ORDER_8, status: 'active' }],
  }
  const route = bootRoute(rates, { exposure: { public: true } })

  it('a visitor, a signed-in shopper and a visitor-view render get the rows as before', async () => {
    for (const session of [null, { role: 'user' }]) {
      const answer = await route.read({ session })
      expect(answer.status).toBe(200)
      expect(answer.executed).toHaveLength(1)
      expect(answer.body.data[0]).not.toHaveProperty('zone_id__name')
    }
    const render = await route.serverRead(true)
    expect(render.executed).toHaveLength(1)
    expect(render.rows[0]).not.toHaveProperty('zone_id__name')
  })

  it('an administrator reading the same table is given them', async () => {
    const answer = await route.read({ session: ADMIN })
    expect(answer.body.data[0].zone_id__name).toBe('Internal: courier pilot')
  })
})

describe('what a declaration may name', () => {
  const config = (declared: unknown[]) => ({
    selectedTables: {
      teleport_shipments: { columns: columnsOf(['id', 'order_id'], { order_id: 'UUID' }) },
      teleport_orders: {
        columns: columnsOf(['id', 'order_number', 'session_token'], { id: 'UUID' }),
      },
      users: { columns: columnsOf(['id', 'name', 'password', 'access_token']) },
      password_reset_tokens: { columns: columnsOf(['id', 'email']) },
    },
    [RELATED_NAMES_CONFIG_KEY]: { teleport_shipments: declared },
  })
  const declaration = (overrides: Record<string, unknown>) => ({
    column: 'order_id',
    table: 'teleport_orders',
    matchColumn: 'id',
    displayColumn: 'order_number',
    ...overrides,
  })

  it('takes a foreign key of the table naming a column of a table the source holds', () => {
    expect(relatedNamesOf(config([declaration({})]), 'teleport_shipments')).toEqual([
      {
        column: 'order_id',
        table: 'teleport_orders',
        matchColumn: 'id',
        displayColumn: 'order_number',
        field: 'order_id__name',
        uuidKey: true,
      },
    ])
    // A key column of another type is compared as text.
    expect(
      relatedNamesOf(
        config([declaration({ table: 'users', displayColumn: 'name' })]),
        'teleport_shipments'
      )[0].uuidKey
    ).toBe(false)
  })

  it('leaves out anything else', () => {
    for (const declared of [
      declaration({ column: 'customer_id' }),
      declaration({ table: 'teleport_gift_cards' }),
      declaration({ displayColumn: 'total' }),
      declaration({ displayColumn: 'session_token' }),
      declaration({ table: 'users', displayColumn: 'password' }),
      declaration({ table: 'users', displayColumn: 'access_token' }),
      declaration({ table: 'password_reset_tokens', displayColumn: 'email' }),
      declaration({ displayColumn: 'order_number" FROM users --' }),
      declaration({ table: 'Teleport_Orders' }),
      { column: 'order_id' },
    ]) {
      expect(relatedNamesOf(config([declared]), 'teleport_shipments')).toEqual([])
    }
  })

  it('emits nothing for a table that declares none', () => {
    const plain = bootRoute(shipments([{ id: 's1', order_id: ORDER_8 }]), { declare: [] })
    expect(plain.code).not.toContain('__rnWithRelatedNames')
  })
})
