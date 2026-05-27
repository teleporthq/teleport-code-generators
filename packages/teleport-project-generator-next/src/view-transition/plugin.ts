import { ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { resolvePageTransition, buildViewTransitionCSS } from '@teleporthq/teleport-plugin-common'

/**
 * Next.js project plugin for View Transition API support.
 *
 * When `uidl.globals.pageTransition` is present, resolves it into a CSS blob
 * (containing @keyframes and ::view-transition-old/new(...) rules) and appends
 * the blob to `uidl.globals.customCode.head` so Next's _document.js renders it
 * inside the <Head>.
 *
 * The _app.js swap-point (startViewTransition + flushSync) is emitted separately
 * by `configContentGenerator` in utils.ts, which reads
 * `FrameWorkConfigOptions.viewTransition` populated by the project generator core.
 */
export class NextViewTransitionPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    const { uidl } = structure
    const pageTransition = uidl.globals?.pageTransition
    if (!pageTransition) {
      return structure
    }

    const resolved = resolvePageTransition(pageTransition)
    const css = buildViewTransitionCSS(resolved)
    const styleTag = `<style data-vta-preset>${css}</style>`

    const existing = uidl.globals.customCode?.head ?? ''
    uidl.globals.customCode = {
      ...uidl.globals.customCode,
      head: existing ? `${existing}\n${styleTag}` : styleTag,
    }

    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    return structure
  }
}
