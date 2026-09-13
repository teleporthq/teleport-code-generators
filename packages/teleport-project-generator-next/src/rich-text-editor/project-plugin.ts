import {
  FileType,
  ProjectPlugin,
  ProjectPluginStructure,
  UIDLElement,
} from '@teleporthq/teleport-types'
import { RichTextEmbeds } from '@teleporthq/teleport-shared'
import { traverseProjectElements } from '../uidl-element-traversal'
import { ensureEmbedRuntimeModule } from '../rich-content-embeds/runtime-module'
import { generateRichTextEditorComponentCode } from './component-generator'

interface RichTextEditorUsageInfo {
  themes: Set<string>
  hasFormulaFormat: boolean
  hasEmbedFormat: boolean
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
    hasEmbedFormat: false,
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

    // Detect the formats that pull extra machinery into the project: KaTeX for
    // `formula`, and the whole code-embed layer for `tq-embed`.
    const formatsAttr = attrs.quillFormats
    if (formatsAttr && formatsAttr.type === 'raw') {
      try {
        const formats = JSON.parse((formatsAttr as any).content)
        if (Array.isArray(formats)) {
          if (formats.indexOf('formula') !== -1) {
            info.hasFormulaFormat = true
          }
          if (formats.indexOf(RichTextEmbeds.EMBED_BLOT_NAME) !== -1) {
            info.hasEmbedFormat = true
          }
        }
      } catch {
        // Parsing failed — neither format is in play
      }
    }
  }

  traverseProjectElements(uidl, scanElement)

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
    if (usage.hasEmbedFormat) {
      ensureEmbedRuntimeModule(structure)
    }
    const componentContent = generateRichTextEditorComponentCode({
      withEmbeds: usage.hasEmbedFormat,
    })
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
