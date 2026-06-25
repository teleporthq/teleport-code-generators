import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { projectUsesElementTypes } from '../uidl-element-traversal'
import { generateCountdownComponentCode } from './component-generator'

const COUNTDOWN_ELEMENT_TYPES = new Set(['countdown-node'])

/**
 * Activates when a generated project uses the countdown primitive:
 *  - emits the TqCountdown wrapper to components/tq-countdown.js (uses
 *    react-countdown; SSR-safe via a mounted-guard placeholder)
 *  - adds the react-countdown dependency
 *
 * No CSS / .npmrc needed — react-countdown declares react ">= 15" peers, which
 * React 17 (and 18) satisfy without strict-peer install failures.
 */
export class NextCountdownProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files, dependencies } = structure

    if (!projectUsesElementTypes(uidl, COUNTDOWN_ELEMENT_TYPES)) {
      return structure
    }

    files.set('tq-countdown-component', {
      path: ['components'],
      files: [
        {
          name: 'tq-countdown',
          fileType: FileType.JS,
          content: generateCountdownComponentCode(),
        },
      ],
    })

    dependencies['react-countdown'] = '^2.3.6'

    return structure
  }
}
