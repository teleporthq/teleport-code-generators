import {
  FileType,
  ProjectPlugin,
  ProjectPluginStructure,
  UIDLElement,
  UIDLNode,
} from '@teleporthq/teleport-types'
import { generateRichTextEditorComponentCode } from './component-generator'

interface RichTextEditorUsageInfo {
  themes: Set<string>
  hasFormulaFormat: boolean
}

/**
 * Traverses a UIDL node tree and calls `fn` for every UIDLElement found.
 * Handles element nodes, conditionals, repeats, slots, CMS nodes, and
 * data-source nodes.
 */
const traverseElements = (node: UIDLNode, fn: (element: UIDLElement) => void) => {
  if (!node || !node.type) {
    return
  }

  switch (node.type) {
    case 'element': {
      const content = node.content as UIDLElement
      fn(content)

      if (content.children) {
        for (const child of content.children) {
          traverseElements(child, fn)
        }
      }

      if (content.attrs) {
        for (const attrKey of Object.keys(content.attrs)) {
          const attrValue = content.attrs[attrKey]
          if (attrValue.type === 'element') {
            traverseElements(attrValue, fn)
          }
        }
      }
      break
    }

    case 'repeat':
      traverseElements((node.content as any).node, fn)
      break

    case 'conditional':
      traverseElements((node.content as any).node, fn)
      if ((node.content as any).fallback) {
        traverseElements((node.content as any).fallback, fn)
      }
      break

    case 'slot':
      if ((node.content as any).fallback) {
        traverseElements((node.content as any).fallback, fn)
      }
      break

    case 'cms-item':
    case 'cms-list':
    case 'cms-mixed-type':
      if ((node.content as any).nodes?.success) {
        traverseElements((node.content as any).nodes.success, fn)
      }
      if ((node.content as any).nodes?.error) {
        traverseElements((node.content as any).nodes.error, fn)
      }
      if ((node.content as any).nodes?.loading) {
        traverseElements((node.content as any).nodes.loading, fn)
      }
      break

    case 'cms-list-repeater':
      if ((node.content as any).nodes?.list) {
        traverseElements((node.content as any).nodes.list, fn)
      }
      if ((node.content as any).nodes?.empty) {
        traverseElements((node.content as any).nodes.empty, fn)
      }
      if ((node.content as any).nodes?.loading) {
        traverseElements((node.content as any).nodes.loading, fn)
      }
      break

    case 'data-source-item':
    case 'data-source-list':
      if ((node.content as any).nodes?.success) {
        traverseElements((node.content as any).nodes.success, fn)
      }
      if ((node.content as any).nodes?.error) {
        traverseElements((node.content as any).nodes.error, fn)
      }
      if ((node.content as any).nodes?.loading) {
        traverseElements((node.content as any).nodes.loading, fn)
      }
      if ((node.content as any).children) {
        for (const child of (node.content as any).children) {
          traverseElements(child, fn)
        }
      }
      break

    default:
      break
  }
}

/**
 * Scans all pages and components in the project UIDL to detect
 * rich-text-editor-node usage, collecting theme and format information.
 */
const detectRichTextEditorUsage = (
  uidl: ProjectPluginStructure['uidl']
): RichTextEditorUsageInfo | null => {
  const info: RichTextEditorUsageInfo = {
    themes: new Set<string>(),
    hasFormulaFormat: false,
  }

  let found = false

  const scanElement = (element: UIDLElement) => {
    if (
      element.elementType !== 'rich-text-editor-node' &&
      element.semanticType !== 'rich-text-editor-node'
    ) {
      return
    }

    found = true
    const attrs = element.attrs || {}

    // Detect theme
    const themeAttr = attrs.quillTheme
    if (themeAttr && themeAttr.type === 'static' && typeof themeAttr.content === 'string') {
      info.themes.add(themeAttr.content)
    } else {
      info.themes.add('snow') // default
    }

    // Detect formula format
    const formatsAttr = attrs.quillFormats
    if (formatsAttr && formatsAttr.type === 'raw') {
      try {
        const formats = JSON.parse((formatsAttr as any).content)
        if (Array.isArray(formats) && formats.includes('formula')) {
          info.hasFormulaFormat = true
        }
      } catch {
        // Parsing failed — no formula
      }
    }
  }

  // Scan root component
  if (uidl.root?.node) {
    traverseElements(uidl.root.node, scanElement)
  }

  // Scan all components (pages are part of the components map)
  if (uidl.components) {
    for (const componentName of Object.keys(uidl.components)) {
      const component = uidl.components[componentName]
      if (component?.node) {
        traverseElements(component.node, scanElement)
      }
    }
  }

  if (!found) {
    return null
  }

  // Ensure at least one theme (default: snow)
  if (info.themes.size === 0) {
    info.themes.add('snow')
  }

  return info
}

export class NextRichTextEditorProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files, dependencies } = structure

    const usage = detectRichTextEditorUsage(uidl)
    if (!usage) {
      return structure
    }

    // 1. Generate the RichTextEditor component file
    const componentContent = generateRichTextEditorComponentCode()
    files.set('rich-text-editor-component', {
      path: ['components'],
      files: [
        {
          name: 'rich-text-editor',
          fileType: FileType.JS,
          content: componentContent,
        },
      ],
    })

    // 2. Add npm dependencies
    dependencies['react-quill-new'] = '^3.0.0'
    dependencies.quill = '^2.0.0'

    if (usage.hasFormulaFormat) {
      dependencies.katex = '^0.16.0'
    }

    // 3. Inject Quill CSS imports into _app.js
    this.injectQuillCSSIntoApp(structure, usage)

    return structure
  }

  private injectQuillCSSIntoApp(
    structure: ProjectPluginStructure,
    usage: RichTextEditorUsageInfo
  ): void {
    const { files } = structure

    let appFile: any = null
    for (const [key, record] of Array.from(files.entries())) {
      if (key === '_app' || key.includes('_app')) {
        appFile = record.files?.find(
          (f: any) => f.name === '_app' && (f.fileType === 'js' || f.fileType === 'tsx')
        )
        if (appFile) {
          break
        }
      }
    }

    if (!appFile || typeof appFile.content !== 'string') {
      return
    }

    let content = appFile.content

    // Build CSS import lines
    const cssImports: string[] = []

    if (usage.themes.has('snow')) {
      cssImports.push("import 'quill/dist/quill.snow.css';")
    }
    if (usage.themes.has('bubble')) {
      cssImports.push("import 'quill/dist/quill.bubble.css';")
    }
    if (usage.hasFormulaFormat) {
      cssImports.push("import 'katex/dist/katex.min.css';")
    }

    if (cssImports.length === 0) {
      return
    }

    // Insert CSS imports at the top of the file (before the first import)
    const importBlock = cssImports.join('\n') + '\n'
    const firstImportIdx = content.indexOf('import ')
    if (firstImportIdx >= 0) {
      content = content.slice(0, firstImportIdx) + importBlock + content.slice(firstImportIdx)
    } else {
      content = importBlock + content
    }

    appFile.content = content
  }
}
