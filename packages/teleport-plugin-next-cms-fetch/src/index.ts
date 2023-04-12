import {
  ComponentPlugin,
  ComponentPluginFactory,
  ProjectResource,
  UIDLCMSItemNode,
  UIDLCMSItemNodeContent,
  UIDLCMSListNode,
  UIDLCMSListNodeContent,
  UIDLNode,
} from '@teleporthq/teleport-types'
import { Constants, StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import * as types from '@babel/types'

interface ContextPluginConfig {
  componentChunkName?: string
}

interface ComputeUseEffectParams {
  resource: ProjectResource
  setStateName: string
  setLoadingStateName: string
  setErrorStateName: string
  node: UIDLCMSItemNode | UIDLCMSListNode
}

export const createNextComponentCMSFetchPlugin: ComponentPluginFactory<ContextPluginConfig> = (
  config
) => {
  const { componentChunkName = 'jsx-component' } = config || {}

  const nextComponentCMSFetchPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure

    const { projectResources } = options

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    UIDLUtils.traverseNodes(uidl.node, (node) => {
      const { type } = node as UIDLNode
      if (type !== 'cms-list' && type !== 'cms-item') {
        return
      }

      const content = node.content as UIDLCMSListNodeContent | UIDLCMSItemNodeContent
      if (!content.resourceId) {
        return
      }
      const resource = projectResources[content.resourceId]
      if (!resource) {
        throw new Error(`Tried to find a resource that does not exist ${content.resourceId}`)
      }

      const stateName = content.statePersistanceName
      const loadingStateName = content.loadingStatePersistanceName
      const errorStateName = content.errorStatePersistanceName

      const setStateName = `set${StringUtils.capitalize(stateName)}`
      const setLoadingStateName = `set${StringUtils.capitalize(loadingStateName)}`
      const setErrorStateName = `set${StringUtils.capitalize(errorStateName)}`

      const useEffectCall = computeUseEffectAST({
        resource,
        setStateName,
        setLoadingStateName,
        setErrorStateName,
        node: node as UIDLCMSItemNode | UIDLCMSListNode,
      })

      try {
        // @ts-ignore
        const astBody = componentChunk.content.declarations?.[0].init.body.body
        const returnStatementIndex = astBody.findIndex(
          (el: { type: string }) => el.type === 'ReturnStatement'
        )

        const indexToAddAt = returnStatementIndex !== -1 ? returnStatementIndex : 0
        astBody.splice(indexToAddAt, 0, useEffectCall)

        dependencies.useEffect = Constants.USE_EFFECT_DEPENDENCY
        dependencies.useState = Constants.USE_STATE_DEPENDENCY
      } catch (error) {
        return
      }
    })

    return structure
  }

  return nextComponentCMSFetchPlugin
}

const computeUseEffectAST = (params: ComputeUseEffectParams) => {
  const { resource, node, setStateName, setErrorStateName, setLoadingStateName } = params

  const apiFetchAST = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('data'),
      types.awaitExpression(
        types.callExpression(types.identifier('fetch'), [
          types.stringLiteral(`/api/${resource.fileName}`),
        ])
      )
    ),
  ])

  const responseJSONAST = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('response'),
      types.awaitExpression(
        types.callExpression(
          types.memberExpression(types.identifier('data'), types.identifier('json'), false),
          []
        )
      )
    ),
  ])

  const resourceFetchAST = types.arrowFunctionExpression(
    [],
    types.blockStatement([
      types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('fetchData'),
          types.arrowFunctionExpression(
            [],
            types.blockStatement([
              types.expressionStatement(
                types.callExpression(types.identifier(setLoadingStateName), [
                  types.booleanLiteral(true),
                ])
              ),
              types.tryStatement(
                types.blockStatement([
                  apiFetchAST,
                  responseJSONAST,
                  types.ifStatement(
                    types.memberExpression(types.identifier('response'), types.identifier('error')),
                    types.blockStatement([
                      types.expressionStatement(
                        types.callExpression(types.identifier(setErrorStateName), [
                          types.booleanLiteral(true),
                        ])
                      ),
                    ]),
                    types.blockStatement([
                      types.expressionStatement(
                        types.callExpression(types.identifier(setStateName), [
                          node.type === 'cms-item'
                            ? types.memberExpression(
                                types.memberExpression(
                                  types.identifier('response.data'),
                                  types.numericLiteral(0),
                                  true
                                ),
                                types.identifier((node.content.valuePath || []).join('.'))
                              )
                            : types.identifier('response.data'),
                        ])
                      ),
                    ])
                  ),
                ]),
                types.catchClause(
                  types.identifier('error'),
                  types.blockStatement([
                    types.expressionStatement(
                      types.callExpression(types.identifier(setErrorStateName), [
                        types.booleanLiteral(true),
                      ])
                    ),
                  ])
                )
              ),

              types.expressionStatement(
                types.callExpression(types.identifier(setLoadingStateName), [
                  types.booleanLiteral(false),
                ])
              ),
            ]),
            true
          )
        ),
      ]),
      types.expressionStatement(types.callExpression(types.identifier('fetchData'), [])),
    ])
  )

  return types.callExpression(types.identifier('useEffect'), [
    resourceFetchAST,
    types.arrayExpression([]),
  ])
}
