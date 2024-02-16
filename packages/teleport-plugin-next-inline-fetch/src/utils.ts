import {
  UIDLCMSItemNode,
  UIDLCMSListNode,
  ChunkDefinition,
  UIDLResourceLink,
  UIDLResourceItem,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'

export const computeUseEffectAST = (params: {
  fileName: string
  resourceType: UIDLResourceItem['method']
  node: UIDLCMSItemNode | UIDLCMSListNode
  componentChunk: ChunkDefinition
  params: UIDLResourceLink['params']
}) => {
  const { node, fileName, componentChunk, resourceType } = params
  if (node.type !== 'cms-item' && node.type !== 'cms-list') {
    throw new Error('Invalid node type passed to computeUseEffectAST')
  }

  const { key, valuePath = [] } = node.content
  const jsxNode = componentChunk.meta.nodesLookup[key] as types.JSXElement
  let resourcePath: types.StringLiteral | types.TemplateLiteral = types.stringLiteral(
    `/api/${fileName}`
  )

  const resourceParameters: types.ObjectProperty[] = []

  if (resourceType === 'GET' && Object.keys(params).length > 0) {
    resourcePath = types.templateLiteral(
      [
        types.templateElement({ raw: `/api/${fileName}?`, cooked: `/api/${fileName}?` }),
        types.templateElement({ raw: '', cooked: '' }),
      ],
      [types.newExpression(types.identifier('URLSearchParams'), [types.identifier('params')])]
    )
  }

  if (resourceType === 'POST' && Object.keys(params).length > 0) {
    resourceParameters.push(
      types.objectProperty(types.identifier('method'), types.stringLiteral('POST')),
      types.objectProperty(
        types.identifier('body'),
        types.callExpression(
          types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
          [types.identifier('params')]
        )
      )
    )
  }

  const headers = types.objectProperty(
    types.identifier('headers'),
    types.objectExpression([
      types.objectProperty(
        types.stringLiteral('Content-Type'),
        types.stringLiteral('application/json')
      ),
    ])
  )

  /*
      For NextJS projects, we wrap the direct CMS calls with a `/api`
      from Next. So, the return type is always going to be `json`. We can safely
      set the return type to `.json()`. Because the actual return type is handled
      in the resource itself. `/api/resource/resource.js`
    */

  const fetchAST = types.callExpression(
    types.memberExpression(
      types.callExpression(
        types.identifier('fetch'),
        [resourcePath, types.objectExpression([headers, ...resourceParameters])].filter(Boolean)
      ),
      types.identifier('then')
    ),
    [
      types.arrowFunctionExpression(
        [types.identifier('res')],
        types.callExpression(
          types.memberExpression(types.identifier('res'), types.identifier('json')),
          []
        )
      ),
    ]
  )

  const responseExpression = ASTUtils.generateMemberExpressionASTFromPath([
    'data',
    ...valuePath,
  ]) as types.OptionalMemberExpression

  const resourceAST = types.arrowFunctionExpression(
    [types.identifier('params')],
    valuePath.length >= 0
      ? types.callExpression(types.memberExpression(fetchAST, types.identifier('then'), false), [
          types.arrowFunctionExpression([types.identifier('data')], responseExpression),
        ])
      : fetchAST
  )

  jsxNode.openingElement.attributes.unshift(
    types.jSXAttribute(types.jsxIdentifier('fetchData'), types.jsxExpressionContainer(resourceAST))
  )

  return
}
