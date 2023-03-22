import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { Resource } from '@teleporthq/teleport-types'

export const generateInitialPropsAST = (resource: Resource, propsPrefix = '') => {
  const computedResourceAST =
    resource.type === 'static'
      ? [computeStaticValuePropsAST(resource)]
      : computeRemoteValuePropsAST(resource, propsPrefix)

  return types.exportNamedDeclaration(
    (() => {
      const node = types.functionDeclaration(
        types.identifier('getStaticProps'),
        [types.identifier('props')],
        types.blockStatement([...computedResourceAST]),
        false,
        true
      )

      node.async = true
      return node
    })()
  )
}

const computeStaticValuePropsAST = (resource: Resource) => {
  if (resource.type !== 'static') {
    return null
  }

  const resultAST = ASTUtils.generateStaticResourceAST(resource)

  return types.returnStatement(
    types.objectExpression([
      types.objectProperty(
        types.identifier('props'),
        types.objectExpression([
          types.objectProperty(types.identifier(resource.exposeAs.name), resultAST, false, false),
        ]),
        false,
        false
      ),
      types.objectProperty(types.identifier('revalidate'), types.numericLiteral(1), false, false),
    ])
  )
}

const computeRemoteValuePropsAST = (resource: Resource, propsPrefix = '') => {
  if (resource.type !== 'remote') {
    return null
  }

  const resourceASTs = ASTUtils.generateRemoteResourceASTs(resource, propsPrefix)

  const returnAST = types.returnStatement(
    types.objectExpression([
      types.objectProperty(
        types.identifier('props'),
        types.objectExpression([
          types.objectProperty(
            types.identifier(resource.exposeAs.name),
            types.memberExpression(types.identifier('response'), types.identifier('data'), false),
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
