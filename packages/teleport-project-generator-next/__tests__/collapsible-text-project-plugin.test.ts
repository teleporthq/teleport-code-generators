import { parse } from '@babel/parser'
import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { NextCollapsibleTextProjectPlugin } from '../src/collapsible-text/project-plugin'

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

function makeStructure(): ProjectPluginStructure {
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
    },
    files,
    dependencies: {},
    devDependencies: {},
    template: { files: [], subFolders: [] },
  } as unknown as ProjectPluginStructure
}

describe('NextCollapsibleTextProjectPlugin', () => {
  it('emits the null-rendering overflow helper component', async () => {
    const plugin = new NextCollapsibleTextProjectPlugin()
    const structure = makeStructure()

    await plugin.runAfter(structure)

    const component = structure.files.get('tq-collapsible-text-overflow')
    expect(component).toBeDefined()
    expect(component.path).toEqual(['components'])
    expect(component.files[0].name).toBe('tq-collapsible-text-overflow')

    const src = component.files[0].content as string
    // Measures the clamped view and stamps the overflow verdict on the root.
    expect(src).toContain('[data-tq-collapsible-clamp]')
    expect(src).toContain('scrollHeight')
    expect(src).toContain('clientHeight')
    expect(src).toContain("setAttribute('data-tq-overflows'")
    // Ships the CSS rule that hides Show more when the text does not overflow.
    expect(src).toContain('[data-tq-overflows="false"] [data-tq-collapsible-more]')
    expect(src).toContain('display:none')
    // Re-measures on resize + DOM changes (SPA nav, expand/collapse remounts).
    expect(src).toContain("addEventListener('resize'")
    expect(src).toContain('MutationObserver')
    // Null-rendering React component.
    expect(src).toContain('return null')
  })

  it('injects <TqCollapsibleTextOverflow /> into _app as a fragment sibling, idempotently', async () => {
    const plugin = new NextCollapsibleTextProjectPlugin()
    const structure = makeStructure()

    await plugin.runAfter(structure)

    const appFile = structure.files.get('_app').files[0]
    expect(appFile.content).toContain(
      "import TqCollapsibleTextOverflow from '../components/tq-collapsible-text-overflow'"
    )
    expect(appFile.content).toContain('<TqCollapsibleTextOverflow /></>')
    expect(appFile.content).toContain('<>')

    // A second run must not double-inject.
    await plugin.runAfter(structure)
    const occurrences = appFile.content.split('<TqCollapsibleTextOverflow />').length - 1
    expect(occurrences).toBe(1)
  })

  it('produces a still-parseable _app after the string surgery', async () => {
    const plugin = new NextCollapsibleTextProjectPlugin()
    const structure = makeStructure()

    await plugin.runAfter(structure)

    const appFile = structure.files.get('_app').files[0]
    expect(() =>
      parse(appFile.content as string, {
        sourceType: 'module',
        plugins: ['jsx'],
      })
    ).not.toThrow()
  })
})
