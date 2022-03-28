import * as types from '@babel/types'
import { StringUtils } from '@teleporthq/teleport-shared'
import {
  UIDLStyleValue,
  UIDLDependency,
  UIDLStyleSetDefinition,
  PluginStyledComponent,
} from '@teleporthq/teleport-types'

export const generateStyledComponent = (params: {
  name: string
  elementType: string
  styles: types.ObjectExpression
  propsReferred: Set<string>
  componentStyleReferences: Set<string>
  projectStyleReferences: Set<string>
}) => {
  const {
    name,
    elementType,
    styles,
    propsReferred,
    componentStyleReferences,
    projectStyleReferences,
  } = params
  let styleExpressions: types.ObjectExpression | types.ArrowFunctionExpression = styles
  const expressionArguments: Array<
    types.ObjectExpression | types.ArrowFunctionExpression | types.Identifier
  > = []

  if (propsReferred.size > 0) {
    styleExpressions = types.arrowFunctionExpression([types.identifier('props')], styles)
  }

  if (projectStyleReferences.size > 0) {
    expressionArguments.push(
      ...Array.from(projectStyleReferences).map((ref) => types.identifier(ref))
    )
  }

  if (styles && styles.properties.length > 0) {
    expressionArguments.push(styleExpressions)
  }

  if (componentStyleReferences.size > 0) {
    expressionArguments.push(
      ...Array.from(componentStyleReferences).map((ref) => types.identifier(ref))
    )
  }

  return types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier(name),
      types.callExpression(
        types.callExpression(types.identifier('styled'), [types.stringLiteral(elementType)]),
        expressionArguments
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

      if (style.type === 'dynamic' && style.content.referenceType === 'state') {
        throw new PluginStyledComponent(`Error running transformDynamicStyles in reactStyledComponentsPlugin. 
        Unsupported styleValue.content.referenceType value ${style.content.referenceType}`)
      }

      if (style.type === 'dynamic' && style.content.referenceType === 'prop') {
        const isNestedProp = style.content.id.includes('.')
        acc.push(
          types.objectProperty(
            styleKey,
            types.memberExpression(
              types.identifier(propsPrefix),
              isNestedProp
                ? types.identifier(style.content.id)
                : types.identifier(`'${style.content.id}'`),
              !isNestedProp
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
  variantPropKey: string,
  tokensReferred?: Set<string>
) => {
  const variantExpressions = types.objectExpression(
    Object.keys(styleSets).reduce((acc: types.ObjectProperty[], styleId) => {
      const style = styleSets[styleId]
      const { content = {}, conditions = [] } = style

      const property = types.objectProperty(
        types.stringLiteral(StringUtils.dashCaseToCamelCase(styleId)),
        generateStyledComponentStyles({
          styles: content,
          ...(tokensReferred && { tokensReferred }),
        })
      )

      conditions.forEach((cond) => {
        const mediaProperty = types.objectProperty(
          cond.type === 'screen-size'
            ? types.stringLiteral(`@media(max-width: ${cond.meta.maxWidth}px)`)
            : types.stringLiteral(`&:${cond.meta.state}`),
          generateStyledComponentStyles({
            styles: cond.content,
            ...(tokensReferred && { tokensReferred }),
          })
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
