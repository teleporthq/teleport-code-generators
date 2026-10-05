import { UIDLUtils } from '@teleporthq/teleport-shared'
import { ProjectPlugin, ProjectPluginStructure, UIDLElement } from '@teleporthq/teleport-types'
import { appendGlobalCss } from './global-css'

/**
 * "Snap into view" for the static HTML export. The Next export ships a small
 * page-level controller (tq-snap-into-view); a static site ships no script,
 * so it gets the native half only: CSS proximity snapping, which the browser
 * runs momentum-aware and never traps. Gentle and firm both read as the
 * native proximity snap here. Emitted only when an element opted in; the
 * attribute itself passes through as a plain HTML attribute.
 */
export const SNAP_INTO_VIEW_ATTR = 'data-snap-into-view'
const ACCEPTED_VALUES = ['true', 'gentle', 'firm']

export const SNAP_INTO_VIEW_CSS =
  'html {\n  scroll-snap-type: y proximity;\n}\n' +
  ACCEPTED_VALUES.map((value) => `[${SNAP_INTO_VIEW_ATTR}="${value}"]`).join(',\n') +
  ' {\n  scroll-snap-align: start;\n}\n'

const elementOptsIn = (element: UIDLElement): boolean => {
  const attr = element.attrs?.[SNAP_INTO_VIEW_ATTR] as { content?: unknown } | undefined
  return !!attr && ACCEPTED_VALUES.includes(String(attr.content))
}

export const projectUsesSnapIntoView = (uidl: ProjectPluginStructure['uidl']): boolean => {
  let used = false
  const visit = (element: UIDLElement) => {
    if (elementOptsIn(element)) {
      used = true
    }
  }
  UIDLUtils.traverseElements(uidl.root.node, visit)
  Object.values(uidl.components || {}).forEach((component) => {
    UIDLUtils.traverseElements(component.node, visit)
  })
  return used
}

export class ProjectPluginSnapIntoView implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    if (!projectUsesSnapIntoView(structure.uidl)) {
      return structure
    }
    appendGlobalCss(structure, SNAP_INTO_VIEW_CSS)
    return structure
  }
}

export const pluginSnapIntoView = new ProjectPluginSnapIntoView()
