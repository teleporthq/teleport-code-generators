import {
  ChunkType,
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
  TeleportError,
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

    if (!uidl.outputOptions?.initialPathsData || !resources?.items) {
      return structure
    }

    const { resource } = uidl?.outputOptions?.initialPathsData
    const usedResource = resources.items[resource.id]

    if (!usedResource) {
      throw new TeleportError(
        `Resource ${resource.id} is being used, but missing from the project ressources`
      )
    }

    const resourceImportName = StringUtils.dashCaseToCamelCase(
      StringUtils.camelCaseToDashCase(`${usedResource.name}-reource`)
    )

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
        types.stringLiteral(
          `${resources.path}${StringUtils.camelCaseToDashCase(usedResource.name)}`
        )
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
