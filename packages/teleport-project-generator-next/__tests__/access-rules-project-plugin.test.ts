import { parse } from '@babel/parser'
import {
  FileType,
  ProjectPluginStructure,
  UIDLPluginSettingValue,
} from '@teleporthq/teleport-types'
import { NextAccessRulesProjectPlugin } from '../src/access-rules/project-plugin'
import { resolveAccessRulesSettings } from '../src/access-rules/settings'

const APP_CONTENT = `import { GlobalProvider } from '../global-context'

const MyApp = ({ Component, pageProps }) => {
  return (
    <GlobalProvider>
      <Component {...pageProps} />
    </GlobalProvider>
  )
}

export default MyApp
`

const AUTH_MIDDLEWARE = `import { NextResponse } from 'next/server';

async function middleware(request) {
  const pathname = request.nextUrl.pathname;
  return NextResponse.next();
}

export default middleware;
export const config = {
  matcher: ['/', '/((?!api/|_next/static|_next/image|favicon\\\\.ico).*)'],
};
`

function makeStructure(
  settings: Record<string, UIDLPluginSettingValue> | null,
  withAuthMiddleware = false,
  record: { data?: Record<string, unknown>; pages?: Record<string, string> } = {}
): ProjectPluginStructure {
  const files = new Map()
  files.set('_app', {
    path: ['pages'],
    files: [{ name: '_app', fileType: FileType.JS, content: APP_CONTENT }],
  })
  if (withAuthMiddleware) {
    files.set('auth-middleware', {
      path: [],
      files: [{ name: 'middleware', fileType: FileType.JS, content: AUTH_MIDDLEWARE }],
    })
  }
  return {
    uidl: {
      name: 'test-project',
      globals: { settings: { title: 'Test', language: 'en' }, assets: [] },
      root: {} as never,
      ...(settings ? { plugins: { accessRules: { settings, ...record } } } : {}),
    },
    files,
    dependencies: {},
    devDependencies: {},
    template: { files: [], subFolders: [] },
  } as unknown as ProjectPluginStructure
}

const appSource = (structure: ProjectPluginStructure): string =>
  structure.files.get('_app').files[0].content as string

const parses = (source: string) => parse(source, { sourceType: 'module', plugins: ['jsx'] })

describe('NextAccessRulesProjectPlugin', () => {
  it('leaves a project without the plugin exactly as it was', async () => {
    const structure = makeStructure(null)
    await new NextAccessRulesProjectPlugin().runAfter(structure)

    expect(structure.files.get('access-rules-middleware')).toBeUndefined()
    expect(appSource(structure)).toBe(APP_CONTENT)
  })

  it('writes the country rule as a middleware of its own, with a plain notice for a project without the Unavailable page', async () => {
    const structure = makeStructure({
      ageGateEnabled: false,
      geoMode: 'block',
      geoCountries: ['ru', 'BY', 'xyz'],
      geoUnknownCountry: 'block',
    })
    await new NextAccessRulesProjectPlugin().runAfter(structure)

    expect(appSource(structure)).toBe(APP_CONTENT)

    const middleware = structure.files.get('access-rules-middleware')
    expect(middleware.path).toEqual([])
    expect(middleware.files[0].name).toBe('middleware')
    const source = middleware.files[0].content as string
    expect(source).toContain('"countries":["RU","BY"]')
    expect(source).toContain('"unknown":"block"')
    expect(source).toContain('status: 451')
    expect(source).toContain('This site is not available in your country.')
    expect(source).not.toContain('redirect')
    expect(source).toContain(
      "matcher: ['/', '/((?!api/|_next/static|_next/image|favicon\\\\.ico).*)']"
    )
    expect(() => parses(source)).not.toThrow()
  })

  it('wraps the authentication middleware instead of writing a second one', async () => {
    const structure = makeStructure(
      { ageGateEnabled: false, geoMode: 'allow', geoCountries: ['US'] },
      true
    )
    await new NextAccessRulesProjectPlugin().runAfter(structure)

    expect(structure.files.get('access-rules-middleware')).toBeUndefined()
    const source = structure.files.get('auth-middleware').files[0].content as string
    expect(source).toContain('"mode":"allow"')
    expect(source).toContain('export default __tqWithGeo(middleware);')
    expect(source).not.toContain('export default middleware;')
    expect(source).toContain('return __tqGeoResponse(request) || next(request);')
    // Nothing the auth file had is lost.
    expect(source).toContain('const pathname = request.nextUrl.pathname;')
    expect(source).toContain(
      "matcher: ['/', '/((?!api/|_next/static|_next/image|favicon\\\\.ico).*)']"
    )
    expect(() => parses(source)).not.toThrow()

    // Idempotent: a second run changes nothing.
    await new NextAccessRulesProjectPlugin().runAfter(structure)
    expect(structure.files.get('auth-middleware').files[0].content).toBe(source)
  })

  it('writes no middleware for an empty country list, and no gate for a gate scoped to no page', async () => {
    const empty = makeStructure(
      { ageGateEnabled: true, ageGateScope: 'pages', geoMode: 'block', geoCountries: [] },
      false,
      { data: { gate: 'component', gatedPaths: [] } }
    )
    const plugin = new NextAccessRulesProjectPlugin()
    await plugin.runBefore(empty)
    await plugin.runAfter(empty)
    // A gate scoped to no page shows nowhere, and a rule with no country does nothing.
    expect(empty.files.get('access-rules-middleware')).toBeUndefined()
    expect((empty.uidl.globals as { customCode?: { head?: string } }).customCode).toBeUndefined()
  })
})

describe('NextAccessRulesProjectPlugin with the editor’s Age Gate component', () => {
  it('puts the gate’s head script first in the head and writes no gate of its own', async () => {
    const structure = makeStructure(
      {
        ageGateEnabled: true,
        minimumAge: 21,
        ageGateScope: 'pages',
        allowCrawlers: false,
        rememberDays: 7,
      },
      false,
      {
        data: {
          gate: 'component',
          gatedPaths: ['/Shop/', '/fr/shop', 'nonsense'],
          unavailablePaths: ['/unavailable', '/fr/unavailable'],
        },
      }
    )
    ;(structure.uidl.globals as { customCode?: { head?: string } }).customCode = {
      head: '<meta name="x">',
    }
    const plugin = new NextAccessRulesProjectPlugin()
    await plugin.runBefore(structure)
    await plugin.runAfter(structure)

    const head =
      (structure.uidl.globals as { customCode?: { head?: string } }).customCode?.head ?? ''
    expect(
      head.startsWith(
        '<style>html[data-tq-age-gate="hidden"] [data-tq-age-gate]{display:none!important}'
      )
    ).toBe(true)
    expect(head.endsWith('<meta name="x">')).toBe(true)
    expect(head).toContain('"minimumAge":21')
    expect(head).toContain('"pages":["/shop","/fr/shop"]')
    // The Unavailable page is never behind the gate.
    expect(head).toContain('"ungated":["/unavailable","/fr/unavailable"]')
    expect(head).toContain('matches(p, S.ungated)) return false')
    expect(head).toContain('"rememberSeconds":' + String(7 * 86400))
    expect(head).toContain('"noindex":true')
    expect(head).toContain('"tq-age-gate-confirm"')
    expect(head).toContain('"tq-age-gate-too-young"')
    expect(head).not.toContain('</script><script>')
    expect(appSource(structure)).toBe(APP_CONTENT)
  })

  it('writes no head script while the gate is off, and none without the Age Gate component', async () => {
    const off = makeStructure({ ageGateEnabled: false }, false, {
      data: { gate: 'component', gatedPaths: [] },
    })
    const plugin = new NextAccessRulesProjectPlugin()
    await plugin.runBefore(off)
    expect((off.uidl.globals as { customCode?: { head?: string } }).customCode).toBeUndefined()

    // The gate is the editor's component: a project without it has nothing to drive.
    const none = makeStructure({ ageGateEnabled: true }, false, { data: { gate: 'none' } })
    await plugin.runBefore(none)
    await plugin.runAfter(none)
    expect((none.uidl.globals as { customCode?: { head?: string } }).customCode).toBeUndefined()
    expect(appSource(none)).toBe(APP_CONTENT)
  })

  it('sends a blocked visitor to the project’s Unavailable page, never looping on it', async () => {
    const structure = makeStructure(
      { ageGateEnabled: false, geoMode: 'block', geoCountries: ['RU'] },
      false,
      { pages: { unavailable: '/unavailable' } }
    )
    await new NextAccessRulesProjectPlugin().runAfter(structure)
    const source = structure.files.get('access-rules-middleware').files[0].content as string
    expect(source).toContain('"unavailableRoute":"/unavailable"')
    expect(source).toContain(
      "if (pathname === route || pathname.indexOf(route + '/') === 0) return null;"
    )
    expect(source).toContain('NextResponse.rewrite(unavailable)')
    expect(source).toContain("rewritten.headers.set('x-robots-tag', 'noindex')")
    expect(() => parses(source)).not.toThrow()
  })
})

describe('resolveAccessRulesSettings', () => {
  it('fills every field from the defaults, clamps a number and falls back for a value outside its choices', () => {
    const settings = resolveAccessRulesSettings({
      name: 'p',
      globals: { settings: { title: 'p', language: 'en' }, assets: [] },
      root: {} as never,
      plugins: {
        accessRules: { settings: { minimumAge: 9, ageGateMode: 'shout', geoMode: 'allow' } },
      },
    } as never)
    expect(settings).toMatchObject({
      ageGateEnabled: true,
      minimumAge: 13,
      ageGateMode: 'confirm',
      geoMode: 'allow',
      geoCountries: [],
      geoUnknownCountry: 'allow',
    })
    expect(resolveAccessRulesSettings({ plugins: {} } as never)).toBeNull()
    expect(resolveAccessRulesSettings({} as never)).toBeNull()
  })
})
