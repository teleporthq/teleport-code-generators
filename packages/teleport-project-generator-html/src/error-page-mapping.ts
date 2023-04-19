import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'

class HTMLErrorPageMapping implements ProjectPlugin {
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

    const folder =
      files.get(fallback.pageOptions?.componentName) || files.get(fallback.pageOptions?.fileName)
    if (!folder) {
      return structure
    }

    folder.files.forEach((file) => {
      if (file.name === fallback.pageOptions.fileName && file.fileType === FileType.HTML) {
        file.name = '404'
      }
    })

    return structure
  }
}

export const htmlErrorPageMapping = new HTMLErrorPageMapping()
