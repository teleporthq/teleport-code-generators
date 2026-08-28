import { UIDLUtils } from '@teleporthq/teleport-shared'
import {
  FileType,
  GeneratedFile,
  ProjectPlugin,
  ProjectPluginStructure,
  UIDLElement,
} from '@teleporthq/teleport-types'

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

const withInlineStyle = (html: string): string => {
  const styleTag = `<style>\n${SNAP_INTO_VIEW_CSS}</style>\n`
  return html.includes('</head>')
    ? html.replace('</head>', `${styleTag}</head>`)
    : `${styleTag}${html}`
}

export class ProjectPluginSnapIntoView implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    if (!projectUsesSnapIntoView(structure.uidl)) {
      return structure
    }

    const styleSheet = structure.files.get('projectStyleSheet')
    const globalCss = styleSheet?.files.find((file) => file.fileType === FileType.CSS)
    if (styleSheet && globalCss) {
      structure.files.set('projectStyleSheet', {
        ...styleSheet,
        files: styleSheet.files.map((file: GeneratedFile) =>
          file === globalCss
            ? { ...file, content: `${file.content.trimEnd()}\n\n${SNAP_INTO_VIEW_CSS}` }
            : file
        ),
      })
      return structure
    }

    // No global stylesheet to extend (no tokens, no style sets): every page
    // carries the rule inline instead.
    structure.files.forEach((entry, key) => {
      structure.files.set(key, {
        ...entry,
        files: entry.files.map((file: GeneratedFile) =>
          file.fileType === FileType.HTML
            ? { ...file, content: withInlineStyle(file.content) }
            : file
        ),
      })
    })
    return structure
  }
}

export const pluginSnapIntoView = new ProjectPluginSnapIntoView()
