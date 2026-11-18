import { ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { CODE_COPY_RUNTIME_SOURCE } from './code-copy-runtime-source'

/** The head script of a site with a Blog or a Help Center; empty otherwise. */
export function buildCodeCopyHeadSnippet(uidl: ProjectPluginStructure['uidl']): string {
  if (!uidl.blogSettings && !uidl.helpCenterSettings) {
    return ''
  }
  return `<script>${CODE_COPY_RUNTIME_SOURCE}</script>`
}

/**
 * The Copy button of a post's code blocks (written into the post's HTML by the
 * post transform) needs one script to act on a click — this ships it, inline
 * in `_document`'s head like the popups' script (about 1.5 KB), on a project
 * with a Blog or a Help Center. Added in `runBefore` because `_document` reads
 * `customCode.head` during generation; put first, so a broken tag in the
 * owner's own head code cannot swallow it. Any other project is left as it was.
 */
export class NextCodeCopyProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl } = structure
    const snippet = buildCodeCopyHeadSnippet(uidl)
    if (snippet) {
      const customCode = uidl.globals.customCode ?? {}
      uidl.globals.customCode = { ...customCode, head: `${snippet}${customCode.head ?? ''}` }
    }
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }
}
