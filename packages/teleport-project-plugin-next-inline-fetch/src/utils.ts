import {
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
  InMemoryFileRecord,
  UIDLCMSItemNode,
  UIDLCMSItemNodeContent,
  UIDLCMSListNode,
  UIDLCMSListNodeContent,
  UIDLNode,
} from '@teleporthq/teleport-types'
import { Constants, StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'

interface ContextPluginConfig {
  componentChunkName?: string
  files: Map<string, InMemoryFileRecord>
}

interface ComputeUseEffectParams {
  resource: string
  setStateName: string
  setLoadingStateName: string
  setErrorStateName: string
  node: UIDLCMSItemNode | UIDLCMSListNode
}

export const createNextComponentInlineFetchPlugin: ComponentPluginFactory<ContextPluginConfig> = (
  config
) => {
  const { componentChunkName = 'jsx-component', files } = config || {}

  const nextComponentCMSFetchPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure
    const { resources } = options

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
      if (!content?.resource?.id) {
        return
      }
      const resource = resources.items[content.resource.id]
      if (!resource) {
        throw new Error(`Tried to find a resource that does not exist ${content.resource.id}`)
      }

      const stateName = content.statePersistanceName
      const setStateName = StringUtils.createStateStoringFunction(stateName)
      const setLoadingStateName = StringUtils.createStateStoringFunction(`${stateName}Loading`)
      const setErrorStateName = StringUtils.createStateStoringFunction(`${stateName}Error`)
      const resourceImportName = StringUtils.camelCaseToDashCase(`${stateName}-reource`)
      const importName = StringUtils.dashCaseToCamelCase(resourceImportName)

      files.set(resourceImportName, {
        files: [
          {
            name: resourceImportName,
            fileType: FileType.JS,
            content: `import ${importName} from '../../resources/${resourceImportName}'

export default async function handler(req, res) {
  try {
    const response = await ${importName}(JSON.parse(req.body))
    return res.status(200).json(response)
  } catch (error) {
    return res.status(500).send('Something went wrong')
  }
}
`,
          },
        ],
        path: ['pages', 'api'],
      })

      const useEffectCall = computeUseEffectAST({
        resource: resourceImportName,
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
  if (node.type !== 'cms-item' && node.type !== 'cms-list') {
    throw new Error('Invalid node type passed to computeUseEffectAST')
  }

  const apiFetchAST = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('data'),
      types.awaitExpression(
        types.callExpression(types.identifier('fetch'), [types.stringLiteral(`/api/${resource}`)])
      )
    ),
  ])

  const funcParams: types.ObjectProperty[] = Object.keys(
    node.content.resource?.params || {}
  ).reduce((acc: types.ObjectProperty[], item) => {
    const prop = node.content.resource.params[item]
    acc.push(types.objectProperty(types.stringLiteral(item), ASTUtils.resolveObjectValue(prop)))

    return acc
  }, [])

  const responseJSONAST = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('response'),
      types.awaitExpression(
        types.callExpression(
          types.memberExpression(types.identifier('data'), types.identifier('json'), false),
          [
            types.objectExpression([
              types.objectProperty(types.identifier('method'), types.identifier('POST')),
              types.objectProperty(types.identifier('body'), types.objectExpression(funcParams)),
            ]),
          ]
        )
      )
    ),
  ])

  const firstMemberAST = types.memberExpression(
    ASTUtils.generateMemberExpressionASTFromPath(['response', ...(node.content.valuePath || [])]),
    types.numericLiteral(0),
    true
  )

  const stateNameAST: types.MemberExpression | types.CallExpression | types.Identifier =
    node.type === 'cms-item'
      ? node.content.itemValuePath.length
        ? types.memberExpression(
            firstMemberAST,
            types.identifier((node.content.itemValuePath || []).join('.'))
          )
        : firstMemberAST
      : ASTUtils.generateMemberExpressionASTFromPath([
          'response',
          ...(node.content.valuePath || []),
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
                        types.callExpression(types.identifier(setStateName), [stateNameAST])
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

export default createNextComponentInlineFetchPlugin()
