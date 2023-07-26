import {
  ChunkType,
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
  ProjectUIDL,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'
import { generateCallbackExpression, generateResponseWithStatus } from './utils'

interface NextCacheValidationProps {
  routeMappers: Record<string, string[]>
  webhook: ProjectUIDL['resources']['cache']['webhook']
  cacheHandlerSecret?: string
}

export const createNextCacheValidationPlugin: ComponentPluginFactory<NextCacheValidationProps> = (
  config
) => {
  const { webhook, routeMappers = {}, cacheHandlerSecret } = config

  const cacheValidationPlugin: ComponentPlugin = async (structure) => {
    const { dependencies, chunks } = structure

    const webhookHandlerContent: types.Statement[] = [
      types.expressionStatement(
        types.awaitExpression(
          types.callExpression(types.identifier(webhook.name), [
            types.identifier('req'),
            generateCallbackExpression(routeMappers),
          ])
        )
      ),
      generateResponseWithStatus(200, true),
    ]

    if (cacheHandlerSecret) {
      webhookHandlerContent.unshift(
        types.ifStatement(
          types.binaryExpression(
            '!==',
            types.memberExpression(
              types.memberExpression(
                types.identifier('process'),
                types.identifier('env'),
                false,
                true
              ),
              types.identifier(cacheHandlerSecret),
              false
            ),
            types.memberExpression(
              types.memberExpression(types.identifier('req'), types.identifier('query')),
              types.stringLiteral(cacheHandlerSecret),
              true,
              true
            )
          ),
          types.blockStatement([generateResponseWithStatus(401, false)])
        )
      )
    }

    const componentChunkContent = types.exportDefaultDeclaration(
      types.functionDeclaration(
        types.identifier('handler'),
        [types.identifier('req'), types.identifier('res')],
        types.blockStatement([
          types.tryStatement(
            types.blockStatement(webhookHandlerContent),
            types.catchClause(
              types.identifier('error'),
              types.blockStatement([
                types.expressionStatement(
                  types.callExpression(
                    types.memberExpression(types.identifier('console'), types.identifier('log')),
                    [types.identifier('error')]
                  )
                ),
                generateResponseWithStatus(500, false),
              ])
            )
          ),
        ]),
        false,
        true
      )
    )

    chunks.push({
      name: 'revalidateChunk',
      type: ChunkType.AST,
      fileType: FileType.JS,
      content: componentChunkContent,
      linkAfter: ['import-local', 'import-lib', 'import-pack'],
    })

    dependencies[webhook.name] = webhook.dependency

    return structure
  }

  return cacheValidationPlugin
}
