import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { UIDLInitialPropsData, PagePaginationOptions } from '@teleporthq/teleport-types'

export const generateInitialPropsAST = (
  initialPropsData: UIDLInitialPropsData,
  isDetailsPage = false,
  resourceImportName: string,
  pagination?: PagePaginationOptions
) => {
  return types.exportNamedDeclaration(
    (() => {
      const node = types.functionDeclaration(
        types.identifier('getStaticProps'),
        [types.identifier('context')],
        types.blockStatement([
          ...computePropsAST(initialPropsData, isDetailsPage, resourceImportName, pagination),
        ]),
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
  isDetailsPage = false,
  resourceImportName: string,
  pagination?: PagePaginationOptions
) => {
  const declerationAST = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('response'),
      types.awaitExpression(types.callExpression(types.identifier(resourceImportName), []))
    ),
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

  return [declerationAST, returnAST]
}
