import * as crypto from 'crypto'
import { ProjectPluginRevalidateAPI } from '../src'

// `pages/api/revalidate.js` makes the site rebuild its pages for the CMS's
// webhook. It used to check a secret only when the editor had one, compared it
// with `!==` against the query string, and let an unset variable match a
// missing parameter. Now: the `x-webhook-secret` header first, the
// `?WEBHOOK_SECRET=` a webhook set up before still works, a constant-time
// compare, and no secret (unset, blank, placeholder) means nobody.

const SECRET = 'the-cms-webhook-secret'

const generate = async (cacheHandlerSecret?: string): Promise<string> => {
  const structure: any = {
    uidl: {
      name: 'Site',
      globals: { settings: { title: 'Site' }, meta: [], assets: [] },
      root: { name: 'App', node: { type: 'element', content: { elementType: 'container' } } },
      resources: {
        cache: {
          webhook: {
            name: 'revalidateFromCms',
            dependency: { type: 'package', path: '@teleporthq/cms-webhooks', version: '1.0.0' },
          },
        },
      },
    },
    files: new Map(),
    dependencies: {},
  }
  await new ProjectPluginRevalidateAPI({
    routeMappers: { post: [`/blog/\${slug}`] },
    ...(cacheHandlerSecret ? { cacheHandlerSecret } : {}),
  }).runAfter(structure)
  return structure.files.get('revalidate').files[0].content
}

/** Runs the generated route as CommonJS; resolves the status it answered. */
const route = (source: string, env: Record<string, string | undefined>) => {
  const commonJs = source
    .replace(/^import (\w+) from ["']([^"']+)["'];?$/m, "const $1 = require('$2').default;")
    .replace('export default async function handler', 'module.exports = async function handler')
  const module = { exports: null as any }
  const rebuilt: string[] = []
  const requireShim = (id: string) => {
    if (id === 'crypto') {
      return crypto
    }
    if (id === '@teleporthq/cms-webhooks') {
      return {
        default: async (
          _req: unknown,
          callback: (data: unknown, contentType: string) => Promise<void>
        ): Promise<void> => callback({ slug: 'hello' }, 'post'),
      }
    }
    throw new Error('unexpected require: ' + id)
  }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'process', 'Buffer', 'console', commonJs)(
    module,
    {},
    requireShim,
    { env },
    Buffer,
    { log: (): undefined => undefined }
  )
  return async (request: { headers?: Record<string, string>; query?: Record<string, string> }) => {
    const reply = { status: 0 }
    const res: Record<string, unknown> = {
      status(code: number): unknown {
        reply.status = code
        return res
      },
      json: (): unknown => res,
      revalidate: async (path: string) => {
        rebuilt.push(path)
      },
    }
    await module.exports({ headers: {}, query: {}, body: {}, ...request }, res)
    return { status: reply.status, rebuilt }
  }
}

describe('the CMS revalidate webhook route', () => {
  it('rebuilds for a caller presenting the secret in the x-webhook-secret header', async () => {
    const call = route(await generate('WEBHOOK_SECRET'), { WEBHOOK_SECRET: SECRET })
    const ok = await call({ headers: { 'x-webhook-secret': SECRET } })
    expect(ok.status).toBe(200)
    expect(ok.rebuilt).toEqual(['/blog/hello'])
    expect((await call({ headers: { 'x-webhook-secret': 'guess' } })).status).toBe(401)
    expect((await call({})).status).toBe(401)
  })

  it('still rebuilds for a webhook set up with ?WEBHOOK_SECRET= in its address', async () => {
    const call = route(await generate('WEBHOOK_SECRET'), { WEBHOOK_SECRET: SECRET })
    const ok = await call({ query: { WEBHOOK_SECRET: SECRET } })
    expect(ok.status).toBe(200)
    expect(ok.rebuilt).toEqual(['/blog/hello'])
    expect((await call({ query: { WEBHOOK_SECRET: 'guess' } })).status).toBe(401)
    expect((await call({ query: { WEBHOOK_SECRET: '' } })).status).toBe(401)
    expect((await call({ query: { other: SECRET } })).status).toBe(401)
  })

  it('reads the header first: a wrong header is refused whatever the address says', async () => {
    const call = route(await generate('WEBHOOK_SECRET'), { WEBHOOK_SECRET: SECRET })
    expect(
      (await call({ headers: { 'x-webhook-secret': 'guess' }, query: { WEBHOOK_SECRET: SECRET } }))
        .status
    ).toBe(401)
    expect(
      (await call({ headers: { 'x-webhook-secret': SECRET }, query: { WEBHOOK_SECRET: 'guess' } }))
        .status
    ).toBe(200)
  })

  it.each([
    ['unset', undefined],
    ['blank', '  '],
    ['the unresolved placeholder', 'teleporthq.secrets.WEBHOOK_SECRET'],
  ])('refuses everyone while the secret is %s', async (_label, value) => {
    const call = route(await generate('WEBHOOK_SECRET'), { WEBHOOK_SECRET: value })
    expect((await call({})).status).toBe(401)
    expect((await call({ query: { WEBHOOK_SECRET: value || '' } })).status).toBe(401)
    expect((await call({ headers: { 'x-webhook-secret': value || '' } })).status).toBe(401)
  })

  it('refuses everyone when the editor configured no secret at all', async () => {
    const call = route(await generate(), {})
    const response = await call({})
    expect(response.status).toBe(401)
    expect(response.rebuilt).toEqual([])
  })

  it('trims the configured secret and the one presented the same way', async () => {
    const call = route(await generate('WEBHOOK_SECRET'), { WEBHOOK_SECRET: `${SECRET}\n` })
    expect((await call({ headers: { 'x-webhook-secret': SECRET } })).status).toBe(200)
    expect((await call({ headers: { 'x-webhook-secret': ` ${SECRET} ` } })).status).toBe(200)
    expect((await call({ query: { WEBHOOK_SECRET: SECRET } })).status).toBe(200)
    // A blank header falls through to the address.
    expect(
      (await call({ headers: { 'x-webhook-secret': '  ' }, query: { WEBHOOK_SECRET: SECRET } }))
        .status
    ).toBe(200)
  })

  it('compares digests in constant time — never with !==, never revealing the length', async () => {
    const source = await generate('WEBHOOK_SECRET')
    expect(source).toContain('timingSafeEqual')
    expect(source).toContain("createHash('sha256')")
    expect(source).not.toMatch(/\.length\s*(===|!==)/)
    expect(source).not.toMatch(/process\.env\.WEBHOOK_SECRET\s*!==/)
  })
})
