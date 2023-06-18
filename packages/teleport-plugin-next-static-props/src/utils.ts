import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { UIDLInitialPropsData, PagePaginationOptions } from '@teleporthq/teleport-types'
import { StringUtils } from '@teleporthq/teleport-shared'

export const generateInitialPropsAST = (
  initialPropsData: UIDLInitialPropsData,
  isDetailsPage = false,
  resourceImportName: string,
  resource: UIDLInitialPropsData['resource'],
  pagination?: PagePaginationOptions
) => {
  return types.exportNamedDeclaration(
    (() => {
      const node = types.functionDeclaration(
        types.identifier('getStaticProps'),
        [types.identifier('context')],
        types.blockStatement([
          ...computePropsAST(
            initialPropsData,
            isDetailsPage,
            resourceImportName,
            resource,
            pagination
          ),
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
  resource: UIDLInitialPropsData['resource'],
  pagination?: PagePaginationOptions
) => {
  const funcParams: types.ObjectProperty[] = Object.keys(resource?.params || {}).reduce(
    (acc: types.ObjectProperty[], item) => {
      const prop = resource.params[item]
      acc.push(types.objectProperty(types.stringLiteral(item), ASTUtils.resolveObjectValue(prop)))

      return acc
    },
    []
  )

  const declerationAST = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('response'),
      types.awaitExpression(
        types.callExpression(types.identifier(resourceImportName), [
          types.objectExpression([
            types.spreadElement(
              types.memberExpression(
                types.identifier('context'),
                types.identifier('params'),
                false,
                true
              )
            ),
            ...funcParams,
          ]),
        ])
      )
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

  console.log(
    propsData.exposeAs.itemValuePath?.length
      ? ASTUtils.generateMemberExpressionASTFromBase(
          dataWeNeedAccessorAST,
          propsData.exposeAs.itemValuePath
        )
      : dataWeNeedAccessorAST
  )

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

  return [declerationAST, returnAST]
}
