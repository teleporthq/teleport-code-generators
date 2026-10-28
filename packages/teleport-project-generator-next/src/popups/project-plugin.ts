import { ProjectPlugin, ProjectPluginStructure, UIDLPopupConfig } from '@teleporthq/teleport-types'
import { POPUP_RUNTIME_SOURCE } from './popup-runtime-source'

/**
 * The config as a JavaScript literal that is safe inside an inline `<script>`:
 * `<` is escaped so no value (a voucher code, a path) can close the script
 * tag, and the two line separators JSON allows but older engines do not.
 */
function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** The popups' head script; empty when the project shows no popup. */
export function buildPopupsHeadSnippet(config: UIDLPopupConfig | undefined): string {
  if (!config?.popups?.length) {
    return ''
  }
  return `<script>window.__tqPopups=${scriptSafeJson(config)};${POPUP_RUNTIME_SOURCE}</script>`
}

/**
 * Popups on the published site (`uidl.popups`, built by the editor from the
 * popup components the owner switched on). Each popup is already a component
 * instance at the end of every page; this ships the one script that decides
 * when to open it — see popup-runtime-source.ts.
 *
 * Inline in `_document`'s head rather than a public file, so it is there
 * before the first page view is evaluated (about 14 KB unminified, a few KB
 * once the page is compressed). Added in `runBefore` because `_document`
 * reads `customCode.head` during generation; put first, so a broken tag in the
 * owner's own head code cannot swallow it.
 * A project without popups is left exactly as it was.
 */
export class NextPopupsProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl } = structure
    const snippet = buildPopupsHeadSnippet(uidl.popups)
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
