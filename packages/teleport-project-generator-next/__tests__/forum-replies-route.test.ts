/* tslint:disable:function-constructor no-any */
import { SessionCookieResolver } from '@teleporthq/teleport-shared'
import { buildForumRepliesRouteSource, FORUM_ROUTE_ROOT } from '../src/forum/replies-route'

/**
 * The replies route ("Load more", the reply sort, the list read again after a
 * reply), run as the generated site runs it over a fake data module. A list
 * read with any credential must never be cached: the reply a member just
 * posted would otherwise come back missing from a browser or CDN copy.
 */

const TOPIC_ID = 'aaaaaaaa-0000-4000-8000-000000000001'

function loadRoute() {
  const forum = {
    loadReplies: async () => ({
      replies: [{ id: 'r-1' }],
      hasMore: false,
      nextOffset: 1,
      replyCount: 7,
    }),
  }
  const security = { rateLimitRequest: async () => true }
  const resolver = SessionCookieResolver.generateCommonJsSessionTokenResolverCode(
    FORUM_ROUTE_ROOT,
    { withRevocation: false }
  )
  const source = buildForumRepliesRouteSource({ withSessionRevocation: false })
  expect(source).toContain(resolver)
  const body = source
    .replace(resolver, 'async function __tqSessionToken(req) { return req.session; }')
    .replace('export default async function handler', 'module.exports = async function handler')
  const module = { exports: {} as any }
  const fakeRequire = (name: string) => (name.includes('security') ? security : forum)
  new Function('require', 'module', 'exports', body)(fakeRequire, module, module.exports)
  return module.exports as (req: any, res: any) => Promise<void>
}

async function ask(headers: Record<string, string>, session: object | null = null) {
  const answer = { status: 0, json: null as any, headers: {} as Record<string, string> }
  const res = {
    setHeader: (name: string, value: string) => {
      answer.headers[name] = value
    },
    status(code: number) {
      answer.status = code
      return this
    },
    json(value: unknown) {
      answer.json = value
      return this
    },
  }
  await loadRoute()(
    { method: 'GET', query: { topic: TOPIC_ID, sort: 'best' }, headers, session },
    res
  )
  return answer
}

describe('forum replies route', () => {
  it('answers the topic’s count of published replies beside the list', async () => {
    const answer = await ask({})
    expect(answer.status).toBe(200)
    expect(answer.json).toMatchObject({ success: true, replyCount: 7, hasMore: false })
  })

  it('lets a shared cache keep only a request that carries no credentials', async () => {
    expect((await ask({})).headers['Cache-Control']).toContain('public')
  })

  it('never lets a request with a session, a cookie or an authorization be cached', async () => {
    for (const [headers, session] of [
      [{}, { id: 'user-1' }],
      // A cookie whose session could not be read (expired, revoked, a slow check).
      [{ cookie: 'next-auth.session-token=stale' }, null],
      [{ authorization: 'Bearer x' }, null],
    ] as Array<[Record<string, string>, object | null]>) {
      expect((await ask(headers, session)).headers['Cache-Control']).toBe('private, no-store')
    }
  })
})
