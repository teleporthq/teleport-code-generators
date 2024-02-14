import {
  ChunkType,
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
  TeleportError,
} from '@teleporthq/teleport-types'
import { StringUtils } from '@teleporthq/teleport-shared'
import { generateInitialPropsAST } from './utils'
import { join, relative } from 'path'

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

      dependencies[resourceImportName] = {
        type: 'local',
        path: relative(
          join(...uidl.outputOptions.folderPath, uidl.outputOptions.fileName),
          join(...resources.path, StringUtils.camelCaseToDashCase(usedResource.name))
        ),
      }
    }

    if (isExternalResource) {
      dependencies[resource.name] = resource.dependency
      resourceImportName = resource.name
    }

    const getStaticPropsAST = generateInitialPropsAST(
      uidl.outputOptions.initialPropsData,
      resourceImportName,
      resources.cache
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
