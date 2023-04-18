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
  const currentPageAST = pagination
    ? types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('currentPage'),
          types.memberExpression(
            types.memberExpression(types.identifier('context'), types.identifier('params'), false),
            types.identifier('page'),
            false
          )
        ),
      ])
    : null

  const resourceASTs = ASTUtils.generateRemoteResourceASTs(propsData.resource, propsPrefix, () => {
    if (!pagination) {
      return [] as types.ObjectProperty[]
    }

    return [
      types.objectProperty(
        types.stringLiteral(pagination.pageUrlSearchParamKey),
        types.identifier('currentPage'),
        false,
        false
      ),
    ]
  })

  const responseMemberAST = types.memberExpression(
    types.identifier('response'),
    types.identifier('data'),
    false
  )

  const returnAST = types.returnStatement(
    types.objectExpression([
      types.objectProperty(
        types.identifier('props'),
        types.objectExpression([
          types.objectProperty(
            types.identifier(propsData.exposeAs.name),
            isDetailsPage && !pagination
              ? types.memberExpression(responseMemberAST, types.numericLiteral(0), true)
              : responseMemberAST,
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

  return [...(currentPageAST ? [currentPageAST] : []), ...resourceASTs, returnAST]
}
