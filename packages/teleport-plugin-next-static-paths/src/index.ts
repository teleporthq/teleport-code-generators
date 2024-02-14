import {
  ChunkType,
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
  TeleportError,
  UIDLLocalResource,
} from '@teleporthq/teleport-types'
import { join, relative } from 'path'
import { StringUtils } from '@teleporthq/teleport-shared'
import { generateInitialPathsAST } from './utils'

interface StaticPropsPluginConfig {
  componentChunkName?: string
}

export const createStaticPathsPlugin: ComponentPluginFactory<StaticPropsPluginConfig> = (
  config
) => {
  const { componentChunkName = 'jsx-component' } = config || {}

  const staticPathsPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, options, dependencies } = structure
    const { resources } = options

    if (!uidl.outputOptions?.initialPathsData) {
      return structure
    }

    const { resource } = uidl?.outputOptions?.initialPathsData

    const isLocalResource = 'id' in resource
    const isExternalResource = 'name' in resource
    /*
      Name of the function that is being imported
    */
    let resourceImportName: string

    if (isLocalResource) {
      const usedResource = resources.items[(resource as UIDLLocalResource).id]

      if (!usedResource) {
        throw new TeleportError(
          `Resource ${
            (resource as UIDLLocalResource).id
          } is being used, but missing from the project ressources`
        )
      }

      resourceImportName = StringUtils.dashCaseToCamelCase(
        StringUtils.camelCaseToDashCase(`${usedResource.name}-resource`)
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
      resourceImportName = resource.name
      dependencies[resource.name] = resource.dependency
    }

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const getStaticPathsAST = generateInitialPathsAST(
      uidl.outputOptions.initialPathsData,
      resourceImportName,
      resource,
      uidl.outputOptions.pagination
    )

    chunks.push({
      name: 'getStaticPaths',
      type: ChunkType.AST,
      fileType: FileType.JS,
      content: getStaticPathsAST,
      linkAfter: [componentChunkName],
    })

    return structure
  }

  return staticPathsPlugin
}

export default createStaticPathsPlugin()
