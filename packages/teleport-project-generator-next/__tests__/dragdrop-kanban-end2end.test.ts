import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

// The production template (react ^17) — the same one the GUI publish path
// feeds into packProject.
const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

const textChild = (content: string) => ({ type: 'static', content })

const DRAG_AREA_NODE = {
  type: 'element',
  content: {
    elementType: 'thq-drag-area',
    name: 'tasks-drag-area',
    children: [
      {
        type: 'element',
        content: {
          elementType: 'thq-droppable',
          name: 'todo-zone',
          attrs: { dropId: { type: 'static', content: 'todo' } },
          children: [
            {
              type: 'element',
              content: {
                elementType: 'thq-draggable',
                name: 'task-card',
                attrs: { dragId: { type: 'static', content: 'task-1' } },
                children: [textChild('Write the report')],
              },
            },
          ],
        },
      },
      {
        type: 'element',
        content: {
          elementType: 'thq-droppable',
          name: 'done-zone',
          attrs: { dropId: { type: 'static', content: 'done' } },
          children: [],
        },
      },
    ],
  },
}

const SORTABLE_NODE = {
  type: 'element',
  content: {
    elementType: 'thq-sortable',
    name: 'priority-list',
    attrs: { direction: { type: 'static', content: 'vertical' } },
    children: [
      {
        type: 'element',
        content: {
          elementType: 'thq-sortable-item',
          name: 'priority-item',
          children: [textChild('First priority')],
        },
      },
      {
        type: 'element',
        content: {
          elementType: 'thq-sortable-item',
          name: 'priority-item-2',
          children: [textChild('Second priority')],
        },
      },
    ],
  },
}

const KANBAN_NODE = {
  type: 'element',
  content: {
    elementType: 'kanban-node',
    name: 'project-board',
    attrs: {
      board: {
        type: 'static',
        content: {
          columns: [
            {
              id: 'todo',
              title: 'To Do',
              cards: [{ id: '1', title: 'Design review', description: 'Review mockups' }],
            },
            { id: 'done', title: 'Done', cards: [] },
          ],
        },
      },
      disableColumnDrag: { type: 'static', content: true },
    },
    children: [],
  },
}

const buildUidl = (): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  const indexPage = (uidl.root.node.content.children || []).find(
    (child) =>
      child.type === 'conditional' && (child.content as { value?: string }).value === 'index'
  )
  const pageElement = (indexPage as { content: { node: { content: { children: unknown[] } } } })
    .content.node.content
  pageElement.children.push(DRAG_AREA_NODE, SORTABLE_NODE, KANBAN_NODE)
  return uidl
}

const findFile = (folder: GeneratedFolder, folderName: string, fileName: string) =>
  folder.subFolders
    .find((sub) => sub.name === folderName)
    ?.files.find((file) => file.name === fileName)

describe('Next generator with drag-and-drop and kanban primitives', () => {
  const generator = createNextProjectGenerator()

  it('generates the wrapper components, page imports and dependencies', async () => {
    const outputFolder = await generator.generateProject(buildUidl(), template)

    const packageFile = outputFolder.files.find((file) => file.name === 'package')
    const packageJson = JSON.parse(packageFile?.content || '{}')
    expect(packageJson.dependencies['@dnd-kit/core']).toBe('^6.3.1')
    expect(packageJson.dependencies['@dnd-kit/sortable']).toBe('^10.0.0')
    expect(packageJson.dependencies['@dnd-kit/utilities']).toBe('^3.2.2')
    expect(packageJson.dependencies['@asseinfo/react-kanban']).toBe('2.2.0')
    // Neither library requires a react bump on its own.
    expect(packageJson.dependencies.react).toBe('^17.0.2')

    const dragDropComponent = findFile(outputFolder, 'components', 'tq-drag-drop')
    expect(dragDropComponent?.content).toContain('export const TqDragArea')
    expect(dragDropComponent?.content).toContain("from '@dnd-kit/core'")

    const kanbanComponent = findFile(outputFolder, 'components', 'tq-kanban')
    expect(kanbanComponent?.content).toContain('initialBoard')
    expect(kanbanComponent?.content).toContain('ssr: false')

    const indexPage = findFile(outputFolder, 'pages', 'index')
    expect(indexPage?.content).toContain('TqDragArea')
    expect(indexPage?.content).toContain('TqDraggable')
    expect(indexPage?.content).toContain('TqDroppable')
    expect(indexPage?.content).toContain('TqSortable')
    expect(indexPage?.content).toContain("from '../components/tq-drag-drop'")
    expect(indexPage?.content).toContain('TqKanban')
    expect(indexPage?.content).toContain("from '../components/tq-kanban'")
    expect(indexPage?.content).toContain('dragId="task-1"')
    expect(indexPage?.content).toContain('dropId="todo"')

    const npmrc = outputFolder.files.find((file) => file.name === '.npmrc')
    expect(npmrc?.content).toContain('legacy-peer-deps=true')

    const appFile = findFile(outputFolder, 'pages', '_app')
    expect(appFile?.content).toContain("import '@asseinfo/react-kanban/dist/styles.css'")
  })

  it('emits none of the wrappers for projects without these primitives', async () => {
    const outputFolder = await generator.generateProject(
      JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL,
      JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder
    )

    const componentsFolder = outputFolder.subFolders.find((sub) => sub.name === 'components')
    expect(componentsFolder?.files.find((file) => file.name === 'tq-drag-drop')).toBeUndefined()
    expect(componentsFolder?.files.find((file) => file.name === 'tq-kanban')).toBeUndefined()
    expect(outputFolder.files.find((file) => file.name === '.npmrc')).toBeUndefined()

    const packageFile = outputFolder.files.find((file) => file.name === 'package')
    const packageJson = JSON.parse(packageFile?.content || '{}')
    expect(packageJson.dependencies['@dnd-kit/core']).toBeUndefined()
    expect(packageJson.dependencies['@asseinfo/react-kanban']).toBeUndefined()
  })
})
