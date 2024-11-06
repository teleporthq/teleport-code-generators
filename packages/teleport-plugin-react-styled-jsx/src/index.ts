import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { ASTUtils, StyleBuilders, ASTBuilders } from '@teleporthq/teleport-plugin-common'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  UIDLStyleValue,
  PluginStyledJSX,
  UIDLElement,
  UIDLElementNode,
} from '@teleporthq/teleport-types'
import { generateStyledJSXTag } from './utils'
import * as types from '@babel/types'

interface StyledJSXConfig {
  componentChunkName: string
}

const transformStyle = (style: Record<string, UIDLStyleValue>, propsPrefix: string) =>
  UIDLUtils.transformDynamicStyles(style, (styleValue) => {
    switch (styleValue.content.referenceType) {
      case 'token':
        return `var(${StringUtils.generateCSSVariableName(styleValue.content.id)})`
      case 'prop':
        return `\$\{${propsPrefix}.${styleValue.content.id}\}`
      default:
        throw new PluginStyledJSX(
          `Error running transformDynamicStyles in reactStyledJSXChunkPlugin.\n
          Unsupported styleValue.content.referenceType value ${styleValue.content.referenceType}`
        )
    }
  })

export const createReactStyledJSXPlugin: ComponentPluginFactory<StyledJSXConfig> = (config) => {
  const { componentChunkName = 'jsx-component' } = config || {}

  const reactStyledJSXPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, options } = structure
    const { projectStyleSet } = options
    const { node, styleSetDefinitions: componentStyleSheet = {}, propDefinitions = {} } = uidl
    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup as Record<string, types.JSXElement>
    const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop as string
    const mediaStylesMap: Record<
      string,
      Array<{ [x: string]: Record<string, string | number> }>
    > = {}
    const classMap: string[] = []

    const generateStylesForElementNode = (element: UIDLElement) => {
      const classNamesToAppend: Set<string> = new Set()
      const dynamicVariantsToAppend: Set<types.Identifier | types.MemberExpression> = new Set()
      const {
        style = {},
        key,
        referencedStyles = {},
        attrs = {},
        dependency,
        elementType,
      } = element

      if (key === undefined) {
        throw new Error(`Key is missing for element \n ${JSON.stringify(element, null, 2)}`)
      }

      const className = StringUtils.camelCaseToDashCase(key)
      const root = jsxNodesLookup[key]
      if (!root) {
        throw new PluginStyledJSX(
          `Element \n ${JSON.stringify(
            element,
            null,
            2
          )} \n with key ${key} is missing from the template chunk of component ${uidl.name}`
        )
      }

      if (dependency?.type === 'local') {
        StyleBuilders.setPropValueForCompStyle({
          root,
          attrs,
          getClassName: (str: string) => StringUtils.camelCaseToDashCase(elementType + str),
        })
      }

      if (Object.keys(style).length === 0 && Object.keys(referencedStyles).length === 0) {
        return
      }

      // Generating the string templates for the dynamic styles
      if (Object.keys(style).length > 0) {
        const styleRules = transformStyle(style, propsPrefix)
        classMap.push(StyleBuilders.createCSSClass(className, styleRules))
        classNamesToAppend.add(className)
      }

      Object.values(referencedStyles).forEach((styleRef) => {
        switch (styleRef.content.mapType) {
          case 'inlined': {
            const condition = styleRef.content.conditions[0]
            if (condition.conditionType === 'screen-size') {
              const { maxWidth } = condition
              if (!mediaStylesMap[String(maxWidth)]) {
                mediaStylesMap[String(maxWidth)] = []
              }
              mediaStylesMap[String(maxWidth)].push({
                [className]: transformStyle(styleRef.content.styles, propsPrefix),
              })
            }

            if (condition.conditionType === 'element-state') {
              classMap.push(
                StyleBuilders.createCSSClassWithSelector(
                  className,
                  `&:${condition.content}`,
                  transformStyle(styleRef.content.styles, propsPrefix)
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
              const defaultPropValue =
                propDefinitions[styleRef.content.content.content.id]?.defaultValue

              if (!defaultPropValue) {
                return
              }

              propDefinitions[styleRef.content.content.content.id].defaultValue =
                StringUtils.camelCaseToDashCase(String(defaultPropValue))
            }

            if (
              styleRef.content.content.type === 'dynamic' &&
              styleRef.content.content.content.referenceType === 'comp'
            ) {
              classNamesToAppend.add(
                StringUtils.camelCaseToDashCase(styleRef.content.content.content.id)
              )
            }

            return
          }

          case 'project-referenced': {
            const { content } = styleRef
            const referedStyle = projectStyleSet.styleSetDefinitions[content.referenceId]
            if (!referedStyle) {
              throw new PluginStyledJSX(`Project style - ${content.referenceId} is missing`)
            }

            classNamesToAppend.add(content.referenceId)
            return
          }

          default: {
            throw new PluginStyledJSX(
              `Un-supported style reference ${JSON.stringify(styleRef.content, null, 2)}`
            )
          }
        }
      })

      ASTUtils.addClassStringOnJSXTag(
        root as types.JSXElement,
        Array.from(classNamesToAppend).join(' '),
        'className',
        Array.from(dynamicVariantsToAppend)
      )
    }

    UIDLUtils.traverseElements(node, generateStylesForElementNode)
    for (const prop of Object.values(propDefinitions)) {
      if (prop.type === 'element' && prop.defaultValue) {
        UIDLUtils.traverseElements(
          prop.defaultValue as UIDLElementNode,
          generateStylesForElementNode
        )
      }
    }

    /* Generating component scoped styles */
    if (Object.keys(componentStyleSheet).length > 0) {
      StyleBuilders.generateStylesFromStyleSetDefinitions(
        componentStyleSheet,
        classMap,
        mediaStylesMap,
        (styleName: string) => StringUtils.camelCaseToDashCase(uidl.name + styleName)
      )
    }

    if (Object.keys(mediaStylesMap).length > 0) {
      classMap.push(...StyleBuilders.generateMediaStyle(mediaStylesMap))
    }

    if (classMap.length === 0) {
      return structure
    }

    const styleJSXAST = generateStyledJSXTag(classMap.join('\n'))
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
    const arrowFnExpr = componentAST.declarations?.[0]?.init as types.ArrowFunctionExpression
    const bodyStatement = arrowFnExpr.body as types.BlockStatement
    const returnStatement = bodyStatement.body.find(
      (statement) => statement.type === 'ReturnStatement'
    )

    if (!returnStatement) {
      throw new PluginStyledJSX(`Return Statement is missing from the component AST`)
    }
    ;(returnStatement as types.ReturnStatement).argument = rootJSXNode

    rootJSXNode.children.push(styleJSXAST)
    return structure
  }

  return reactStyledJSXPlugin
}

export default createReactStyledJSXPlugin()
