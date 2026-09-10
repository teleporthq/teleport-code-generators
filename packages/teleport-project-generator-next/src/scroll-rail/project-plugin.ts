import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { injectSiblingIntoApp } from '../app-sibling-injection'
import { traverseProjectElements } from '../uidl-element-traversal'
import { SCROLL_RAIL_ATTRS, generateScrollRailComponentCode } from './scroll-rail-component'

/** True when any element anywhere in the project carries a scroll-rail behavior. */
export const projectUsesScrollRail = (uidl: ProjectPluginStructure['uidl']): boolean => {
  let used = false
  traverseProjectElements(uidl, (element) => {
    if (SCROLL_RAIL_ATTRS.some((attr) => element.attrs?.[attr] !== undefined)) {
      used = true
    }
  })
  return used
}

/**
 * Ships the scroll-rail controller only when the project uses it: one
 * null-rendering component next to the app's JSX, no npm dependency. The
 * rails need nothing else — their data-scroll-rail-* attrs pass through as
 * plain HTML attributes.
 */
export class NextScrollRailProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    if (!projectUsesScrollRail(structure.uidl)) {
      return structure
    }
    structure.files.set('tq-scroll-rail', {
      path: ['components'],
      files: [
        {
          name: 'tq-scroll-rail',
          fileType: FileType.JS,
          content: generateScrollRailComponentCode(),
        },
      ],
    })
    injectSiblingIntoApp(structure, {
      componentName: 'TqScrollRail',
      importStatement: `import TqScrollRail from '../components/tq-scroll-rail';\n`,
    })
    return structure
  }
}
