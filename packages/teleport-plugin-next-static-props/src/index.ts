import {
  ChunkType,
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
  TeleportError,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'
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
    const { uidl, chunks, options } = structure
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
    /*
      Path from where the resource is being imported.
      It can be a local resource with relative path
      It can be aexternal package
    */
    let importPath: string

    if (isLocalResource) {
      const usedResource = resources.items?.[resource.id]
      if (!usedResource) {
        throw new TeleportError(
          `Resource ${resource.id} is being used, but missing from the project ressources. Check ${uidl.name} in UIDL for more information`
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

    const getStaticPropsAST = generateInitialPropsAST(
      uidl.outputOptions.initialPropsData,
      !!uidl.outputOptions.dynamicRouteAttribute,
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
