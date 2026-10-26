import { createHmac, webcrypto } from 'crypto'
import vm from 'vm'
import standalone from 'prettier/standalone.js'
import parserBabel from 'prettier/parser-babel.js'
import { FileType, ProjectPluginStructure, ProjectUIDL } from '@teleporthq/teleport-types'
import { NextPasswordWallProjectPlugin } from '../src/password-wall/project-plugin'
import { buildStandaloneWallMiddleware, wrapMiddlewareWithWall } from '../src/password-wall/gate-source'
import { buildWallHelperSource } from '../src/password-wall/helper-source'
import { buildPasswordPageModule } from '../src/password-wall/page-html'
import { buildSignInRouteSource } from '../src/password-wall/sign-in-route-source'
import { WALL_ENV_KEYS, WALL_MATCHER } from '../src/password-wall/constants'
import { generateMiddlewareFile } from '../../teleport-plugin-next-workflows/src/auth-generator'

const structureFor = (
  settings: Record<string, unknown> = {},
  files: ProjectPluginStructure['files'] = new Map()
): ProjectPluginStructure =>
  ({
    uidl: {
      name: 'site',
      globals: { settings: { title: 'Harbor Store', language: 'en', ...settings }, meta: [], assets: [] },
      root: {} as never,
    } as unknown as ProjectUIDL,
    template: { name: 'site', files: [], subFolders: [] },
    files,
    dependencies: {},
    devDependencies: {},
    strategy: {} as never,
    rootFolder: { name: 'site', files: [], subFolders: [] },
  }) as ProjectPluginStructure

const fileOf = (files: ProjectPluginStructure['files'], key: string) => files.get(key)!.files[0]

/**
 * A module evaluated the way the Edge runtime would: `process.env` as the
 * publish wrote it, Web Crypto only, ESM exports collected by hand.
 */
const evaluateHelper = (env: Record<string, string>) => {
  const source = buildWallHelperSource()
    .replace(/export (var|function|async function) /g, '$1 ')
    .replace(/export \{[^}]*\}/g, '')
  const exported: Record<string, unknown> = {}
  const script = `${source}\n;Object.assign(exported, { wallConfig, wallConfigured, isOpenPath, cookieValueFor, sameValue })`
  vm.runInNewContext(script, {
    process: { env },
    TextEncoder,
    crypto: webcrypto,
    exported,
  })
  return exported as {
    wallConfigured: () => boolean
    isOpenPath: (path: string) => boolean
    cookieValueFor: (version: string) => Promise<string>
    sameValue: (a: string, b: string) => boolean
  }
}

/**
 * The wall is a security control: a trial site must stay behind it whatever
 * else the site has, so the plugin must emit its four files for every site
 * and must put the gate in FRONT of the members-only middleware, never beside
 * it or behind it.
 */
describe('NextPasswordWallProjectPlugin', () => {
  it('gives a site without middleware the gate, the page, the route and the helper', async () => {
    const structure = await new NextPasswordWallProjectPlugin().runAfter(structureFor())
    const { files, uidl } = structure

    const middleware = fileOf(files, 'auth-middleware')
    expect(files.get('auth-middleware')!.path).toEqual([])
    expect(middleware.name).toBe('middleware')
    expect(middleware.fileType).toBe(FileType.JS)
    expect(middleware.content).toContain('export default async function middleware(request, event)')
    expect(middleware.content).toContain(`matcher: ${WALL_MATCHER}`)

    expect(files.get('site-wall-page')!.path).toEqual(['utils'])
    expect(fileOf(files, 'site-wall-page').name).toBe('site-wall-page')
    expect(files.get('site-wall-sign-in-route')!.path).toEqual(['pages', 'api'])
    expect(fileOf(files, 'site-wall-sign-in-route').name).toBe('site-password')
    expect(files.get('site-wall-helper')!.path).toEqual(['utils'])

    for (const key of WALL_ENV_KEYS) {
      expect(uidl.globals.env).toHaveProperty(key, '')
    }
  })

  it('keeps an env value the project already names', async () => {
    const structure = structureFor()
    structure.uidl.globals.env = { TELEPORT_API_URL: 'https://api.example.com', OTHER: 'x' }
    await new NextPasswordWallProjectPlugin().runAfter(structure)
    expect(structure.uidl.globals.env.TELEPORT_API_URL).toBe('https://api.example.com')
    expect(structure.uidl.globals.env.OTHER).toBe('x')
    expect(structure.uidl.globals.env.TELEPORT_WALL).toBe('')
  })

  it('puts the gate in front of the members-only middleware the workflows plugin emitted', async () => {
    const authSource = generateMiddlewareFile({
      authPages: { signIn: { route: '/sign-in' } },
      pageProtection: { p1: { route: '/account', requiresAuth: true, allowedRoles: [] } },
    } as never)
    const files: ProjectPluginStructure['files'] = new Map()
    files.set('auth-middleware', {
      path: [],
      files: [{ name: 'middleware', fileType: FileType.JS, content: authSource }],
    })

    await new NextPasswordWallProjectPlugin().runAfter(structureFor({}, files))
    const wrapped = fileOf(files, 'auth-middleware').content

    expect(wrapped).toContain('async function middleware(request)')
    expect(wrapped).toContain('export default __tqWalledMiddleware;')
    expect(wrapped).not.toContain('export default middleware;')
    expect(wrapped.indexOf('var gate = await __tqWallGate(request, event);')).toBeGreaterThan(-1)
    expect(wrapped).toContain(`matcher: ${WALL_MATCHER}`)
    expect(wrapped).not.toContain('favicon')
    expect(wrapped.match(/export const config = \{/g)).toHaveLength(1)
    expect(wrapped).toContain("from './utils/site-wall'")
  })

  it('refuses to wrap a middleware it does not recognise rather than leaving the site open', () => {
    expect(() => wrapMiddlewareWithWall('export default function other() {}')).toThrow(
      /default export/
    )
    expect(() => wrapMiddlewareWithWall('export default middleware;')).toThrow(/matcher/)
    expect(buildStandaloneWallMiddleware()).toContain('__tqWallGate')
  })

  it('shows TeleportHQ on the password page unless a logo was set, and the route answers 401', () => {
    const branded = buildPasswordPageModule({ siteTitle: "Harbor's Store" })
    expect(branded).toContain('aria-label=\\"TeleportHQ\\"')
    expect(branded).toContain("export var CUSTOM_LOGO = '';")
    expect(branded).toContain("export var SITE_TITLE = 'Harbor\\'s Store';")
    expect(branded).toContain("<meta name='robots' content='noindex, nofollow'>")

    const own = buildPasswordPageModule({ logoUrl: 'https://cdn.example.com/logo.png' })
    expect(own).toContain("export var CUSTOM_LOGO = 'https://cdn.example.com/logo.png';")

    // Only a web address is taken as a logo.
    expect(buildPasswordPageModule({ logoUrl: 'javascript:alert(1)' })).toContain(
      "export var CUSTOM_LOGO = '';"
    )

    // The status is the route's: 401 in place of a gated page, 200 on the page's own address.
    const route = buildSignInRouteSource()
    expect(route).toContain('res.status(direct ? 200 : 401).send(renderPasswordPage())')
    expect(route).toContain("req.query.page === '1'")
  })
})

describe('every generated file is JavaScript a build accepts', () => {
  const parses = (source: string) =>
    standalone.format(source, { parser: 'babel', plugins: [parserBabel] })

  it('parses the helper, both middlewares, the sign-in route and the page', () => {
    expect(() => parses(buildWallHelperSource())).not.toThrow()
    expect(() => parses(buildStandaloneWallMiddleware())).not.toThrow()
    expect(() => parses(buildSignInRouteSource())).not.toThrow()
    // The page once embedded the logo as bare markup instead of a string and
    // every request answered 500; the logo is a string literal now.
    expect(() => parses(buildPasswordPageModule({ siteTitle: "Harbor's Store" }))).not.toThrow()
    expect(() =>
      parses(buildPasswordPageModule({ logoUrl: 'https://cdn.example.com/logo.png' }))
    ).not.toThrow()
    expect(buildPasswordPageModule()).toContain('var TELEPORT_LOGO = "<svg')
  })
})

describe('the shared helper, as the Edge runtime runs it', () => {
  const env = {
    TELEPORT_WALL: 'on',
    TELEPORT_WALL_VERSION: 'v1',
    TELEPORT_WALL_SECRET: 'secret-123',
    TELEPORT_PROJECT_ID: 'p1',
    TELEPORT_API_URL: 'https://api.teleporthq.io/',
  }

  it('is off without the values the publish writes', () => {
    expect(evaluateHelper({}).wallConfigured()).toBe(false)
    expect(evaluateHelper({ ...env, TELEPORT_WALL_SECRET: '' }).wallConfigured()).toBe(false)
    expect(evaluateHelper(env).wallConfigured()).toBe(true)
  })

  it('leaves the hashed assets and the API open, nothing else', () => {
    const helper = evaluateHelper(env)
    expect(helper.isOpenPath('/_next/static/chunks/main.js')).toBe(true)
    expect(helper.isOpenPath('/api/webhooks/stripe')).toBe(true)
    expect(helper.isOpenPath('/api')).toBe(true)
    // The page's own address is the gate's to serve, not an open path.
    expect(helper.isOpenPath('/site-password')).toBe(false)
    expect(helper.isOpenPath('/')).toBe(false)
    expect(helper.isOpenPath('/about')).toBe(false)
    expect(helper.isOpenPath('/_next/image?url=x')).toBe(false)
    expect(helper.isOpenPath('/_next/data/build/index.json')).toBe(false)
    expect(helper.isOpenPath('/apiary')).toBe(false)
  })

  it('computes the same cookie value as the Node sign-in route', async () => {
    const helper = evaluateHelper(env)
    const fromEdge = await helper.cookieValueFor('v1')
    const fromNode = createHmac('sha256', 'secret-123').update('wall:v1').digest('hex')
    expect(fromEdge).toBe(fromNode)
    expect(helper.sameValue(fromEdge, fromNode)).toBe(true)
    expect(helper.sameValue(fromEdge, fromNode.slice(0, -1) + '0')).toBe(false)
    expect(await helper.cookieValueFor('v2')).not.toBe(fromEdge)
  })
})
