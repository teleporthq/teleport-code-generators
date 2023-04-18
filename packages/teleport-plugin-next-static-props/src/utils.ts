import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { InitialPropsData, PagePaginationOptions } from '@teleporthq/teleport-types'

export const generateInitialPropsAST = (
  initialPropsData: InitialPropsData,
  propsPrefix = '',
  isDetailsPage = false,
  pagination?: PagePaginationOptions
) => {
  const computedResourceAST = computePropsAST(
    initialPropsData,
    propsPrefix,
    isDetailsPage,
    pagination
  )

  return types.exportNamedDeclaration(
    (() => {
      const node = types.functionDeclaration(
        types.identifier('getStaticProps'),
        [types.identifier('context')],
        types.blockStatement([...computedResourceAST]),
        false,
        true
      )

      node.async = true
      return node
    })()
  )
}

const computePropsAST = (
  propsData: InitialPropsData,
  propsPrefix = '',
  isDetailsPage = false,
  pagination?: PagePaginationOptions
) => {
  const resourceASTs = ASTUtils.generateRemoteResourceASTs(propsData.resource, propsPrefix)

  const responseMemberAST = ASTUtils.generateMemberExpressionASTFromPath([
    'response',
    ...propsData.exposeAs.valuePath,
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

  return [...resourceASTs, returnAST]
}
