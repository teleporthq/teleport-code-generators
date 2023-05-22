import * as types from '@babel/types'
import { InitialPropsData, PagePaginationOptions } from '@teleporthq/teleport-types'
import { StringUtils } from '@teleporthq/teleport-shared'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'

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

  let mappedResponse: types.CallExpression | types.Identifier = types.identifier('response')
  propsData.resourceMappers?.forEach((mapper) => {
    mappedResponse = types.callExpression(types.identifier(mapper.name), [mappedResponse])
  })

  const mappedDataAST = types.variableDeclaration('const', [
    types.variableDeclarator(types.identifier('mappedData'), mappedResponse),
  ])

  const responseMemberAST = ASTUtils.generateMemberExpressionASTFromPath([
    propsData.resourceMappers?.length ? 'mappedData' : 'response',
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
            types.identifier(StringUtils.createStateOrPropStoringValue(propsData.exposeAs.name)),
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

  return [...resourceASTs, ...(propsData.resourceMappers?.length ? [mappedDataAST] : []), returnAST]
}
