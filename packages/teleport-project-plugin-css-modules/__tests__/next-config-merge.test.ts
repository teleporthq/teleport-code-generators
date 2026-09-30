/* tslint:disable:function-constructor */
import { FileType, InMemoryFileRecord, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { nextAfterModifier } from '../src/next'

/**
 * The CSS-modules plugin runs after every other project plugin, and it used to
 * write `next.config.js` from scratch — dropping the i18n locales, the pg
 * webpack externals and every response header the generator serves (security,
 * service worker). It now appends its webpack change to the config it finds,
 * run after the config's own webpack. Verified by executing the result.
 */

const EXISTING_CONFIG = `module.exports = {
  async headers() {
    return /* teleport:header-rules */ [
      {
        "source": "/:path*",
        "headers": [{ "key": "X-Content-Type-Options", "value": "nosniff" }]
      }
    ] /* /teleport:header-rules */
  },
  i18n: {
    locales: ['en', 'es'],
    defaultLocale: "en",
  },
  webpack: (config, { isServer }) => {
    config.seenByI18nWebpack = isServer ? 'server' : 'client'
    return config
  }
}
`

const structureWith = (nextConfig: string | null): ProjectPluginStructure => {
  const files = new Map<string, InMemoryFileRecord>()
  files.set('_app', {
    path: ['pages'],
    files: [
      {
        name: '_app',
        fileType: FileType.JS,
        content: 'export default function App() { return null }',
      },
    ],
  })
  if (nextConfig !== null) {
    files.set('next.config', {
      path: [],
      files: [{ name: 'next.config', fileType: FileType.JS, content: nextConfig }],
    })
  }
  return {
    files,
    template: { name: 'root', files: [], subFolders: [] },
  } as unknown as ProjectPluginStructure
}

const loadConfig = (structure: ProjectPluginStructure): any => {
  const record = structure.files.get('next.config')
  const file = record.files.find((entry) => entry.name === 'next.config')
  const moduleObj: { exports: any } = { exports: {} }
  new Function('module', 'exports', file.content)(moduleObj, moduleObj.exports)
  return { config: moduleObj.exports, content: file.content }
}

// A webpack config shaped like Next's, with the CSS-modules loader to flip.
const webpackConfig = () => {
  const cssLoader = { loader: '/x/css-loader/index.js', options: { modules: { mode: 'pure' } } }
  return {
    cssLoader,
    config: {
      module: {
        rules: [
          { oneOf: [{ test: /\.module\.css$/, use: [{ loader: 'style-loader' }, cssLoader] }] },
        ],
      },
    } as Record<string, any>,
  }
}

describe('css-modules next.config — merged, never replaced', () => {
  it('keeps the headers, the locales and the existing webpack, and adds its own after it', async () => {
    const structure = structureWith(EXISTING_CONFIG)
    await nextAfterModifier(structure)
    const { config, content } = loadConfig(structure)

    expect(content).toContain('/* teleport:header-rules */')
    expect(await config.headers()).toEqual([
      { source: '/:path*', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }] },
    ])
    expect(config.i18n).toEqual({ locales: ['en', 'es'], defaultLocale: 'en' })

    const { config: built, cssLoader } = webpackConfig()
    const result = config.webpack(built, { isServer: true })
    expect(result.seenByI18nWebpack).toBe('server')
    expect(cssLoader.options.modules.mode).toBe('local')
  })

  it('writes a config of its own when the project has none', async () => {
    const structure = structureWith(null)
    await nextAfterModifier(structure)
    const { config } = loadConfig(structure)
    const { config: built, cssLoader } = webpackConfig()
    expect(config.webpack(built, { isServer: false })).toBe(built)
    expect(cssLoader.options.modules.mode).toBe('local')
  })

  it('adds its change once, however often it runs', async () => {
    const structure = structureWith(EXISTING_CONFIG)
    await nextAfterModifier(structure)
    const once = loadConfig(structure).content
    await nextAfterModifier(structure)
    expect(loadConfig(structure).content).toBe(once)
  })
})
