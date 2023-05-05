// @ts-nocheck
import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { UIDLInitialPropsData, PagePaginationOptions } from '@teleporthq/teleport-types'

export const generateInitialPropsAST = (
  initialPropsData: UIDLInitialPropsData,
  propsPrefix = '',
  isDetailsPage = false,
  pagination?: PagePaginationOptions
) => {
  return types.exportNamedDeclaration(
    (() => {
      const node = types.functionDeclaration(
        types.identifier('getStaticProps'),
        [types.identifier('context')],
        types.blockStatement([...computePropsAST(initialPropsData, propsPrefix, pagination)]),
        false,
        true
      )

      node.async = true
      return node
    })()
  )
}

const computePropsAST = (
  propsData: UIDLInitialPropsData,
  propsPrefix = '',
  isDetailsPage = false,
  pagination?: PagePaginationOptions
) => {
  const mappedResponse: types.CallExpression | types.Identifier = types.identifier('response')
  const mappedDataAST = types.variableDeclaration('const', [
    types.variableDeclarator(types.identifier('mappedData'), mappedResponse),
  ])

  const responseMemberAST = ASTUtils.generateMemberExpressionASTFromPath([
    'response',
    ...(propsData.exposeAs.valuePath || []),
  ])

  const dataWeNeedAccessorAST =
    isDetailsPage && !pagination
      ? types.memberExpression(responseMemberAST, types.numericLiteral(0), true)
      : responseMemberAST

  const returnAST = types.returnStatement(
    types.objectExpression([
      types.objectProperty(
        types.identifier('props'),
        types.objectExpression([
          types.objectProperty(
            types.identifier(propsData.exposeAs.name),
            propsData.exposeAs.itemValuePath?.length
              ? ASTUtils.generateMemberExpressionASTFromBase(
                  dataWeNeedAccessorAST,
                  propsData.exposeAs.itemValuePath
                )
              : dataWeNeedAccessorAST,
            false,
            false
          ),
        ]),
        false,
        false
      ),
      types.objectProperty(types.identifier('revalidate'), types.numericLiteral(1), false, false),
    ])
  )

  return [returnAST]
}
