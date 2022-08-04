import { ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'

class NuxtErrorMappingPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { uidl, files } = structure
    const routes = uidl.root.stateDefinitions.route
    const fallback = routes.values.find((route) => route.pageOptions?.fallback)
    if (!fallback) {
      return structure
    }

    const file =
      files.get(fallback.pageOptions?.componentName) || files.get(fallback.pageOptions?.fileName)
    if (!file) {
      return structure
    }

    file.files[0].name = 'error'
    file.path = ['layouts']
    return structure
  }
}

export const nuxtErrorPageMapper = new NuxtErrorMappingPlugin()
