import {
  FileType,
  ProjectPlugin,
  ProjectPluginStructure,
  UIDLElement,
  UIDLRawValue,
} from '@teleporthq/teleport-types'
import { traverseProjectElements } from '../uidl-element-traversal'
import { injectSiblingIntoApp } from '../app-sibling-injection'
import { generateRichContentEmbedsComponentCode } from './embed-activator-component'
import { ensureEmbedRuntimeModule } from './runtime-module'

export const RICH_CONTENT_EMBEDS_COMPONENT_NAME = 'RichContentEmbeds'
export const RICH_CONTENT_EMBEDS_FILE_NAME = 'rich-content-embeds'

/**
 * True for the elements that DISPLAY author-written rich text at runtime, which
 * is the only place a stored code embed can surface:
 *
 *  - a `markdown-node`, which renders CMS rich text through `<Markdown>`;
 *  - any element with a raw attribute carrying a DYNAMIC reference — the blog
 *    post body, a product description, the admin detail panel. That is the node
 *    `applyDynamicHtmlInjection` turns into `<span dangerouslySetInnerHTML>`,
 *    the one path where an embed's `<script>` can never run on its own.
 *
 * A `rich-text-editor-node` is deliberately NOT a trigger: it is an editor, and
 * the generated editor previews its own embeds (see the rich-text-editor
 * plugin). The page that reads that content back is the one that needs this.
 */
const rendersAuthoredRichText = (element: UIDLElement): boolean => {
  if (element.elementType === 'markdown-node' || element.semanticType === 'markdown-node') {
    return true
  }

  const attrs = element.attrs
  if (!attrs) {
    return false
  }
  return Object.keys(attrs).some((key) => {
    const value = attrs[key]
    return value?.type === 'raw' && !!(value as UIDLRawValue).dynamic
  })
}

const projectRendersAuthoredRichText = (uidl: ProjectPluginStructure['uidl']): boolean => {
  let found = false
  traverseProjectElements(uidl, (element) => {
    if (!found && rendersAuthoredRichText(element)) {
      found = true
    }
  })
  return found
}

/**
 * Ships the code-embed runtime with any project that renders author-written
 * rich text. Purely additive: no mapping, no emitted markup and no npm
 * dependency changes — a project without rich text gets nothing at all.
 */
export class NextRichContentEmbedsProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files } = structure

    if (!projectRendersAuthoredRichText(uidl)) {
      return structure
    }

    ensureEmbedRuntimeModule(structure)

    files.set(RICH_CONTENT_EMBEDS_FILE_NAME, {
      path: ['components'],
      files: [
        {
          name: RICH_CONTENT_EMBEDS_FILE_NAME,
          fileType: FileType.JS,
          content: generateRichContentEmbedsComponentCode(),
        },
      ],
    })

    injectSiblingIntoApp(structure, {
      componentName: RICH_CONTENT_EMBEDS_COMPONENT_NAME,
      importStatement: `import ${RICH_CONTENT_EMBEDS_COMPONENT_NAME} from '../components/${RICH_CONTENT_EMBEDS_FILE_NAME}';\n`,
    })

    return structure
  }
}
