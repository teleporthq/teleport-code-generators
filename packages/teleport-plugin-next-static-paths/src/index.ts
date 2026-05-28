import * as types from '@babel/types'
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

const isDynamicRoute = (uidl: {
  outputOptions?: { folderPath?: string[]; fileName?: string }
}): boolean => {
  const { folderPath = [], fileName = '' } = uidl.outputOptions || {}
  return [...folderPath, fileName].some(
    (segment) => segment.startsWith('[') && segment.endsWith(']')
  )
}

export const createStaticPathsPlugin: ComponentPluginFactory<StaticPropsPluginConfig> = (
  config
) => {
  const { componentChunkName = 'jsx-component' } = config || {}

  const staticPathsPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, options, dependencies } = structure
    const { resources } = options

    if (!uidl.outputOptions?.initialPathsData) {
      // For dynamic routes without initialPathsData,
      // generate a fallback getStaticPaths with empty paths and fallback: 'blocking'.
      // This is needed because Next.js requires getStaticPaths for any dynamic route
      // that uses getStaticProps (which may be added later by the i18n or data source plugins).
      if (isDynamicRoute(uidl)) {
        const fallbackGetStaticPaths = types.exportNamedDeclaration(
          (() => {
            const node = types.functionDeclaration(
              types.identifier('getStaticPaths'),
              [],
              types.blockStatement([
                types.returnStatement(
                  types.objectExpression([
                    types.objectProperty(types.identifier('paths'), types.arrayExpression([])),
                    types.objectProperty(
                      types.identifier('fallback'),
                      types.stringLiteral('blocking')
                    ),
                  ])
                ),
              ]),
              false,
              true
            )
            node.async = true
            return node
          })()
        )

        chunks.push({
          name: 'getStaticPaths',
          type: ChunkType.AST,
          fileType: FileType.JS,
          content: fallbackGetStaticPaths,
          linkAfter: [componentChunkName],
        })

        // Next.js requires getStaticProps when getStaticPaths is present.
        // Generate a minimal getStaticProps if no initialPropsData will provide one.
        if (!uidl.outputOptions?.initialPropsData) {
          const fallbackGetStaticProps = types.exportNamedDeclaration(
            (() => {
              const node = types.functionDeclaration(
                types.identifier('getStaticProps'),
                [types.identifier('context')],
                types.blockStatement([
                  types.returnStatement(
                    types.objectExpression([
                      types.objectProperty(types.identifier('props'), types.objectExpression([])),
                    ])
                  ),
                ]),
                false,
                true
              )
              node.async = true
              return node
            })()
          )

          chunks.push({
            name: 'getStaticProps',
            type: ChunkType.AST,
            fileType: FileType.JS,
            content: fallbackGetStaticProps,
            linkAfter: ['getStaticPaths'],
          })
        }
      }

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
      uidl.outputOptions.pagination,
      uidl.outputOptions.dynamicRouteAttribute
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
