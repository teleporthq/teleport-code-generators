import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { COLLAPSIBLE_TEXT_OVERFLOW_COMPONENT_SOURCE } from './collapsible-text-overflow-component'
import { injectSiblingIntoApp } from '../app-sibling-injection'
import { decomposeCollapsibleTextInProject } from './decompose'

/**
 * Ships a tiny first-party Collapsible Text overflow helper with every Next
 * project, and decomposes any raw `collapsible-text` primitive into its clamped
 * markup.
 *
 * The primitive decomposes to plain elements, so whether its clamped text
 * ACTUALLY overflows (and therefore whether the "Show more" toggle should
 * appear) can only be decided by a runtime measurement. This null-rendering,
 * self-contained component measures every collapsed block and hides the Show
 * more label when the text already fits.
 *
 * `runBefore` performs the structural decomposition (line-clamp + overflow
 * markers) so the generated app works even when the UIDL was exported WITHOUT
 * the GUI-side decomposition — it is idempotent when the UIDL is already
 * decomposed. `runAfter` ships the runtime helper the same way as the analytics
 * tracker + nav active-link highlighter (`injectSiblingIntoApp`). No npm
 * dependency, and a no-op on pages with no collapsible-text blocks, so it is
 * safe to run unconditionally.
 */
export class NextCollapsibleTextProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    decomposeCollapsibleTextInProject(structure.uidl)
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { files } = structure

    files.set('tq-collapsible-text-overflow', {
      path: ['components'],
      files: [
        {
          name: 'tq-collapsible-text-overflow',
          fileType: FileType.JS,
          content: COLLAPSIBLE_TEXT_OVERFLOW_COMPONENT_SOURCE,
        },
      ],
    })

    injectSiblingIntoApp(structure, {
      componentName: 'TqCollapsibleTextOverflow',
      importStatement: `import TqCollapsibleTextOverflow from '../components/tq-collapsible-text-overflow';\n`,
    })

    return structure
  }
}
