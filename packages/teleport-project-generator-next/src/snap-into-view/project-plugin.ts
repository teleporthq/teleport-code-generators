import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { injectSiblingIntoApp } from '../app-sibling-injection'
import { traverseProjectElements } from '../uidl-element-traversal'
import { SNAP_INTO_VIEW_ATTR, generateSnapIntoViewComponentCode } from './snap-into-view-component'

/** True when any element anywhere in the project opted into Snap into view. */
export const projectUsesSnapIntoView = (uidl: ProjectPluginStructure['uidl']): boolean => {
  let used = false
  traverseProjectElements(uidl, (element) => {
    const attr = element.attrs?.[SNAP_INTO_VIEW_ATTR]
    const value = attr ? String((attr as { content?: unknown }).content) : ''
    if (value === 'true' || value === 'gentle' || value === 'firm') {
      used = true
    }
  })
  return used
}

/**
 * Ships the page-level Snap-into-view controller only when the project uses
 * it: one null-rendering component next to the app's JSX, no npm dependency.
 * The opted-in elements need nothing else — their data-snap-into-view attr
 * passes through as a plain HTML attribute.
 */
export class NextSnapIntoViewProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    if (!projectUsesSnapIntoView(structure.uidl)) {
      return structure
    }
    structure.files.set('tq-snap-into-view', {
      path: ['components'],
      files: [
        {
          name: 'tq-snap-into-view',
          fileType: FileType.JS,
          content: generateSnapIntoViewComponentCode(),
        },
      ],
    })
    injectSiblingIntoApp(structure, {
      componentName: 'TqSnapIntoView',
      importStatement: `import TqSnapIntoView from '../components/tq-snap-into-view';\n`,
    })
    return structure
  }
}
