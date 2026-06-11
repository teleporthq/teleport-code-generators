import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { NextAnalyticsProjectPlugin } from '../src/analytics/project-plugin'

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

function makeStructure(analyticsEnabled: boolean): ProjectPluginStructure {
  const files = new Map()
  files.set('_app', {
    path: ['pages'],
    files: [{ name: '_app', fileType: FileType.JS, content: APP_CONTENT }],
  })

  return {
    uidl: {
      name: 'test-project',
      globals: { settings: { title: 'Test', language: 'en' }, assets: [] },
      root: {} as never,
      ...(analyticsEnabled ? { analytics: { enabled: true } } : {}),
    },
    files,
    dependencies: {},
    devDependencies: {},
    template: { files: [], subFolders: [] },
  } as unknown as ProjectPluginStructure
}

describe('NextAnalyticsProjectPlugin', () => {
  it('does nothing when analytics is not enabled', async () => {
    const plugin = new NextAnalyticsProjectPlugin()
    const structure = makeStructure(false)

    await plugin.runAfter(structure)

    expect(structure.files.has('teleport-analytics-lib')).toBe(false)
    expect(structure.files.has('teleport-analytics-tracker')).toBe(false)

    const appFile = structure.files.get('_app').files[0]
    expect(appFile.content).not.toContain('AnalyticsTracker')
  })

  it('emits the tracker lib + component and wires the env placeholders', async () => {
    const plugin = new NextAnalyticsProjectPlugin()
    const structure = makeStructure(true)

    await plugin.runAfter(structure)

    const lib = structure.files.get('teleport-analytics-lib')
    expect(lib.path).toEqual(['lib'])
    expect(lib.files[0].name).toBe('teleport-analytics')
    expect(lib.files[0].content).toContain('NEXT_PUBLIC_TELEPORT_ANALYTICS_URL')
    expect(lib.files[0].content).toContain('initTeleportAnalytics')
    expect(lib.files[0].content).toContain('sendBeacon')
    expect(lib.files[0].content).toContain("localStorage.getItem('cookieConsent')")

    const tracker = structure.files.get('teleport-analytics-tracker')
    expect(tracker.path).toEqual(['components', 'analytics'])
    expect(tracker.files[0].content).toContain('routeChangeComplete')

    expect(structure.uidl.globals.env).toEqual({
      NEXT_PUBLIC_TELEPORT_ANALYTICS_URL: 'teleporthq.secrets.NEXT_PUBLIC_TELEPORT_ANALYTICS_URL',
      NEXT_PUBLIC_TELEPORT_ANALYTICS_KEY: 'teleporthq.secrets.NEXT_PUBLIC_TELEPORT_ANALYTICS_KEY',
    })
  })

  it('injects <AnalyticsTracker /> into _app as a fragment sibling', async () => {
    const plugin = new NextAnalyticsProjectPlugin()
    const structure = makeStructure(true)

    await plugin.runAfter(structure)

    const appFile = structure.files.get('_app').files[0]
    expect(appFile.content).toContain(
      "import AnalyticsTracker from '../components/analytics/AnalyticsTracker'"
    )
    expect(appFile.content).toContain('<AnalyticsTracker /></>')
    expect(appFile.content).toContain('<>')
    // Idempotent: a second run must not double-inject
    await plugin.runAfter(structure)
    const occurrences = appFile.content.split('<AnalyticsTracker />').length - 1
    expect(occurrences).toBe(1)
  })

  it('preserves env values already set by the GUI mapper', async () => {
    const plugin = new NextAnalyticsProjectPlugin()
    const structure = makeStructure(true)
    structure.uidl.globals.env = {
      NEXT_PUBLIC_TELEPORT_ANALYTICS_URL: 'teleporthq.secrets.NEXT_PUBLIC_TELEPORT_ANALYTICS_URL',
      NEXT_PUBLIC_TELEPORT_ANALYTICS_KEY: 'teleporthq.secrets.NEXT_PUBLIC_TELEPORT_ANALYTICS_KEY',
      OTHER_KEY: 'value',
    }

    await plugin.runAfter(structure)

    expect(Object.keys(structure.uidl.globals.env)).toHaveLength(3)
    expect(structure.uidl.globals.env.OTHER_KEY).toBe('value')
  })
})
