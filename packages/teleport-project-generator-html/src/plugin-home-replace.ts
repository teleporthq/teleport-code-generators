import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import {
  FileType,
  GeneratedFile,
  ProjectPlugin,
  ProjectPluginStructure,
} from '@teleporthq/teleport-types'

class ProjectPluginHomeReplace implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { uidl, files } = structure
    const { stateDefinitions } = uidl.root

    if (stateDefinitions?.route) {
      const { defaultValue } = stateDefinitions.route
      const routes = UIDLUtils.extractRoutes(uidl.root)
      const defaultRoute = routes.find((route) => route.content?.value === defaultValue)
      if (!defaultRoute) {
        return structure
      }
      const sanitizedName = StringUtils.removeIllegalCharacters(
        defaultRoute.content.value as string
      )
      const pageName = StringUtils.camelCaseToDashCase(sanitizedName)

      if (pageName === 'index') {
        return structure
      }

      const component = StringUtils.dashCaseToUpperCamelCase(sanitizedName)
      const homeFile = files.get(component)
      if (!homeFile) {
        return structure
      }

      const htmlFile = homeFile.files.find(
        ({ name, fileType }: GeneratedFile) => name === pageName && fileType === FileType.HTML
      )
      if (!htmlFile) {
        return structure
      }

      files.set('index', {
        path: homeFile.path,
        files: [
          ...homeFile.files.filter(
            ({ name, fileType }) => name === pageName && fileType !== FileType.HTML
          ),
          {
            ...htmlFile,
            name: 'index',
          },
        ],
      })
      files.delete(component)
    }

    return structure
  }
}

export const pluginHomeReplace = new ProjectPluginHomeReplace()
