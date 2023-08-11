import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import {
  UIDLInitialPropsData,
  PagePaginationOptions,
  UIDLResources,
} from '@teleporthq/teleport-types'
import { StringUtils } from '@teleporthq/teleport-shared'

export const generateInitialPropsAST = (
  initialPropsData: UIDLInitialPropsData,
  isDetailsPage = false,
  resourceImportName: string,
  resource: UIDLInitialPropsData['resource'],
  cache: UIDLResources['cache'],
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
            cache,
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
  cache: UIDLResources['cache'],
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

  /*
    Per-page cache can override the global cache.
    Gobally the project don't need to have a cache.
    But for a specific page, it can have a cache.
    Eg:
      Handling paths
      - /blog-posts
      - /blog-pots/${id}

      using webhook. And then letting page cache handler to do pages like
      - /blog-posts/page/${id}
  */
  const globalCache = cache
  const perPageCache = propsData.cache
  let cachePropertyAST: types.ObjectProperty | null = null

  if (globalCache?.revalidate && !perPageCache?.revalidate) {
    cachePropertyAST = types.objectProperty(
      types.identifier('revalidate'),
      types.numericLiteral(globalCache.revalidate)
    )
  }

  if (perPageCache?.revalidate) {
    cachePropertyAST = types.objectProperty(
      types.identifier('revalidate'),
      types.numericLiteral(perPageCache.revalidate)
    )
  }

  const declerationAST = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('response'),
      types.awaitExpression(
        types.callExpression(types.identifier(resourceImportName), [
          types.objectExpression([
            types.spreadElement(
              types.optionalMemberExpression(
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
      ? types.optionalMemberExpression(responseMemberAST, types.numericLiteral(0), true, true)
      : responseMemberAST

  const returnAST = types.returnStatement(
    types.objectExpression(
      [
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
            types.spreadElement(
              types.optionalMemberExpression(
                types.identifier('response'),
                types.identifier('meta'),
                false,
                true
              )
            ),
          ]),
          false,
          false
        ),
        cachePropertyAST,
      ].filter(Boolean)
    )
  )

  return [declerationAST, returnAST]
}
