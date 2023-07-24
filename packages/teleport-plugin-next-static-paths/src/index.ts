import {
  ChunkType,
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
  TeleportError,
  UIDLLocalResource,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'
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
    const { uidl, chunks, options } = structure
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
    /*
      Path from where the resource is being imported.
      It can be a local resource with relative path
      It can be aexternal package
    */
    let importPath: string

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

      importPath = `${resources.path}${StringUtils.camelCaseToDashCase(usedResource.name)}`
    }

    if (isExternalResource) {
      resourceImportName = resource.name
      importPath = resource.dependency?.meta?.importAlias || resource.dependency.path
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
      name: 'import-resource-chunk',
      type: ChunkType.AST,
      fileType: FileType.JS,
      content: types.importDeclaration(
        [types.importDefaultSpecifier(types.identifier(resourceImportName))],
        types.stringLiteral(importPath)
      ),
      linkAfter: [''],
    })

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
