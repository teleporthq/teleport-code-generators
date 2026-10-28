import { GeneratedFile, GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'
import { NextProjectPlugini18nConfig } from '../src/internationalization/project'
import { NextSecurityHeadersProjectPlugin } from '../src/security-headers'
import { NextImageSettingsProjectPlugin } from '../src/next-config-images'
import { baseUidl, buildStructure, fileContent } from './_helpers/pwa-fixtures'

/**
 * Page protection is enforced on the server, not only by the middleware: a
 * Next 12 Pages-Router app with i18n serves `/_next/data/<build>/<page>.json`
 * without running the middleware (CVE-2026-44573), so a protected page's own
 * data function has to check the session itself. Every protected page renders
 * with getServerSideProps that runs the guard first — never getStaticProps,
 * whose output is a static JSON anyone can fetch — and a public page comes
 * out exactly as before.
 */

const template = () => JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

interface Protection {
  requiresAuth: boolean
  allowedRoles: string[]
  pageName: string
  route: string
  routePattern?: string
  requiresSubscription?: boolean
  subscriptionProductIds?: string[]
  rowOwnerColumn?: string
  rowOwnerDifferentiator?: string
}

const authOf = (pageProtection: Record<string, Protection>) => ({
  enabled: true,
  dataSourceId: null as string | null,
  dataSourceType: null as string | null,
  passwordAuthEnabled: false,
  providers: [] as unknown[],
  roles: ['admin', 'member'],
  tables: {},
  pageProtection,
  folderProtection: {},
  authPages: { signIn: { pageId: 'sign-in', pageName: 'sign-in', route: '/sign-in' } },
  callbackBaseUrl: '',
  envKeys: {},
  customUserProperties: [] as unknown[],
})

const ADMIN_ABOUT: Record<string, Protection> = {
  about: { requiresAuth: true, allowedRoles: ['admin'], pageName: 'about', route: '/about' },
}

const pageNode = (value: string, text: string) => ({
  type: 'conditional',
  content: {
    node: {
      type: 'element',
      content: {
        elementType: 'container',
        name: 'element',
        events: {},
        children: [{ type: 'static', content: text }],
      },
    },
    value,
    reference: { type: 'dynamic', content: { referenceType: 'state', id: 'route' } },
  },
})

const buildUidl = (
  options: {
    pageProtection?: Record<string, Protection>
    i18n?: boolean
    orderDetails?: boolean
  } = {}
): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  if (options.orderDetails) {
    uidl.root.stateDefinitions.route.values.push({
      value: 'order-details',
      pageOptions: {
        navLink: '/orders/[id]',
        dynamicRouteAttribute: 'id',
        componentName: 'OrderDetails',
      },
    } as any)
    ;(uidl.root.node.content.children as unknown[]).push(pageNode('order-details', 'Order'))
  }
  if (options.pageProtection) {
    ;(uidl as any).authentication = authOf(options.pageProtection)
  }
  if (options.i18n) {
    ;(uidl as any).internationalization = {
      main: { locale: 'en', name: 'English' },
      languages: { en: 'English', es: 'Español' },
      translations: {},
    }
  }
  return uidl
}

const generate = (uidl: ProjectUIDL) =>
  createNextProjectGenerator().generateProject(uidl as any, template())

const folderAt = (root: GeneratedFolder, path: string[]): GeneratedFolder | undefined =>
  path.reduce<GeneratedFolder | undefined>(
    (folder, name) => folder?.subFolders.find((sub) => sub.name === name),
    root
  )

const fileAt = (root: GeneratedFolder, path: string[], name: string): GeneratedFile | undefined =>
  folderAt(root, path)?.files.find((file) => file.name === name)

const pageSource = (root: GeneratedFolder, path: string[], name: string): string => {
  const file = fileAt(root, ['pages', ...path], name)
  expect(file).toBeDefined()
  return file!.content
}

describe('protected pages render with a server-side access check', () => {
  it('gives a role-gated page getServerSideProps that runs the guard, and no getStaticProps', async () => {
    const output = await generate(buildUidl({ pageProtection: ADMIN_ABOUT }))
    const about = pageSource(output, [], 'about')

    expect(about).toContain('export async function getServerSideProps(context)')
    expect(about).not.toContain('getStaticProps')
    expect(about).toContain("import __tqPageAccess from '../utils/auth/page-access'")
    expect(about).toMatch(
      /const __tqAccessDenied = await __tqPageAccess\.guardPageAccess\(context, \{\s*requiresAuth: true,\s*allowedRoles: \['admin'\],?\s*\}\)/
    )
    expect(about).toMatch(/if \(__tqAccessDenied\) \{\s*return __tqAccessDenied\s*\}/)

    // The guard module the page imports ships with the project.
    const guard = fileAt(output, ['utils', 'auth'], 'page-access')
    expect(guard?.content).toContain('async function guardPageAccess(context, policy)')
  })

  it('leaves a public page byte-identical to a project with no protected page', async () => {
    const withProtection = await generate(buildUidl({ pageProtection: ADMIN_ABOUT }))
    const withoutProtection = await generate(buildUidl({ pageProtection: {} }))

    expect(pageSource(withProtection, [], 'index')).toBe(pageSource(withoutProtection, [], 'index'))
    expect(pageSource(withProtection, [], 'here-we-are')).toBe(
      pageSource(withoutProtection, [], 'here-we-are')
    )
    expect(pageSource(withProtection, [], 'index')).not.toContain('getServerSideProps')
  })

  it('turns the getStaticProps a localized page gets into getServerSideProps, never spreading the request into props', async () => {
    const output = await generate(buildUidl({ pageProtection: ADMIN_ABOUT, i18n: true }))
    const about = pageSource(output, [], 'about')
    const home = pageSource(output, [], 'index')

    expect(about).toContain('export async function getServerSideProps(context)')
    expect(about).not.toContain('getStaticProps')
    expect(about).toContain('guardPageAccess(context')
    // The messages still load, after the guard.
    expect(about.indexOf('guardPageAccess')).toBeLessThan(about.indexOf('messages'))
    // req / res / query are not serializable props: the context spread the
    // locale fetcher writes keeps only what getStaticProps used to receive.
    expect(about).not.toMatch(/\.\.\.context\b/)
    expect(about).toMatch(/req,\s*res,\s*query,\s*resolvedUrl,\s*\.\.\.rest/)

    // The public page keeps its static data function.
    expect(home).toContain('export async function getStaticProps(context)')
    expect(home).not.toContain('getServerSideProps')
    expect(home).not.toContain('page-access')
  })

  it('gives a protected dynamic page no getStaticPaths', async () => {
    const output = await generate(
      buildUidl({
        orderDetails: true,
        pageProtection: {
          'order-details': {
            requiresAuth: true,
            allowedRoles: [],
            pageName: 'order-details',
            route: '/orders',
            routePattern: '/orders/[id]',
          },
        },
      })
    )
    const details = pageSource(output, ['orders'], '[id]')

    expect(details).toContain('export async function getServerSideProps(context)')
    expect(details).not.toContain('getStaticPaths')
    expect(details).not.toContain('getStaticProps')
    expect(details).toContain("import __tqPageAccess from '../../utils/auth/page-access'")
    expect(details).toMatch(/requiresAuth: true,\s*allowedRoles: \[\]/)
  })

  it('leaves a row-owned details page to its own SQL, like the middleware does', async () => {
    const output = await generate(
      buildUidl({
        orderDetails: true,
        pageProtection: {
          'order-details': {
            requiresAuth: true,
            allowedRoles: [],
            pageName: 'order-details',
            route: '/orders',
            routePattern: '/orders/[id]',
            rowOwnerColumn: 'user_id',
            rowOwnerDifferentiator: 'id',
          },
        },
      })
    )
    const details = pageSource(output, ['orders'], '[id]')

    expect(details).not.toContain('getServerSideProps')
    expect(details).not.toContain('page-access')
  })

  it('bakes the subscription requirement into the guard call', async () => {
    const output = await generate(
      buildUidl({
        pageProtection: {
          about: {
            requiresAuth: true,
            allowedRoles: [],
            pageName: 'about',
            route: '/about',
            requiresSubscription: true,
            subscriptionProductIds: ['prod-1'],
          },
        },
      })
    )
    const about = pageSource(output, [], 'about')

    expect(about).toMatch(/requiresSubscription: true,\s*subscriptionProductIds: \['prod-1'\]/)
  })

  it('changes nothing for a project whose authentication is off', async () => {
    const uidl = buildUidl({ pageProtection: ADMIN_ABOUT })
    ;(uidl as any).authentication.enabled = false
    const output = await generate(uidl)

    expect(pageSource(output, [], 'about')).not.toContain('getServerSideProps')
    expect(fileAt(output, ['utils', 'auth'], 'page-access')).toBeUndefined()
  })
})

describe('the generated next.config and package.json', () => {
  it('allows next/image no remote host and no SVG', async () => {
    const output = await generate(buildUidl())
    const config = output.files.find((file) => file.name === 'next.config')
    expect(config).toBeDefined()
    const moduleShim = { exports: {} as Record<string, any> }
    // tslint:disable-next-line:function-constructor
    new Function('module', 'exports', 'require', config!.content)(
      moduleShim,
      moduleShim.exports,
      require
    )
    expect(moduleShim.exports.images).toEqual({ remotePatterns: [], dangerouslyAllowSVG: false })
  })

  it('keeps the settings when the i18n config writes next.config first, as packProject runs it', async () => {
    const structure = buildStructure(
      baseUidl({
        internationalization: {
          main: { locale: 'en', name: 'English' },
          languages: { en: 'English', es: 'Español' },
        },
      }),
      { withNextConfig: false }
    )
    for (const plugin of [
      new NextProjectPlugini18nConfig(),
      new NextSecurityHeadersProjectPlugin(),
      new NextImageSettingsProjectPlugin(),
    ]) {
      await plugin.runAfter(structure)
    }
    const source = fileContent(structure, 'next.config', 'next.config') as string
    const moduleShim = { exports: {} as Record<string, any> }
    // tslint:disable-next-line:function-constructor
    new Function('module', 'exports', 'require', source)(moduleShim, moduleShim.exports, require)
    expect(moduleShim.exports.images).toEqual({ remotePatterns: [], dangerouslyAllowSVG: false })
    expect(moduleShim.exports.i18n).toEqual({ locales: ['en', 'es'], defaultLocale: 'en' })
    expect(typeof moduleShim.exports.headers).toBe('function')
    expect(source.match(/images\s*:/g)).toHaveLength(1)
  })

  it('installs Next.js 12.3.7 or newer', () => {
    const packageJson = JSON.parse(
      (NextTemplate.files.find((file) => file.name === 'package') as GeneratedFile).content
    )
    expect(packageJson.dependencies.next).toBe('^12.3.7')
  })
})
