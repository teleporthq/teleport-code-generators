import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { injectImportIntoApp } from '../app-import-injection'
import { emitLegacyPeerDepsNpmrc } from '../npmrc-legacy-peer-deps'
import { CALENDARKIT_CSS } from './calendarkit-css'

const CALENDARKIT_PACKAGE = 'calendarkit-basic'
const CALENDARKIT_CSS_IMPORT = "import './calendarkit.css'"

/**
 * Activates when a generated project depends on calendarkit-basic (the
 * BasicScheduler calendar primitive):
 *  - bumps react/react-dom to ^18 — calendarkit-basic requires React 18
 *    (the template's `next` range already supports React 18, so `next`
 *    itself is left untouched)
 *  - writes an .npmrc (legacy-peer-deps) so the React-18 bump survives template
 *    deps with React-17-only peer ranges (e.g. dangerous-html embeds)
 *  - writes the precompiled CalendarKit stylesheet to pages/calendarkit.css
 *    (the library ships uncompiled Tailwind, see scripts/generate-calendarkit-css.mjs)
 *  - imports the stylesheet from _app, where Next.js requires global CSS
 */
export class NextCalendarKitProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { dependencies, files } = structure

    if (!dependencies[CALENDARKIT_PACKAGE]) {
      return structure
    }

    dependencies.react = '^18.3.1'
    dependencies['react-dom'] = '^18.3.1'
    emitLegacyPeerDepsNpmrc(structure, 'calendarkit-npmrc')

    files.set('calendarkit-css', {
      path: ['pages'],
      files: [
        {
          name: 'calendarkit',
          fileType: FileType.CSS,
          content: CALENDARKIT_CSS,
        },
      ],
    })

    injectImportIntoApp(structure, CALENDARKIT_CSS_IMPORT)

    return structure
  }
}
