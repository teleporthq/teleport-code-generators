import * as types from '@babel/types'
import { StringUtils } from '@teleporthq/teleport-shared'
import { UIDLStyleValue, UIDLDependency, UIDLStyleSetDefinition } from '@teleporthq/teleport-types'

export const generateStyledComponent = (params: {
  name: string
  elementType: string
  styles: types.ObjectExpression
  propsReferred: Set<string>
  styleReferences: Set<string>
}) => {
  const { name, elementType, styles, propsReferred, styleReferences } = params
  let styleExpressions: types.ObjectExpression | types.ArrowFunctionExpression = styles

  if (propsReferred.size > 0) {
    styleExpressions = types.arrowFunctionExpression([types.identifier('props')], styles)
  }

  return types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier(name),
      types.callExpression(
        types.callExpression(types.identifier('styled'), [types.stringLiteral(elementType)]),
        [...Array.from(styleReferences).map((ref) => types.identifier(ref)), styleExpressions]
      )
    ),
  ])
}

export const removeUnusedDependencies = (
  dependencies: Record<string, UIDLDependency>,
  jsxNodesLookup: Record<string, types.JSXElement>
) => {
  Object.keys(dependencies).forEach((depKey) => {
    const dependency = dependencies[depKey]
    if (dependency.type === 'library' && dependency.path === 'react-native') {
      const dependencyIsStillNeeded = Object.keys(jsxNodesLookup).some((elementKey) => {
        const jsxNode = jsxNodesLookup[elementKey]
        return (jsxNode.openingElement.name as types.JSXIdentifier).name === depKey
      })

      if (!dependencyIsStillNeeded) {
        delete dependencies[depKey]
      }
    }
  })
}

export const generateStyledComponentStyles = (params: {
  styles: Record<string, UIDLStyleValue>
  propsReferred?: Set<string>
  tokensReferred?: Set<string>
  propsPrefix?: string
  tokensPrefix?: string
}): types.ObjectExpression => {
  const {
    styles,
    tokensReferred,
    propsReferred,
    propsPrefix = 'props',
    tokensPrefix = 'TOKENS',
  } = params
  const properties: types.ObjectProperty[] = Object.keys(styles).reduce(
    (acc: types.ObjectProperty[], styleId) => {
      const style = styles[styleId]
      const styleKey = types.stringLiteral(StringUtils.camelCaseToDashCase(styleId))

      if (style.type === 'static') {
        const styleContent =
          typeof style.content === 'string'
            ? types.stringLiteral(style.content)
            : types.numericLiteral(Number(style.content))
        acc.push(types.objectProperty(styleKey, styleContent))
      }

      if (style.type === 'dynamic' && style.content.referenceType === 'prop') {
        acc.push(
          types.objectProperty(
            styleKey,
            types.memberExpression(
              types.identifier(propsPrefix),
              types.identifier(style.content.id)
            )
          )
        )
        propsReferred?.add(style.content.id)
      }

      if (style.type === 'dynamic' && style.content.referenceType === 'token') {
        const usedToken = StringUtils.capitalize(StringUtils.dashCaseToCamelCase(style.content.id))
        acc.push(
          types.objectProperty(
            styleKey,
            types.memberExpression(types.identifier(tokensPrefix), types.identifier(usedToken))
          )
        )
        tokensReferred?.add(usedToken)
      }

      return acc
    },
    []
  )

  return types.objectExpression(properties)
}

export const generateVariantsfromStyleSet = (
  styleSets: Record<string, UIDLStyleSetDefinition>,
  variantPropPrefix: string,
  variantPropKey: string
) => {
  const variantExpressions = types.objectExpression(
    Object.keys(styleSets).reduce((acc: types.ObjectProperty[], styleId) => {
      const style = styleSets[styleId]
      const { content = {}, conditions = [] } = style

      const property = types.objectProperty(
        types.stringLiteral(styleId),
        generateStyledComponentStyles({ styles: content })
      )

      conditions.forEach((cond) => {
        const mediaProperty = types.objectProperty(
          cond.type === 'screen-size'
            ? types.stringLiteral(`@media(max-width: ${cond.meta.maxWidth}px)`)
            : types.stringLiteral(`&:${cond.meta.state}`),
          generateStyledComponentStyles({ styles: cond.content })
        )

        if (property.value.type === 'ObjectExpression') {
          property.value.properties.push(mediaProperty)
        }
      })

      acc.push(property)
      return acc
    }, [])
  )

  return types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier(variantPropPrefix),
      types.callExpression(types.identifier('variant'), [
        types.objectExpression([
          types.objectProperty(types.identifier('prop'), types.stringLiteral(variantPropKey)),
          types.objectProperty(types.identifier('variants'), variantExpressions),
        ]),
      ])
    ),
  ])
}
