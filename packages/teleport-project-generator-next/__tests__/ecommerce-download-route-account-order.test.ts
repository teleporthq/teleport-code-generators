/* tslint:disable:function-constructor no-any */
import { UIDLEcommerceSettings } from '@teleporthq/teleport-types'
import {
  DOWNLOAD_CLAIM_QUERY,
  DOWNLOAD_ENTITLEMENT_QUERY,
  DOWNLOAD_ROUTE_ERRORS,
  generateDownloadApiRoute,
} from '../src/ecommerce/ecommerce-download-route-generator'

/**
 * Whether a digital order belongs to an ACCOUNT is decided by the route's own
 * statement (`account_order`, `TableAccess.registeredAccountEmailSql`): a
 * guest checkout files the order under the guest's id, whose `users` row is
 * the guest's anonymous one (`<uuid>@anonymous.local`), and that is no account.
 * A fake database answers that column from its fixture, so this spec runs the
 * statement the route sends on a real Postgres:
 *
 *   TELEPORT_TEST_POSTGRES_URL=postgresql://user@127.0.0.1:5432/postgres
 *   TELEPORT_TEST_PG_MODULE=/path/to/node_modules/pg   (codegen does not depend on pg)
 *
 * It makes a throwaway database there and drops it afterwards. Without both
 * variables it is skipped. The rest of the route (the entitlement, the claim,
 * the storage worker) is faked as in ecommerce-download-route.test.ts.
 */

const PG_URL = process.env.TELEPORT_TEST_POSTGRES_URL || ''
const loadPg = (): any => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return PG_URL ? require(process.env.TELEPORT_TEST_PG_MODULE || 'pg') : null
  } catch (error) {
    return null
  }
}
const pg = loadPg()
const describeOnPostgres = pg ? describe : describe.skip

const SETTINGS = {
  digitalProducts: { enabled: true, withdrawalExemption: false, revokeOnRefund: true },
} as unknown as UIDLEcommerceSettings

const GUEST = '5a1f0b9e-2222-4c4c-9a9a-00000000aaaa'
const MEMBER = '5a1f0b9e-2222-4c4c-9a9a-00000000bbbb'
const GUEST_ORDER = '4d2f6a0e-2222-4f3a-9e7d-0000000000a1'
const MEMBER_ORDER = '4d2f6a0e-2222-4f3a-9e7d-0000000000b2'
const FILE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const KEY = '7f1a3c2e-9b4d-4e8f-a1c2-3d4e5f607182'

const loadRoute = () => {
  const source = generateDownloadApiRoute(SETTINGS, 'teleport', {
    connectionString: 'postgres://x',
  })
  const body = source
    .replace(/const \{ Pool \} = require\('pg'\)[\s\S]*?\}\)\n/, '')
    .replace('export default async function handler', 'async function handler')
    .replace('export const config', 'const config')
  return new Function('require', `${body}\nreturn { serveDownload, claimDownload };`)(require)
}

const fakeResponse = () => {
  const state: { statusCode: number | null; body: unknown } = { statusCode: null, body: undefined }
  const res: any = {
    headersSent: false,
    setHeader: (): void => undefined,
    status: (code: number) => {
      state.statusCode = code
      return res
    },
    json: (payload: unknown) => {
      state.body = payload
      return res
    },
    write: () => {
      res.headersSent = true
      return true
    },
    end: () => res,
    destroy: (): void => undefined,
    on: (): void => undefined,
    once: (): void => undefined,
  }
  return { res, state }
}

describeOnPostgres('the download route asks Postgres whose order it is (C1 r2)', () => {
  const database = `tq_download_account_${process.pid}_${Date.now()}`
  let admin: any
  let client: any
  const orderStatements: string[] = []

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: PG_URL })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${database}`)
    const url = new URL(PG_URL)
    url.pathname = `/${database}`
    client = new pg.Client({ connectionString: url.toString() })
    await client.connect()
    await client.query('CREATE TABLE users (id uuid PRIMARY KEY, email text UNIQUE)')
    await client.query(
      'CREATE TABLE teleport_orders (id uuid PRIMARY KEY, user_id uuid REFERENCES users(id), ' +
        'status text, payment_status text, download_key text)'
    )
    // What "Resolve Current User" writes for a guest, and a registered buyer.
    await client.query('INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)', [
      GUEST,
      `${GUEST}@anonymous.local`,
      MEMBER,
      'member@shop.test',
    ])
    await client.query(
      "INSERT INTO teleport_orders VALUES ($1, $2, 'confirmed', 'paid', $5), ($3, $4, 'confirmed', 'paid', $5)",
      [GUEST_ORDER, GUEST, MEMBER_ORDER, MEMBER, KEY]
    )
  }, 30000)

  afterAll(async () => {
    if (client) {
      await client.end()
    }
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${database}`)
      await admin.end()
    }
  })

  const download = async (orderId: string, session: Record<string, unknown> | null) => {
    const api = loadRoute()
    const { res, state } = fakeResponse()
    const row = {
      order_id: orderId,
      payment_status: 'paid',
      status: 'confirmed',
      created_at: '2026-09-20T10:00:00.000Z',
      user_id: orderId === GUEST_ORDER ? GUEST : MEMBER,
      order_item_id: 'line-1',
      download_limit: '3',
      download_expiry_days: null as string | null,
      file_id: FILE_ID,
      file_name: 'presets.zip',
      storage_file_id: 'storage-9',
      content_type: 'application/zip',
      downloads: '0',
    }
    const query = async (text: string, params: unknown[] = []) => {
      // The order statement the route sends runs on Postgres, as written.
      if (/AS account_order/.test(text)) {
        orderStatements.push(text)
        return client.query(text, params)
      }
      if (text === DOWNLOAD_ENTITLEMENT_QUERY) {
        return { rows: [row] }
      }
      if (text === DOWNLOAD_CLAIM_QUERY) {
        return { rows: [{ id: 'download-1' }] }
      }
      return { rows: [] }
    }
    const pool = { query, connect: async () => ({ query, release: (): void => undefined }) }
    await api.serveDownload(
      {
        method: 'GET',
        query: { fileId: FILE_ID, order: orderId, key: KEY },
        headers: { 'x-forwarded-for': '203.0.113.9' },
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
      {
        env: {
          NEXTAUTH_SECRET: 'nextauth-secret',
          RUNTIME_STORAGE_URL: 'https://storage.example.com/',
          RUNTIME_STORAGE_API_KEY: 'key',
          RUNTIME_STORAGE_PROJECT_ID: 'project-1',
        },
        now: () => Date.parse('2026-09-23T10:00:00.000Z'),
        sessionToken: async () => session,
        query,
        claim: (claimParams: unknown[]) => api.claimDownload(pool, claimParams),
        fetch: async () => ({
          ok: true,
          status: 200,
          headers: { get: (name: string) => (name === 'content-type' ? 'application/zip' : null) },
          body: {
            getReader: () => ({
              read: async () => ({ done: true, value: undefined as unknown }),
              cancel: async (): Promise<void> => undefined,
            }),
            cancel: async (): Promise<void> => undefined,
          },
        }),
      }
    )
    return state
  }

  it("serves a guest's order on its key alone: the guest's anonymous users row is no account", async () => {
    const state = await download(GUEST_ORDER, null)
    expect(state.statusCode).toBe(200)
    expect(orderStatements.length).toBeGreaterThan(0)
  })

  it("a registered buyer's order still needs that buyer's session", async () => {
    const signedOut = await download(MEMBER_ORDER, null)
    expect(signedOut.statusCode).toBe(401)
    expect(signedOut.body).toEqual({ error: DOWNLOAD_ROUTE_ERRORS.SIGN_IN })
    const other = await download(MEMBER_ORDER, { id: GUEST })
    expect(other.statusCode).toBe(403)
    expect(other.body).toEqual({ error: DOWNLOAD_ROUTE_ERRORS.OTHER_ACCOUNT })
    expect((await download(MEMBER_ORDER, { id: MEMBER })).statusCode).toBe(200)
  })
})
