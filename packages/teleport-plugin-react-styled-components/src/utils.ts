import * as t from '@babel/types'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { UIDLStyleValue, UIDLDependency, UIDLReferencedStyles } from '@teleporthq/teleport-types'

export const generateStyledComponent = (
  name: string,
  type: string,
  styles: Record<string, unknown>,
  projectReferencedStyles?: string[]
) => {
  return t.variableDeclaration('const', [
    t.variableDeclarator(
      t.identifier(name),
      t.taggedTemplateExpression(
        t.memberExpression(t.identifier('styled'), t.identifier(type)),
        projectReferencedStyles?.length > 0
          ? ASTUtils.stringAsTemplateLiteral(
              `${projectReferencedStyles.map((item) => `\$\{${item}\};`)} ${mapStyles(styles)}`
            )
          : ASTUtils.stringAsTemplateLiteral(mapStyles(styles))
      )
    ),
  ])
}

export const generateCSSInterpolate = (name: string, styles: Record<string, unknown>) => {
  return t.variableDeclaration('const', [
    t.variableDeclarator(
      t.identifier(name),
      t.taggedTemplateExpression(
        t.identifier('css'),
        ASTUtils.stringAsTemplateLiteral(mapStyles(styles))
      )
    ),
  ])
}

export const generateExportablCSSInterpolate = (name: string, styles: Record<string, unknown>) => {
  return t.exportNamedDeclaration(generateCSSInterpolate(name, styles))
}

const mapStyles = (styles: Record<string, unknown>): string => {
  return Object.keys(styles || {}).reduce((acc: string, item) => {
    const value = styles[item]
    acc =
      typeof value === 'string' || typeof value === 'number'
        ? `${acc} ${StringUtils.camelCaseToDashCase(item)}: ${value}; \n`
        : `${acc} ${item} {\n ${mapStyles(value as Record<string, unknown>)}};`
    return acc
  }, ``)
}

export const countPropReferences = (
  style: Record<string, UIDLStyleValue>,
  timesReferred: number
) => {
  if (style && Object.keys(style).length > 0) {
    Object.keys(style).map((item) => {
      const styleAttr = style[item]
      if (styleAttr.type === 'dynamic' && styleAttr.content.referenceType === 'prop') {
        timesReferred++
      }
    })
    return timesReferred
  }
  return timesReferred
}

export const countPropRefernecesFromReferencedStyles = (
  styles: UIDLReferencedStyles,
  timesReferred: number
) => {
  let propsCount = 0
  if (styles && Object.keys(styles).length > 0) {
    Object.values(styles).forEach((styleRef) => {
      if (styleRef.content.mapType === 'inlined') {
        propsCount = countPropReferences(styleRef.content.styles, 0)
      }
    })
  }
  return timesReferred + propsCount
}

export const removeUnusedDependencies = (
  dependencies: Record<string, UIDLDependency>,
  jsxNodesLookup: Record<string, t.JSXElement>
) => {
  Object.keys(dependencies).forEach((depKey) => {
    const dependency = dependencies[depKey]
    if (dependency.type === 'library' && dependency.path === 'react-native') {
      const dependencyIsStillNeeded = Object.keys(jsxNodesLookup).some((elementKey) => {
        const jsxNode = jsxNodesLookup[elementKey]
        return (jsxNode.openingElement.name as t.JSXIdentifier).name === depKey
      })

      if (!dependencyIsStillNeeded) {
        delete dependencies[depKey]
      }
    }
  })
}

export const generatePropReferencesSyntax = (
  style: Record<string, UIDLStyleValue>,
  timesReferred: number,
  root?: t.JSXElement,
  propsPrefix?: unknown
) => {
  let tokensUsed = false
  const transformedStyles = UIDLUtils.transformDynamicStyles(style, (styleValue, attribute) => {
    switch (styleValue.content.referenceType) {
      case 'prop': {
        const dashCaseAttribute = StringUtils.dashCaseToCamelCase(attribute)
        if (timesReferred === 1 && root && propsPrefix) {
          ASTUtils.addDynamicAttributeToJSXTag(
            root,
            dashCaseAttribute,
            styleValue.content.id,
            propsPrefix as string
          )
          return `\$\{props => props.${dashCaseAttribute}\}`
        }
        return `\$\{props => props.${styleValue.content.id}\}`
      }
      case 'token':
        tokensUsed = true
        return `\$\{TOKENS.${StringUtils.capitalize(
          StringUtils.dashCaseToCamelCase(styleValue.content.id)
        )}\}`
      default:
        throw new Error(
          `Error running transformDynamicStyles in reactStyledComponentsPlugin. 
          Unsupported styleValue.content.referenceType value ${styleValue.content.referenceType}`
        )
    }
  })

  return {
    transformedStyles,
    tokensUsed,
  }
}
