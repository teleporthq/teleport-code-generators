/* tslint:disable:function-constructor */
import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { createNextProjectPlugins } from '../src'
import { NextProjectPlugini18nConfig } from '../src/internationalization/project'
import { NextPwaProjectPlugin } from '../src/pwa/project-plugin'
import { NextSecurityHeadersProjectPlugin, SECURITY_HEADER_RULES } from '../src/security-headers'
import { addNextConfigHeaderRules } from '../src/next-config-headers'
import { baseUidl, buildStructure, fileContent, installableApp } from './_helpers/pwa-fixtures'

/**
 * Every generated site answers with its security headers, and a site that is
 * also an app serves its service worker and manifests with theirs — from the
 * ONE `headers()` Next.js reads. The config is EXECUTED the way Next loads it,
 * after the plugins that write it ran in the order a real export runs them.
 */

interface Rule {
  source: string
  headers: Array<{ key: string; value: string }>
}

interface NextConfig {
  headers?: () => Promise<Rule[]>
  i18n?: { locales: string[]; defaultLocale: string }
  webpack?: (config: Record<string, any>, options: { isServer: boolean }) => Record<string, any>
}

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(self)',
  // Never includeSubDomains: a merchant's apex domain must not force HTTPS on
  // every subdomain they run elsewhere.
  'Strict-Transport-Security': 'max-age=63072000',
}

const i18nUidl = () =>
  baseUidl({
    pwa: installableApp(),
    internationalization: {
      main: { locale: 'en', name: 'English' },
      languages: { en: 'English', es: 'Español' },
    },
  })

const runPlugins = async (structure: ProjectPluginStructure, plugins: ProjectPlugin[]) => {
  for (const plugin of plugins) {
    await plugin.runAfter(structure)
  }
  return structure
}

const loadConfig = (structure: ProjectPluginStructure): NextConfig => {
  const source = fileContent(structure, 'next.config', 'next.config')
  expect(source).toBeDefined()
  const moduleShim = { exports: {} as NextConfig }
  new Function('module', 'exports', 'require', source as string)(
    moduleShim,
    moduleShim.exports,
    require
  )
  return moduleShim.exports
}

const headersOf = (rules: Rule[], source: string): Record<string, string> | undefined => {
  const rule = rules.find((candidate) => candidate.source === source)
  return rule
    ? rule.headers.reduce<Record<string, string>>((all, header) => {
        all[header.key] = header.value
        return all
      }, {})
    : undefined
}

// The two shapes of source the generator writes: an exact path, and a prefix
// followed by `/:path*` (the prefix and everything below it).
const sourcePattern = (source: string): RegExp => {
  const prefix = source.replace(/\/:path\*$/, '')
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(prefix === source ? `^${escaped}$` : `^${escaped}(?:/.*)?$`)
}

// What a response carries, the way Next.js applies headers(): every rule whose
// source matches, in order, each setting its headers over the ones before it.
const responseHeaders = (rules: Rule[], pathname: string): Record<string, string> =>
  rules
    .filter((rule) => sourcePattern(rule.source).test(pathname))
    .reduce((all, rule) => ({ ...all, ...headersOf(rules, rule.source) }), {})

describe('the security headers of a generated site', () => {
  it('serves them for every path next to the service worker and manifests, keeping i18n and webpack', async () => {
    // The order packProject runs them in: the i18n config writes next.config
    // whole, then the shared list (security headers, then the app).
    const structure = await runPlugins(buildStructure(i18nUidl(), { withNextConfig: false }), [
      new NextProjectPlugini18nConfig(),
      new NextSecurityHeadersProjectPlugin(),
      new NextPwaProjectPlugin(),
    ])
    const config = loadConfig(structure)
    const rules = await config.headers!()

    expect(rules[0].source).toBe('/:path*')
    expect(headersOf(rules, '/:path*')).toEqual(SECURITY)
    expect(headersOf(rules, '/sw.js')).toEqual({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Service-Worker-Allowed': '/',
    })
    const manifestRules = rules.filter((rule) => /manifest/.test(rule.source))
    expect(manifestRules.length).toBeGreaterThan(0)
    for (const rule of manifestRules) {
      expect(headersOf(rules, rule.source)).toEqual({
        'Content-Type': 'application/manifest+json; charset=utf-8',
        'Cache-Control': 'no-cache',
      })
    }
    // Only the keys Next.js accepts in a rule.
    for (const rule of rules) {
      expect(Object.keys(rule).sort()).toEqual(['headers', 'source'])
    }

    expect(config.i18n).toEqual({ locales: ['en', 'es'], defaultLocale: 'en' })
    const server = config.webpack!({ resolve: {}, externals: [] }, { isServer: true })
    expect(server.externals).toHaveLength(1)
    const client = config.webpack!({ resolve: {} }, { isServer: false })
    expect(client.resolve.alias.pg).toBe(false)
  })

  it('ends with the same headers() whichever plugin writes it first', async () => {
    const appFirst = await runPlugins(buildStructure(i18nUidl(), { withNextConfig: false }), [
      new NextProjectPlugini18nConfig(),
      new NextPwaProjectPlugin(),
      new NextSecurityHeadersProjectPlugin(),
    ])
    const rules = await loadConfig(appFirst).headers!()
    expect(headersOf(rules, '/:path*')).toEqual(SECURITY)
    expect(headersOf(rules, '/sw.js')).toBeDefined()
    const source = fileContent(appFirst, 'next.config', 'next.config') as string
    expect(source.match(/async headers\(/g)).toHaveLength(1)
  })

  it('sends no referrer from the sign-in callback, and only from there', async () => {
    // A member back from Google, GitHub or Facebook lands through the
    // callback's redirect: under the site-wide policy it handed on the
    // provider's origin, which opened a new visit in Analytics.
    const callback = '/api/auth/callback/:path*'
    for (const plugins of [
      [
        new NextProjectPlugini18nConfig(),
        new NextSecurityHeadersProjectPlugin(),
        new NextPwaProjectPlugin(),
      ],
      [
        new NextProjectPlugini18nConfig(),
        new NextPwaProjectPlugin(),
        new NextSecurityHeadersProjectPlugin(),
      ],
    ]) {
      const structure = await runPlugins(
        buildStructure(i18nUidl(), { withNextConfig: false }),
        plugins
      )
      const rules = await loadConfig(structure).headers!()

      expect(headersOf(rules, callback)).toEqual({ 'Referrer-Policy': 'no-referrer' })
      const sources = rules.map((rule) => rule.source)
      expect(sources.indexOf(callback)).toBeGreaterThan(sources.indexOf('/:path*'))

      for (const path of ['/api/auth/callback/github', '/api/auth/callback/google']) {
        expect(responseHeaders(rules, path)).toEqual({
          ...SECURITY,
          'Referrer-Policy': 'no-referrer',
        })
      }
      for (const path of ['/', '/account', '/api/auth/session', '/api/auth/signin/github']) {
        expect(responseHeaders(rules, path)).toEqual(SECURITY)
      }
    }
  })

  it('writes a next.config of its own for a project that has none', async () => {
    const structure = await runPlugins(buildStructure(baseUidl(), { withNextConfig: false }), [
      new NextSecurityHeadersProjectPlugin(),
    ])
    const config = loadConfig(structure)
    expect(await config.headers!()).toEqual(SECURITY_HEADER_RULES)
    expect(Object.keys(config)).toEqual(['headers'])
  })

  it('adds a rule it already holds only once, and lets a later value win', async () => {
    const structure = buildStructure(baseUidl())
    addNextConfigHeaderRules(structure, SECURITY_HEADER_RULES)
    addNextConfigHeaderRules(structure, SECURITY_HEADER_RULES)
    addNextConfigHeaderRules(structure, [
      { source: '/:path*', headers: [{ key: 'referrer-policy', value: 'no-referrer' }] },
    ])
    const config = loadConfig(structure)
    const rules = await config.headers!()
    expect(rules).toHaveLength(SECURITY_HEADER_RULES.length)
    expect(rules[0].headers).toHaveLength(4)
    expect(headersOf(rules, '/:path*')!['referrer-policy']).toBe('no-referrer')
    expect(config.i18n).toEqual({ locales: ['en', 'es'], defaultLocale: 'en' })
  })

  it('leaves a headers() it did not write alone', async () => {
    const foreign = `module.exports = {\n  async headers() {\n    return [{ source: '/x', headers: [] }]\n  },\n}\n`
    const structure = buildStructure(baseUidl(), { withNextConfig: false })
    structure.files.set('next.config', {
      path: [],
      files: [{ name: 'next.config', fileType: FileType.JS, content: foreign }],
    })
    await new NextSecurityHeadersProjectPlugin().runAfter(structure)
    expect(fileContent(structure, 'next.config', 'next.config')).toBe(foreign)
  })

  it('is part of every Next export, ahead of the app plugin', () => {
    const plugins = createNextProjectPlugins()
    const security = plugins.findIndex(
      (plugin) => plugin instanceof NextSecurityHeadersProjectPlugin
    )
    const app = plugins.findIndex((plugin) => plugin instanceof NextPwaProjectPlugin)
    expect(security).toBeGreaterThan(-1)
    expect(security).toBeLessThan(app)
  })

  it('never blocks framing nor sets a CSP: the editor preview frames the site from another origin', () => {
    const keys = SECURITY_HEADER_RULES[0].headers.map((header) => header.key.toLowerCase())
    expect(keys).not.toContain('x-frame-options')
    expect(keys).not.toContain('content-security-policy')
  })
})
