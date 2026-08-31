import { FileType, ProjectPluginStructure, UIDLElement } from '@teleporthq/teleport-types'
import { NextPaginationScrollProjectPlugin } from '../src/pagination-scroll/project-plugin'
import {
  LIST_CHROME_ATTR,
  LIST_CONTROLS_ELEMENT_TYPE,
  PAGINATION_ATTR,
  PAGINATION_ELEMENT_TYPE,
} from '../src/pagination-scroll/constants'
import { traverseProjectElements } from '../src/uidl-element-traversal'

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

const element = (elementType: string, children: unknown[] = []) => ({
  type: 'element',
  content: { elementType, children },
})

/**
 * A project whose page holds the list controls and the pagination block, and
 * whose COMPONENT holds a second pagination block — the marker pass has to
 * reach both, since a mapper can live in either.
 */
const makeStructure = (options: { withPagination: boolean }): ProjectPluginStructure => {
  const files = new Map()
  files.set('_app', {
    path: ['pages'],
    files: [{ name: '_app', fileType: FileType.JS, content: APP_CONTENT }],
  })

  const pageChildren: unknown[] = [element(LIST_CONTROLS_ELEMENT_TYPE), element('container')]
  const componentChildren: unknown[] = [element('container')]
  if (options.withPagination) {
    pageChildren.push(element(PAGINATION_ELEMENT_TYPE))
    componentChildren.push(element(PAGINATION_ELEMENT_TYPE))
  }

  return {
    uidl: {
      name: 'test-project',
      globals: { settings: { title: 'Test', language: 'en' }, assets: [] },
      root: { node: element('container', pageChildren) },
      components: {
        'product-card': { node: element('container', componentChildren) },
      },
    },
    files,
    dependencies: {},
    devDependencies: {},
    template: { files: [], subFolders: [] },
  } as unknown as ProjectPluginStructure
}

const collectMarked = (structure: ProjectPluginStructure, attribute: string): UIDLElement[] => {
  const marked: UIDLElement[] = []
  traverseProjectElements(structure.uidl, (uidlElement) => {
    if (uidlElement.attrs?.[attribute]) {
      marked.push(uidlElement)
    }
  })
  return marked
}

const appContent = (structure: ProjectPluginStructure): string =>
  (structure.files.get('_app')?.files[0]?.content as string) ?? ''

describe('NextPaginationScrollProjectPlugin', () => {
  it('marks every pagination block and every list-controls block in the project', async () => {
    const plugin = new NextPaginationScrollProjectPlugin()
    const structure = await plugin.runBefore(makeStructure({ withPagination: true }))

    const paginationNodes = collectMarked(structure, PAGINATION_ATTR)
    expect(paginationNodes).toHaveLength(2)
    paginationNodes.forEach((node) => {
      expect(node.elementType).toBe(PAGINATION_ELEMENT_TYPE)
      expect(node.attrs[PAGINATION_ATTR]).toEqual({ type: 'static', content: 'true' })
    })

    const chromeNodes = collectMarked(structure, LIST_CHROME_ATTR)
    expect(chromeNodes).toHaveLength(1)
    expect(chromeNodes[0].elementType).toBe(LIST_CONTROLS_ELEMENT_TYPE)
  })

  it('emits the runtime once and imports it from _app', async () => {
    const plugin = new NextPaginationScrollProjectPlugin()
    const structure = await plugin.runAfter(
      await plugin.runBefore(makeStructure({ withPagination: true }))
    )

    const runtime = structure.files.get('pagination-scroll-runtime')
    expect(runtime?.path).toEqual(['utils'])
    expect(runtime?.files[0].name).toBe('pagination-scroll')
    expect(runtime?.files[0].fileType).toBe(FileType.JS)
    expect(runtime?.files[0].content).toContain(PAGINATION_ATTR)

    expect(appContent(structure)).toContain("import '../utils/pagination-scroll'")
  })

  it('leaves a project without pagination completely untouched', async () => {
    const plugin = new NextPaginationScrollProjectPlugin()
    const structure = await plugin.runAfter(
      await plugin.runBefore(makeStructure({ withPagination: false }))
    )

    expect(collectMarked(structure, PAGINATION_ATTR)).toHaveLength(0)
    // The controls marker is only useful next to a pagination block.
    expect(collectMarked(structure, LIST_CHROME_ATTR)).toHaveLength(0)
    expect(structure.files.get('pagination-scroll-runtime')).toBeUndefined()
    expect(appContent(structure)).not.toContain('utils/pagination-scroll')
  })

  it('is idempotent, so a second pass cannot double-import or restamp', async () => {
    const plugin = new NextPaginationScrollProjectPlugin()
    let structure = await plugin.runBefore(makeStructure({ withPagination: true }))
    structure = await plugin.runAfter(structure)
    structure = await plugin.runBefore(structure)
    structure = await plugin.runAfter(structure)

    expect(collectMarked(structure, PAGINATION_ATTR)).toHaveLength(2)
    expect(appContent(structure).match(/utils\/pagination-scroll/g)).toHaveLength(1)
  })
})
