import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { injectImportIntoApp } from '../app-import-injection'
import { projectUsesElementTypes } from '../uidl-element-traversal'
import { generateKanbanComponentCode } from './component-generator'

const KANBAN_ELEMENT_TYPES = new Set(['kanban-node'])

const KANBAN_CSS_IMPORT = "import '@asseinfo/react-kanban/dist/styles.css'"

// @asseinfo/react-kanban declares react ^16.8 || ^17 peers (via
// react-beautiful-dnd). Projects that also contain a calendar are bumped to
// React 18, where npm's strict peer resolution would fail the install even
// though the library works at runtime. legacy-peer-deps restores the
// pre-npm-7 behavior for this generated project only.
const NPMRC_CONTENT = 'legacy-peer-deps=true\n'

/**
 * Activates when a generated project uses the kanban primitive:
 *  - emits the TqKanban wrapper to components/tq-kanban.js (next/dynamic with
 *    ssr:false — the library crashes without `window`)
 *  - adds the @asseinfo/react-kanban dependency and its stylesheet to _app
 *  - writes an .npmrc so installs survive the react-beautiful-dnd peer range
 */
export class NextKanbanProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files, dependencies } = structure

    if (!projectUsesElementTypes(uidl, KANBAN_ELEMENT_TYPES)) {
      return structure
    }

    files.set('tq-kanban-component', {
      path: ['components'],
      files: [
        {
          name: 'tq-kanban',
          fileType: FileType.JS,
          content: generateKanbanComponentCode(),
        },
      ],
    })

    files.set('tq-kanban-npmrc', {
      path: [],
      files: [
        {
          name: '.npmrc',
          content: NPMRC_CONTENT,
        },
      ],
    })

    dependencies['@asseinfo/react-kanban'] = '2.2.0'

    injectImportIntoApp(structure, KANBAN_CSS_IMPORT)

    return structure
  }
}
