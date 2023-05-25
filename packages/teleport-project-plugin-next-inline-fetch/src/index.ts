import { ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { createNextComponentInlineFetchPlugin } from './utils'

export class ProjectPluginNextInlineFetch implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    const pluginNextInlineFetch = createNextComponentInlineFetchPlugin({ files: structure.files })

    structure.strategy.pages.plugins.push(pluginNextInlineFetch)
    structure.strategy.components.plugins.push(pluginNextInlineFetch)
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    return structure
  }
}
