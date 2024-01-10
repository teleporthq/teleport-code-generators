import {
  ChunkType,
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
  TeleportError,
} from '@teleporthq/teleport-types'
import { StringUtils } from '@teleporthq/teleport-shared'
import { generateInitialPropsAST } from './utils'

interface StaticPropsPluginConfig {
  componentChunkName?: string
}

export const createStaticPropsPlugin: ComponentPluginFactory<StaticPropsPluginConfig> = (
  config
) => {
  const { componentChunkName = 'jsx-component' } = config || {}

  const staticPropsPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, options, dependencies } = structure
    const { resources } = options

    if (!uidl.outputOptions?.initialPropsData) {
      return structure
    }

    const { resource } = uidl?.outputOptions?.initialPropsData

    const isLocalResource = 'id' in resource
    const isExternalResource = 'name' in resource
    /*
      Name of the function that is being imported
    */
    let resourceImportName

    if (isLocalResource) {
      const usedResource = resources.items?.[resource.id]
      if (!usedResource) {
        throw new TeleportError(
          `Resource ${resource.id} is being used, but missing from the project ressources. Check ${uidl.name} in UIDL for more information`
        )
      }

      resourceImportName = StringUtils.dashCaseToCamelCase(
        StringUtils.camelCaseToDashCase(usedResource.name + 'Resource')
      )
      const importPath = `${resources.path}${StringUtils.camelCaseToDashCase(usedResource.name)}`

      dependencies[resourceImportName] = {
        path: importPath,
        type: 'local',
      }
    }

    if (isExternalResource) {
      dependencies[resource.name] = resource.dependency
      resourceImportName = resource.name
    }

    /*
      itemValuePath exists only for details pages.
    */
    const isDetailsPage = 'itemValuePath' in uidl.outputOptions?.initialPropsData?.exposeAs

    const getStaticPropsAST = generateInitialPropsAST(
      uidl.outputOptions.initialPropsData,
      isDetailsPage,
      resourceImportName,
      resources.cache,
      uidl.outputOptions.pagination
    )

    chunks.push({
      name: 'getStaticProps',
      type: ChunkType.AST,
      fileType: FileType.JS,
      content: getStaticPropsAST,
      linkAfter: [componentChunkName],
    })

    return structure
  }

  return staticPropsPlugin
}

export default createStaticPropsPlugin()
