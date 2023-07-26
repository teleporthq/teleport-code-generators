import {
  ChunkType,
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
  UIDLDependency,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'

interface NextCacheValidationProps {
  routeMappers: RouteMapper
  dependency: UIDLDependency
}

type RouteMapper = Record<string, string[]>

const generateResponseWithStatus = (
  status: number,
  revalidationStatus: boolean
): types.ReturnStatement => {
  return types.returnStatement(
    types.callExpression(
      types.memberExpression(
        types.callExpression(
          types.memberExpression(types.identifier('res'), types.identifier('status')),
          [types.numericLiteral(status)]
        ),
        types.identifier('json')
      ),
      [
        types.objectExpression([
          types.objectProperty(
            types.identifier('revalidated'),
            types.booleanLiteral(revalidationStatus)
          ),
        ]),
      ]
    )
  )
}

const appendDataToObjectExpression = (expression: string): string => {
  const regex = /\${(.*?)}/g
  const result = expression.replace(regex, (_, p1) => `\${data.${p1}}`)
  return result
}

const generateCallbackExpression = (routeMappings: RouteMapper): types.ArrowFunctionExpression => {
  const switchCases: types.SwitchCase[] = Object.entries(routeMappings).map(
    ([contentType, paths]) => {
      return types.switchCase(types.stringLiteral(contentType), [
        ...paths.map((dynamicPath) => {
          return types.expressionStatement(
            types.callExpression(
              types.memberExpression(types.identifier('res'), types.identifier('revalidate')),
              [
                types.templateLiteral(
                  [
                    types.templateElement({
                      raw: appendDataToObjectExpression(dynamicPath),
                      cooked: appendDataToObjectExpression(dynamicPath),
                    }),
                  ],
                  []
                ),
              ]
            )
          )
        }),
        types.breakStatement(),
      ])
    }
  )

  switchCases.push(
    types.switchCase(null, [
      types.throwStatement(
        types.newExpression(types.identifier('Error'), [
          types.stringLiteral('Invalid content type'),
        ])
      ),
    ])
  )

  return types.arrowFunctionExpression(
    [types.identifier('data'), types.identifier('contentType')],
    types.blockStatement([types.switchStatement(types.identifier('contentType'), switchCases)])
  )
}

export const createNextCacheValidationPlugin: ComponentPluginFactory<NextCacheValidationProps> = (
  config
) => {
  const { dependency, routeMappers } = config
  const cacheValidationPlugin: ComponentPlugin = async (structure) => {
    const { dependencies, chunks } = structure

    const componentChunkContent = types.exportDefaultDeclaration(
      types.functionDeclaration(
        types.identifier('handler'),
        [types.identifier('req'), types.identifier('res')],
        types.blockStatement([
          types.tryStatement(
            types.blockStatement([
              types.expressionStatement(
                types.awaitExpression(
                  types.callExpression(types.identifier('revalidate'), [
                    types.identifier('req'),
                    generateCallbackExpression(routeMappers),
                  ])
                )
              ),
              generateResponseWithStatus(200, true),
            ]),
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

    /* tslint:disable no-string-literal */
    dependencies['revalidate'] = dependency

    return structure
  }

  return cacheValidationPlugin
}
