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

    if (!uidl.outputOptions?.initialPropsData || !resources?.items) {
      return structure
    }

    const { resource } = uidl?.outputOptions?.initialPropsData
    const usedResource = resources.items[resource.id]

    if (!usedResource) {
      throw new TeleportError(
        `Resource ${resource.id} is being used, but missing from the project ressources. Check ${uidl.name} in UIDL for more information`
      )
    }

    const resourceImportName = StringUtils.dashCaseToCamelCase(
      StringUtils.camelCaseToDashCase(`${usedResource.name}-reource`)
    )

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
        types.stringLiteral(
          `${resources.path}${StringUtils.camelCaseToDashCase(usedResource.name)}`
        )
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
