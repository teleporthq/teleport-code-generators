import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { UIDLInitialPropsData, UIDLResources } from '@teleporthq/teleport-types'
import { StringUtils } from '@teleporthq/teleport-shared'

export const generateInitialPropsAST = (
  initialPropsData: UIDLInitialPropsData,
  resourceImportName: string,
  globalCache: UIDLResources['cache']
) => {
  const functionContentAST = types.blockStatement([
    types.tryStatement(
      types.blockStatement([...computePropsAST(initialPropsData, resourceImportName, globalCache)]),
      types.catchClause(
        types.identifier('error'),
        types.blockStatement([
          types.returnStatement(
            types.objectExpression([
              types.objectProperty(types.identifier('notFound'), types.booleanLiteral(true)),
            ])
          ),
        ])
      )
    ),
  ])

  return types.exportNamedDeclaration(
    (() => {
      const node = types.functionDeclaration(
        types.identifier('getStaticProps'),
        [types.identifier('context')],
        functionContentAST,
        false,
        true
      )

      node.async = true
      return node
    })()
  )
}

const computePropsAST = (
  initialPropsData: UIDLInitialPropsData,
  resourceImportName: string,
  globalCache: UIDLResources['cache']
) => {
  const funcParams: types.ObjectProperty[] = Object.keys(
    initialPropsData.resource?.params || {}
  ).reduce((acc: types.ObjectProperty[], item) => {
    const prop = initialPropsData.resource.params[item]
    acc.push(types.objectProperty(types.stringLiteral(item), ASTUtils.resolveObjectValue(prop)))

    return acc
  }, [])

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
  const perPageCache = initialPropsData.cache
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

  const declarationAST = types.variableDeclaration('const', [
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
    ...(initialPropsData.exposeAs.valuePath || []),
  ])

  const notFoundAST = types.ifStatement(
    types.unaryExpression('!', responseMemberAST),
    types.blockStatement([
      types.returnStatement(
        types.objectExpression([
          types.objectProperty(types.identifier('notFound'), types.booleanLiteral(true)),
        ])
      ),
    ])
  )

  const returnAST = types.returnStatement(
    types.objectExpression(
      [
        types.objectProperty(
          types.identifier('props'),
          types.objectExpression([
            types.objectProperty(
              types.identifier(
                StringUtils.createStateOrPropStoringValue(initialPropsData.exposeAs.name)
              ),
              responseMemberAST,
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

  return [declarationAST, notFoundAST, returnAST]
}
