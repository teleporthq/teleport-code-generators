import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { projectUsesElementTypes } from '../uidl-element-traversal'
import { generateDragDropComponentCode } from './component-generator'

export const DRAG_DROP_ELEMENT_TYPES = new Set([
  'thq-drag-area',
  'thq-draggable',
  'thq-droppable',
  'thq-sortable',
  'thq-sortable-item',
])

/**
 * Activates when a generated project uses any drag-and-drop primitive
 * (drag area / draggable / droppable / sortable):
 *  - emits the dnd-kit-based wrapper components to components/tq-drag-drop.js
 *  - adds the @dnd-kit npm dependencies
 *
 * dnd-kit peers react >=16.8, so no React version changes are needed.
 */
export class NextDragDropProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files, dependencies } = structure

    if (!projectUsesElementTypes(uidl, DRAG_DROP_ELEMENT_TYPES)) {
      return structure
    }

    files.set('tq-drag-drop-component', {
      path: ['components'],
      files: [
        {
          name: 'tq-drag-drop',
          fileType: FileType.JS,
          content: generateDragDropComponentCode(),
        },
      ],
    })

    dependencies['@dnd-kit/core'] = '^6.3.1'
    dependencies['@dnd-kit/sortable'] = '^10.0.0'
    dependencies['@dnd-kit/utilities'] = '^3.2.2'

    return structure
  }
}
