/* tslint:disable:function-constructor no-any */
import { generateCommonJsSessionTokenResolverCode } from '../src/session-cookie-resolver'
import { generatePgClientCode } from '../src/pg-client-code'
import {
  generateAccountProfilePhotoRoute,
  PROFILE_PHOTO_UPLOAD_FOLDER,
  workflowsUploadIntoFolder,
} from '../src/account-profile-photo-route-generator'

/**
 * The route that deletes the profile photo a saved change replaced, run as the
 * generated site runs it, over a fake storage worker and a fake database. The
 * address it is given is whatever the member's row showed — which a member can
 * write — so only a file storage lists in the profile-photo folder, and that no
 * account still shows, may go.
 */

const OLD_PHOTO = 'aaaaaaaa-0000-4000-8000-000000000001'
const SHOWN_PHOTO = 'aaaaaaaa-0000-4000-8000-000000000002'
const PRODUCT_PHOTO = 'bbbbbbbb-0000-4000-8000-000000000003'
const STORAGE = 'https://storage.example'
const addressOf = (id: string) =>
  `https://storage.googleapis.com/scratch-bucket/project-1/${id}/photo.png`

interface Call {
  method: string
  url: string
}

function loadRoute(options: { configured?: boolean; shown?: string[] } = {}) {
  const calls: Call[] = []
  const queries: Array<{ sql: string; values: unknown[] }> = []
  const fetch = async (url: string, init: { method: string; headers: Record<string, string> }) => {
    calls.push({ method: init.method, url })
    expect(init.headers.Authorization).toBe('Bearer storage-key')
    if (init.method === 'GET') {
      const query = new URL(url).searchParams
      const named = (query.get('ids') || '').split(',')
      const inFolder = query.get('folder') === PROFILE_PHOTO_UPLOAD_FOLDER
      const files = inFolder ? named.filter((id) => id !== PRODUCT_PHOTO).map((id) => ({ id })) : []
      return { ok: true, status: 200, json: async () => ({ files }) }
    }
    return { ok: true, status: 200, json: async () => ({ success: true }) }
  }
  const shown = options.shown ?? [SHOWN_PHOTO]
  class Client {
    async connect(): Promise<void> {
      return undefined
    }
    async query(sql: string, values: unknown[]) {
      queries.push({ sql, values })
      const pattern = String(values[0])
      return { rows: shown.some((id) => pattern === `%/${id}/%`) ? [{ '?column?': 1 }] : [] }
    }
    async end(): Promise<void> {
      return undefined
    }
  }
  const security = { rateLimitRequest: async () => true }
  const resolver = generateCommonJsSessionTokenResolverCode('../../..', { withRevocation: false })
  const source = generateAccountProfilePhotoRoute({ withSessionRevocation: false })
  expect(source).toContain(resolver)
  const body = source
    .replace(generatePgClientCode(), 'var getClient = function () { return new Client(); };')
    .replace(resolver, 'async function __tqSessionToken(req) { return req.session; }')
    .replace('export default async function handler', 'module.exports = async function handler')
  const module = { exports: {} as any }
  const env =
    options.configured === false
      ? {}
      : {
          RUNTIME_STORAGE_URL: STORAGE,
          RUNTIME_STORAGE_API_KEY: 'storage-key',
          RUNTIME_STORAGE_PROJECT_ID: 'project-1',
        }
  new Function('require', 'module', 'exports', 'process', 'fetch', 'Client', body)(
    () => security,
    module,
    module.exports,
    { env },
    fetch,
    Client
  )
  return { handler: module.exports as (req: any, res: any) => Promise<void>, calls, queries }
}

async function post(
  handler: (req: any, res: any) => Promise<void>,
  params: { previous: unknown; session?: object | null; site?: string; method?: string }
) {
  const answer = { status: 0, json: null as any }
  const res = {
    setHeader: (): void => undefined,
    status(code: number) {
      answer.status = code
      return this
    },
    json(value: unknown) {
      answer.json = value
      return this
    },
  }
  await handler(
    {
      method: params.method ?? 'POST',
      headers: { 'sec-fetch-site': params.site ?? 'same-origin', host: 'site.example' },
      body: { previous: params.previous },
      session: params.session === undefined ? { id: 'member-1' } : params.session,
    },
    res
  )
  return answer
}

const deletedIds = (calls: Call[]) =>
  calls.filter((call) => call.method === 'DELETE').map((call) => call.url.split('/').pop())

describe('the replaced profile photo route', () => {
  it('deletes a profile photo of the folder that no account shows any more', async () => {
    const { handler, calls, queries } = loadRoute()
    const answer = await post(handler, { previous: addressOf(OLD_PHOTO) })
    expect(answer).toEqual({ status: 200, json: { success: true, deleted: 1 } })
    expect(deletedIds(calls)).toEqual([OLD_PHOTO])
    const listing = calls.find((call) => call.method === 'GET')!
    expect(listing.url).toBe(
      `${STORAGE}/project/project-1/files?folder=profile-photos&limit=1&ids=${OLD_PHOTO}`
    )
    expect(queries).toEqual([
      {
        sql: `SELECT 1 FROM "users" WHERE COALESCE(image, '') LIKE $1 LIMIT 1`,
        values: [`%/${OLD_PHOTO}/%`],
      },
    ])
  })

  it('keeps a photo another account still shows', async () => {
    const { handler, calls } = loadRoute()
    const answer = await post(handler, { previous: addressOf(SHOWN_PHOTO) })
    expect(answer.json).toEqual({ success: true, deleted: 0 })
    expect(deletedIds(calls)).toEqual([])
  })

  // A member can write any address into their row before a change.
  it('never deletes a file outside the profile-photo folder, nor reads a non-file address', async () => {
    const product = loadRoute()
    expect((await post(product.handler, { previous: addressOf(PRODUCT_PHOTO) })).json).toEqual({
      success: true,
      deleted: 0,
    })
    expect(deletedIds(product.calls)).toEqual([])

    for (const previous of [
      'https://example.com/not-a-file.png',
      'javascript:alert(1)',
      42,
      '',
      `https://storage.googleapis.com/b/p/${'a'.repeat(3000)}/x.png`,
    ]) {
      const route = loadRoute()
      expect((await post(route.handler, { previous })).json).toEqual({
        success: true,
        deleted: 0,
      })
      expect(route.calls).toEqual([])
    }
  })

  it('never touches storage for a visitor without a session or a call from another site', async () => {
    const guest = loadRoute()
    expect(
      (await post(guest.handler, { previous: addressOf(OLD_PHOTO), session: null })).status
    ).toBe(401)
    expect(guest.calls).toEqual([])

    const foreign = loadRoute()
    expect(
      (await post(foreign.handler, { previous: addressOf(OLD_PHOTO), site: 'cross-site' })).status
    ).toBe(403)
    expect(foreign.calls).toEqual([])

    const read = loadRoute()
    expect(
      (await post(read.handler, { previous: addressOf(OLD_PHOTO), method: 'GET' })).status
    ).toBe(405)
  })

  it('answers without touching anything when storage is not configured', async () => {
    const { handler, calls } = loadRoute({ configured: false })
    expect((await post(handler, { previous: addressOf(OLD_PHOTO) })).json).toEqual({
      success: true,
      deleted: 0,
    })
    expect(calls).toEqual([])
  })

  it('reads a custom auth table name', () => {
    expect(generateAccountProfilePhotoRoute({ authUsersTableName: 'members' })).toContain(
      'var USERS_TABLE = "members";'
    )
  })
})

describe('workflowsUploadIntoFolder', () => {
  const uploadNode = (folder?: string) => ({
    type: 'file-storage-upload',
    config: folder ? { folder } : {},
  })

  it('finds an upload into the folder in a workflow or a custom node', () => {
    expect(
      workflowsUploadIntoFolder(
        { workflows: { a: { nodes: [uploadNode(PROFILE_PHOTO_UPLOAD_FOLDER)] } } },
        PROFILE_PHOTO_UPLOAD_FOLDER
      )
    ).toBe(true)
    expect(
      workflowsUploadIntoFolder(
        { customNodes: { c: { nodes: [uploadNode(PROFILE_PHOTO_UPLOAD_FOLDER)] } } },
        PROFILE_PHOTO_UPLOAD_FOLDER
      )
    ).toBe(true)
  })

  it('is false for uploads elsewhere and for no workflows', () => {
    expect(
      workflowsUploadIntoFolder(
        { workflows: { a: { nodes: [uploadNode(), uploadNode('forum')] } } },
        PROFILE_PHOTO_UPLOAD_FOLDER
      )
    ).toBe(false)
    expect(workflowsUploadIntoFolder(undefined, PROFILE_PHOTO_UPLOAD_FOLDER)).toBe(false)
  })
})
