import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { NAV_ACTIVE_LINK_COMPONENT_SOURCE } from './nav-active-link-component'
import { injectSiblingIntoApp } from '../app-sibling-injection'

// Ships a tiny first-party navigation active-link highlighter with EVERY Next
// project. The link matching the current route gets `active` + `aria-current`
// at render time, so the generator never has to hardcode which link is active
// (a hardcoded active makes one link look selected on every page). The
// component is null-rendering and self-contained (no npm dependency).
export class NextNavActiveLinkProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { files } = structure

    files.set('nav-active-links', {
      path: ['components'],
      files: [
        {
          name: 'nav-active-links',
          fileType: FileType.JS,
          content: NAV_ACTIVE_LINK_COMPONENT_SOURCE,
        },
      ],
    })

    injectSiblingIntoApp(structure, {
      componentName: 'NavActiveLinks',
      importStatement: `import NavActiveLinks from '../components/nav-active-links';\n`,
    })

    return structure
  }
}
