import {
  FileType,
  InMemoryFileRecord,
  ProjectPluginStructure,
  ProjectUIDL,
  UIDLElementNode,
} from '@teleporthq/teleport-types'
import { NextDragDropProjectPlugin } from '../src/drag-drop/project-plugin'
import { NextKanbanProjectPlugin } from '../src/kanban/project-plugin'

const APP_CONTENT = `import './style.css'

export default function MyApp({ Component, pageProps }) {
  return <Component {...pageProps} />
}
`

const elementNode = (elementType: string, children: UIDLElementNode[] = []): UIDLElementNode => ({
  type: 'element',
  content: {
    elementType,
    children,
  },
})

const buildStructure = (pageChildren: UIDLElementNode[]): ProjectPluginStructure => {
  const files = new Map<string, InMemoryFileRecord>()
  files.set('_app', {
    path: ['pages'],
    files: [{ name: '_app', fileType: FileType.JS, content: APP_CONTENT }],
  })

  const uidl = {
    name: 'test',
    root: {
      name: 'App',
      node: elementNode('container', pageChildren),
    },
    components: {},
  } as unknown as ProjectUIDL

  return {
    uidl,
    files,
    dependencies: {},
    devDependencies: {},
  } as unknown as ProjectPluginStructure
}

describe('NextDragDropProjectPlugin', () => {
  const plugin = new NextDragDropProjectPlugin()

  it('is a no-op for projects without drag-and-drop primitives', async () => {
    const structure = buildStructure([elementNode('container')])

    await plugin.runAfter(structure)

    expect(structure.files.has('tq-drag-drop-component')).toBe(false)
    expect(structure.dependencies['@dnd-kit/core']).toBeUndefined()
  })

  it.each(['thq-drag-area', 'thq-draggable', 'thq-droppable', 'thq-sortable', 'thq-sortable-item'])(
    'emits the wrapper file and dnd-kit deps when %s is used',
    async (primitive) => {
      const structure = buildStructure([elementNode(primitive)])

      await plugin.runAfter(structure)

      const record = structure.files.get('tq-drag-drop-component')
      expect(record?.path).toEqual(['components'])
      expect(record?.files[0].name).toBe('tq-drag-drop')
      expect(record?.files[0].content).toContain('export const TqDragArea')
      expect(record?.files[0].content).toContain('export const TqSortable')
      expect(structure.dependencies['@dnd-kit/core']).toBe('^6.3.1')
      expect(structure.dependencies['@dnd-kit/sortable']).toBe('^10.0.0')
      expect(structure.dependencies['@dnd-kit/utilities']).toBe('^3.2.2')
    }
  )

  it('detects primitives nested deep in the tree', async () => {
    const structure = buildStructure([
      elementNode('container', [elementNode('container', [elementNode('thq-sortable')])]),
    ])

    await plugin.runAfter(structure)

    expect(structure.files.has('tq-drag-drop-component')).toBe(true)
  })
})

describe('NextKanbanProjectPlugin', () => {
  const plugin = new NextKanbanProjectPlugin()

  it('is a no-op for projects without a kanban board', async () => {
    const structure = buildStructure([elementNode('container')])

    await plugin.runAfter(structure)

    expect(structure.files.has('tq-kanban-component')).toBe(false)
    expect(structure.files.has('tq-kanban-npmrc')).toBe(false)
    expect(structure.dependencies['@asseinfo/react-kanban']).toBeUndefined()
    const appContent = structure.files.get('_app')?.files[0].content as string
    expect(appContent).toBe(APP_CONTENT)
  })

  it('emits the wrapper, dependency, stylesheet import and .npmrc when used', async () => {
    const structure = buildStructure([elementNode('kanban-node')])

    await plugin.runAfter(structure)

    const componentRecord = structure.files.get('tq-kanban-component')
    expect(componentRecord?.path).toEqual(['components'])
    expect(componentRecord?.files[0].name).toBe('tq-kanban')
    expect(componentRecord?.files[0].content).toContain(
      "dynamic(() => import('@asseinfo/react-kanban')"
    )
    expect(componentRecord?.files[0].content).toContain('ssr: false')
    expect(componentRecord?.files[0].content).toContain('initialBoard')

    const npmrcRecord = structure.files.get('tq-kanban-npmrc')
    expect(npmrcRecord?.path).toEqual([])
    expect(npmrcRecord?.files[0].name).toBe('.npmrc')
    expect(npmrcRecord?.files[0].fileType).toBeUndefined()
    expect(npmrcRecord?.files[0].content).toContain('legacy-peer-deps=true')

    expect(structure.dependencies['@asseinfo/react-kanban']).toBe('2.2.0')

    const appContent = structure.files.get('_app')?.files[0].content as string
    expect(appContent).toContain("import '@asseinfo/react-kanban/dist/styles.css'")
    expect(appContent.indexOf('@asseinfo/react-kanban/dist/styles.css')).toBeLessThan(
      appContent.indexOf('./style.css')
    )
  })

  it('is idempotent when run twice', async () => {
    const structure = buildStructure([elementNode('kanban-node')])

    await plugin.runAfter(structure)
    await plugin.runAfter(structure)

    const appContent = structure.files.get('_app')?.files[0].content as string
    expect(appContent.match(/@asseinfo\/react-kanban\/dist\/styles\.css/g)).toHaveLength(1)
  })
})
