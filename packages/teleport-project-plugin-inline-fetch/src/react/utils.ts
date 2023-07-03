import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import * as types from '@babel/types'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'

interface InlineFetchRequestsPlugin {
  componentChunkName: string
}

export const generateLoadingStateAST = (statePersistanceName: string, value: boolean) => {
  const setLoadingState = types.expressionStatement(
    types.callExpression(
      types.identifier(StringUtils.createStateStoringFunction(`${statePersistanceName}Loading`)),
      [types.booleanLiteral(value)]
    )
  )

  return setLoadingState
}

export const createInlineJSXFetchRequestsPlugins: ComponentPluginFactory<
  InlineFetchRequestsPlugin
> = (config) => {
  const { componentChunkName = 'jsx-component' } = config || {}

  const inlineStylesPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, options } = structure
    const {
      resources: { items },
    } = options
    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)

    if (!componentChunk) {
      return structure
    }

    const variableDecleration = componentChunk.content as types.VariableDeclaration

    if (variableDecleration.type !== 'VariableDeclaration') {
      return structure
    }

    const arrowFunction = (
      variableDecleration.declarations[0].init as types.ArrowFunctionExpression
    ).body as types.BlockStatement

    const variableDeclerationIndex = arrowFunction.body.findIndex(
      (item) => item.type === 'ReturnStatement'
    )

    UIDLUtils.traverseNodes(uidl.node, (node) => {
      if (node.type === 'cms-list' && node.content?.resource && items[node.content.resource.id]) {
        const { statePersistanceName } = node.content
        const usedResource = items[node.content.resource.id]

        const resourceImportName = StringUtils.dashCaseToCamelCase(
          StringUtils.camelCaseToDashCase(`${usedResource.name}-resource`)
        )

        const funcParams: types.ObjectProperty[] = Object.keys(
          node.content.resource?.params || {}
        ).reduce((acc: types.ObjectProperty[], item) => {
          const prop = node.content.resource.params[item]
          acc.push(
            types.objectProperty(types.stringLiteral(item), ASTUtils.resolveObjectValue(prop))
          )

          return acc
        }, [])

        const declerationAST = types.variableDeclaration('const', [
          types.variableDeclarator(
            types.identifier('response'),
            types.awaitExpression(
              types.callExpression(types.identifier(resourceImportName), [
                types.objectExpression(funcParams),
              ])
            )
          ),
        ])

        const handleResponseToState = types.expressionStatement(
          types.callExpression(
            types.identifier(StringUtils.createStateStoringFunction(statePersistanceName)),
            [types.identifier('response')]
          )
        )

        const tryCatchBlock = types.tryStatement(
          types.blockStatement([
            generateLoadingStateAST(statePersistanceName, true),
            declerationAST,
            handleResponseToState,
            generateLoadingStateAST(statePersistanceName, false),
          ]),
          types.catchClause(
            types.identifier('error'),
            types.blockStatement([
              types.expressionStatement(
                types.callExpression(
                  types.identifier(
                    StringUtils.createStateStoringFunction(`${statePersistanceName}Error`)
                  ),
                  [types.booleanLiteral(false)]
                )
              ),
              generateLoadingStateAST(statePersistanceName, false),
            ])
          )
        )

        const dataFetcherBlock = types.variableDeclaration('const', [
          types.variableDeclarator(
            types.identifier('fetchData'),
            types.arrowFunctionExpression([], types.blockStatement([tryCatchBlock]), true)
          ),
        ])

        const hookStatement = types.expressionStatement(
          types.callExpression(types.identifier('useEffect'), [
            types.arrowFunctionExpression(
              [],
              types.blockStatement([
                dataFetcherBlock,
                types.expressionStatement(types.callExpression(types.identifier('fetchData'), [])),
              ])
            ),
            types.arrayExpression([]),
          ])
        )

        arrowFunction.body.splice(variableDeclerationIndex, 0, hookStatement)
      }
    })

    return structure
  }
  return inlineStylesPlugin
}
