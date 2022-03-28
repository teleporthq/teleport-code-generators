import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { ASTUtils, StyleBuilders, ASTBuilders } from '@teleporthq/teleport-plugin-common'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  UIDLStyleValue,
  PluginStyledJSX,
} from '@teleporthq/teleport-types'
import { generateStyledJSXTag } from './utils'
import * as types from '@babel/types'

interface StyledJSXConfig {
  componentChunkName: string
  forceScoping: boolean
}

export const createReactStyledJSXPlugin: ComponentPluginFactory<StyledJSXConfig> = (config) => {
  const { componentChunkName = 'jsx-component', forceScoping = false } = config || {}

  const reactStyledJSXPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, options } = structure
    const { projectStyleSet } = options
    const { node, styleSetDefinitions: componentStyleSheet = {} } = uidl

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup as Record<string, types.JSXElement>
    const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop as string
    const mediaStylesMap: Record<string, Record<string, unknown>> = {}
    const classMap: string[] = []

    const transformStyle = (style: Record<string, UIDLStyleValue>) =>
      UIDLUtils.transformDynamicStyles(style, (styleValue) => {
        switch (styleValue.content.referenceType) {
          case 'token':
            return `var(${StringUtils.generateCSSVariableName(styleValue.content.id)})`
          case 'prop':
            return `\$\{${propsPrefix}.${styleValue.content.id}\}`
          default:
            throw new PluginStyledJSX(
              `Error running transformDynamicStyles in reactStyledJSXChunkPlugin. Unsupported styleValue.content.referenceType value ${styleValue.content.referenceType}`
            )
        }
      })

    UIDLUtils.traverseElements(node, (element) => {
      const classNamesToAppend: Set<string> = new Set()
      const dynamicVariantsToAppend: Set<types.Identifier | types.MemberExpression> = new Set()
      const { style = {}, key, referencedStyles = {} } = element
      const elementClassName = StringUtils.camelCaseToDashCase(key)
      const className = forceScoping
        ? `${StringUtils.camelCaseToDashCase(
            UIDLUtils.getComponentClassName(uidl)
          )}-${elementClassName}`
        : elementClassName

      if (Object.keys(style).length === 0 && Object.keys(referencedStyles).length === 0) {
        return
      }

      const root = jsxNodesLookup[key]

      // Generating the string templates for the dynamic styles
      if (Object.keys(style).length > 0) {
        const styleRules = transformStyle(style)
        classMap.push(StyleBuilders.createCSSClass(className, styleRules))
        classNamesToAppend.add(className)
      }

      Object.values(referencedStyles).forEach((styleRef) => {
        switch (styleRef.content.mapType) {
          case 'inlined': {
            const { conditions } = styleRef.content
            if (conditions[0].conditionType === 'screen-size') {
              mediaStylesMap[conditions[0].maxWidth] = {
                ...mediaStylesMap[conditions[0].maxWidth],
                [className]: transformStyle(styleRef.content.styles),
              }
            }

            if (conditions[0].conditionType === 'element-state') {
              classMap.push(
                StyleBuilders.createCSSClassWithSelector(
                  className,
                  `&:${conditions[0].content}`,
                  transformStyle(styleRef.content.styles)
                )
              )
            }

            classNamesToAppend.add(className)

            return
          }

          case 'component-referenced': {
            if (styleRef.content.content.type === 'static') {
              classNamesToAppend.add(String(styleRef.content.content.content))
            }

            if (
              styleRef.content.content.type === 'dynamic' &&
              styleRef.content.content.content.referenceType === 'prop'
            ) {
              dynamicVariantsToAppend.add(
                types.memberExpression(
                  types.identifier(propsPrefix),
                  types.identifier(styleRef.content.content.content.id)
                )
              )
            }

            if (
              styleRef.content.content.type === 'dynamic' &&
              styleRef.content.content.content.referenceType === 'comp'
            ) {
              classNamesToAppend.add(styleRef.content.content.content.id)
            }

            return
          }

          case 'project-referenced': {
            if (!projectStyleSet) {
              throw new PluginStyledJSX(
                `Project Style Sheet is missing, but the node is referring to it ${element}`
              )
            }

            const { content } = styleRef
            const referedStyle = projectStyleSet.styleSetDefinitions[content.referenceId]
            if (!referedStyle) {
              throw new PluginStyledJSX(
                `Style that is being used for reference is missing - ${content.referenceId}`
              )
            }

            classNamesToAppend.add(StringUtils.camelCaseToDashCase(content.referenceId))
            return
          }

          default: {
            throw new PluginStyledJSX('We support only project-referneced and inlined for now.')
          }
        }
      })

      ASTUtils.addClassStringOnJSXTag(
        root as types.JSXElement,
        Array.from(classNamesToAppend).join(' '),
        'className',
        Array.from(dynamicVariantsToAppend)
      )
    })

    /* Generating component scoped styles */
    if (Object.keys(componentStyleSheet).length > 0) {
      StyleBuilders.generateStylesFromStyleSetDefinitions(
        componentStyleSheet,
        classMap,
        mediaStylesMap,
        UIDLUtils.getComponentClassName(uidl)
      )
    }

    if (Object.keys(mediaStylesMap).length > 0) {
      Object.keys(mediaStylesMap)
        .sort((a: string, b: string) => Number(a) - Number(b))
        .reverse()
        .forEach((mediaOffset: string) => {
          classMap.push(
            StyleBuilders.createCSSClassWithMediaQuery(
              `max-width: ${mediaOffset}px`,
              mediaStylesMap[mediaOffset] as Record<string, string | number>
            )
          )
        })
    }

    if (!classMap || !classMap.length) {
      return structure
    }

    const jsxASTNodeReference = generateStyledJSXTag(classMap.join('\n'))
    // We have the ability to insert the tag into the existig JSX structure, or do something else with it.
    // Here we take the JSX <style> tag and we insert it as the last child of the JSX structure
    // inside the React Component
    let rootJSXNode = jsxNodesLookup[uidl.node.content.key]

    const originalRootNode = rootJSXNode
    rootJSXNode = ASTBuilders.createJSXTag('')
    rootJSXNode.children.push(originalRootNode)

    // fetching the AST parent of the root JSXNode
    // We need to replace the root node with a fragment <>
    // The fragment will be the parent of both the old root JSXNode and the style tag
    const componentAST = componentChunk.content as types.VariableDeclaration
    const arrowFnExpr = componentAST.declarations[0].init as types.ArrowFunctionExpression
    const bodyStatement = arrowFnExpr.body as types.BlockStatement
    const returnStatement = bodyStatement.body[0] as types.ReturnStatement
    returnStatement.argument = rootJSXNode

    rootJSXNode.children.push(jsxASTNodeReference)
    return structure
  }

  return reactStyledJSXPlugin
}

export default createReactStyledJSXPlugin()
