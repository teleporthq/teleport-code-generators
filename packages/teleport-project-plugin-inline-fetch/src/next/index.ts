import { ProjectPluginStructure } from '@teleporthq/teleport-types'
import { createNextComponentInlineFetchPlugin } from './utils'

class ProjectPluginInlineFetch {
  dependencies: Record<string, string> = {}

  nextBeforeModifier = (structure: ProjectPluginStructure) => {
    const pluginNextInlineFetch = createNextComponentInlineFetchPlugin({
      files: structure.files,
      dependencies: this.dependencies,
    })

    structure.strategy.pages.plugins.push(pluginNextInlineFetch)
    structure.strategy.components.plugins.push(pluginNextInlineFetch)
    return structure
  }

  nextAfterModifier = (structure: ProjectPluginStructure) => {
    const { dependencies } = structure
    Object.entries(this.dependencies).forEach(([packageName, version]) => {
      if (!dependencies[packageName]) {
        dependencies[packageName] = version
      }
    })
    return structure
  }
}

const projectPluginInlineFetch = new ProjectPluginInlineFetch()
export default projectPluginInlineFetch
