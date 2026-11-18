/* tslint:disable:function-constructor no-any */
import { SessionCookieResolver } from '@teleporthq/teleport-shared'
import { buildForumFilesRouteSource, FORUM_UPLOAD_FOLDER } from '../src/forum/files-route'
import { FORUM_ROUTE_ROOT } from '../src/forum/replies-route'

/**
 * The route that takes deleted posts' pictures out of runtime storage, run as
 * the generated site runs it, over a fake storage worker and a fake data
 * module. The ids it is given are member-written addresses: only a file the
 * storage lists in the forum's folder, and that no post still shows, may go.
 */

const FORUM_PICTURE = 'aaaaaaaa-0000-4000-8000-000000000001'
const FORUM_PICTURE_STILL_SHOWN = 'aaaaaaaa-0000-4000-8000-000000000002'
const PRODUCT_PHOTO = 'bbbbbbbb-0000-4000-8000-000000000003'
const STORAGE = 'https://storage.example'

interface Call {
  method: string
  url: string
}

function loadRoute(options: { configured?: boolean; shown?: string[] } = {}) {
  const calls: Call[] = []
  const fetch = async (url: string, init: { method: string; headers: Record<string, string> }) => {
    calls.push({ method: init.method, url })
    expect(init.headers.Authorization).toBe('Bearer storage-key')
    if (init.method === 'GET') {
      const query = new URL(url).searchParams
      const named = (query.get('ids') || '').split(',')
      const inForumFolder = query.get('folder') === FORUM_UPLOAD_FOLDER
      const files = inForumFolder
        ? named.filter((id) => id !== PRODUCT_PHOTO).map((id) => ({ id, folder: 'forum' }))
        : []
      return { ok: true, status: 200, json: async () => ({ files }) }
    }
    return { ok: true, status: 200, json: async () => ({ success: true }) }
  }
  const forum = {
    filesStillShown: async (ids: string[]) =>
      ids.filter((id) => (options.shown ?? [FORUM_PICTURE_STILL_SHOWN]).includes(id)),
  }
  const security = { rateLimitRequest: async () => true }
  const resolver = SessionCookieResolver.generateCommonJsSessionTokenResolverCode(
    FORUM_ROUTE_ROOT,
    { withRevocation: false }
  )
  const source = buildForumFilesRouteSource({ withSessionRevocation: false })
  expect(source).toContain(resolver)
  const body = source
    .replace(resolver, 'async function __tqSessionToken(req) { return req.session; }')
    .replace('export default async function handler', 'module.exports = async function handler')
  const module = { exports: {} as any }
  const fakeRequire = (name: string) => (name.includes('security') ? security : forum)
  const env =
    options.configured === false
      ? {}
      : {
          RUNTIME_STORAGE_URL: STORAGE,
          RUNTIME_STORAGE_API_KEY: 'storage-key',
          RUNTIME_STORAGE_PROJECT_ID: 'project-1',
        }
  new Function('require', 'module', 'exports', 'process', 'fetch', body)(
    fakeRequire,
    module,
    module.exports,
    { env },
    fetch
  )
  return { handler: module.exports as (req: any, res: any) => Promise<void>, calls }
}

async function post(
  handler: (req: any, res: any) => Promise<void>,
  params: { files: unknown; session?: object | null; site?: string; method?: string }
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
      body: { files: params.files },
      session: params.session === undefined ? { id: 'member-1' } : params.session,
    },
    res
  )
  return answer
}

const deletedIds = (calls: Call[]) =>
  calls.filter((call) => call.method === 'DELETE').map((call) => call.url.split('/').pop())

describe('the forum pictures route', () => {
  it('removes only the forum’s own pictures that no post shows any more', async () => {
    const { handler, calls } = loadRoute()
    const answer = await post(handler, {
      files: [FORUM_PICTURE, FORUM_PICTURE_STILL_SHOWN, PRODUCT_PHOTO, 'not-an-id', FORUM_PICTURE],
    })
    expect(answer.status).toBe(200)
    expect(answer.json).toEqual({ success: true, deleted: 1 })
    expect(deletedIds(calls)).toEqual([FORUM_PICTURE])
    const listing = calls.find((call) => call.method === 'GET')!
    expect(listing.url).toContain(`${STORAGE}/project/project-1/files?folder=forum`)
    expect(listing.url).not.toContain('not-an-id')
  })

  it('never touches storage for a visitor without a session or a call from another site', async () => {
    const guest = loadRoute()
    expect((await post(guest.handler, { files: [FORUM_PICTURE], session: null })).status).toBe(401)
    expect(guest.calls).toEqual([])

    const foreign = loadRoute()
    const answer = await post(foreign.handler, { files: [FORUM_PICTURE], site: 'cross-site' })
    expect(answer.status).toBe(403)
    expect(foreign.calls).toEqual([])

    const read = loadRoute()
    expect((await post(read.handler, { files: [FORUM_PICTURE], method: 'GET' })).status).toBe(405)
  })

  it('answers that nothing was removed when storage is not configured or nothing is named', async () => {
    const unconfigured = loadRoute({ configured: false })
    expect((await post(unconfigured.handler, { files: [FORUM_PICTURE] })).json).toEqual({
      success: true,
      deleted: 0,
    })
    expect(unconfigured.calls).toEqual([])

    const empty = loadRoute()
    expect((await post(empty.handler, { files: 'everything' })).json).toEqual({
      success: true,
      deleted: 0,
    })
    expect(empty.calls).toEqual([])
  })
})
