import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import {
  ASTUtils,
  StyleBuilders,
  ASTBuilders,
  ParsedASTNode,
  createBinaryExpression,
} from '@teleporthq/teleport-plugin-common'
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
    const {
      node,
      styleSetDefinitions: componentStyleSheet = {},
      propDefinitions = {},
      stateDefinitions = {},
    } = uidl
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
      const dynamicVariantsToAppend: Set<
        types.Identifier | types.MemberExpression | types.ConditionalExpression
      > = new Set()
      const {
        style = {},
        key,
        referencedStyles = {},
        attrs = {},
        dependency,
        elementType,
        dynamicStyleBindings,
      } = element
      const hasDynamicBindings =
        dynamicStyleBindings && Object.keys(dynamicStyleBindings).length > 0

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

      if (
        Object.keys(style).length === 0 &&
        Object.keys(referencedStyles).length === 0 &&
        !hasDynamicBindings
      ) {
        return
      }

      // Collect all inline styles from various sources
      const allInlineStyles: Record<string, unknown> = {}

      if (hasDynamicBindings) {
        for (const [cssProperty, binding] of Object.entries(dynamicStyleBindings)) {
          const camelCaseProperty = cssProperty.replace(/-([a-z])/g, (_, letter: string) =>
            letter.toUpperCase()
          )
          const staticValue = style[cssProperty]
          const staticTemplate =
            staticValue && staticValue.type === 'static' && typeof staticValue.content === 'string'
              ? staticValue.content
              : null
          allInlineStyles[camelCaseProperty] = StyleBuilders.createDynamicBindingExpression(
            binding,
            undefined,
            cssProperty,
            staticTemplate
          )
        }
      }

      // Separate styles containing template expressions ({{ expr }}) from static CSS.
      // Templates with non-state variables (e.g. {{ enemy.x }}) must be inline styles
      // since those variables are scoped to Repeater render callbacks.
      // Templates with state variables (e.g. {{ state.cameraX }}) are also made inline
      // because they need to be interpolated as JS expressions, not raw CSS text.
      const hasTemplate = (str: string) => /\{\{/.test(str)
      const cssStyles: Record<string, UIDLStyleValue> = {}

      for (const [prop, value] of Object.entries(style)) {
        // Skip properties that have dynamic bindings — they're already handled as inline styles
        if (hasDynamicBindings && dynamicStyleBindings[prop]) {
          continue
        }
        if (
          value.type === 'static' &&
          typeof value.content === 'string' &&
          hasTemplate(value.content)
        ) {
          const camelCaseProperty = prop.replace(/-([a-z])/g, (_, letter: string) =>
            letter.toUpperCase()
          )
          allInlineStyles[camelCaseProperty] = new ParsedASTNode(
            ASTUtils.parseStringWithTemplateExpressions(String(value.content))
          )
        } else {
          cssStyles[prop] = value
        }
      }

      if (Object.keys(allInlineStyles).length > 0) {
        ASTUtils.addAttributeToJSXTag(root as types.JSXElement, 'style', allInlineStyles)
      }

      // Generating the string templates for the dynamic styles
      if (Object.keys(cssStyles).length > 0) {
        const styleRules = transformStyle(cssStyles, propsPrefix)
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
              return
            }

            // Validate that the referenceId is a valid CSS class name.
            // Skip entries that contain dots, quotes, braces, pipes, or other
            // characters that indicate a JavaScript expression fragment was
            // incorrectly used as a class name (e.g. "item.type", "'coin'", "{{", "||")
            const refId = content.referenceId as string
            if (/[.'"{}|()!@#$%^&*+=<>?/\\]/.test(refId) || /^\d/.test(refId)) {
              return
            }

            if (styleRef.content.condition) {
              const referenceContent = styleRef.content.condition.reference.content
              const referenceType = referenceContent.referenceType
              const nameToAppend =
                referenceType === 'local' && referenceContent.refPath?.length
                  ? referenceContent.refPath.join('.')
                  : referenceContent.id

              const { conditions } = styleRef.content.condition.expression

              const operator = conditions[0].operation as '===' | '!==' | '<' | '<=' | '>' | '>='
              const right = conditions[0].operand

              let binaryExpressionType = ''
              switch (referenceType) {
                case 'prop': {
                  binaryExpressionType = propDefinitions[nameToAppend].type
                  break
                }
                case 'state': {
                  binaryExpressionType = stateDefinitions[nameToAppend].type
                  break
                }
                case 'local': {
                  binaryExpressionType = typeof right as string
                  break
                }
                default: {
                  throw new PluginStyledJSX(
                    `Un-supported reference type ${referenceType} for style reference ${JSON.stringify(
                      styleRef.content,
                      null,
                      2
                    )}`
                  )
                }
              }
              const binaryExpression = createBinaryExpression(
                { operation: operator, operand: right },
                {
                  key: (referenceType === 'prop' ? 'props?.' : '') + nameToAppend,
                  type: binaryExpressionType,
                }
              )

              const conditionalExpression = types.conditionalExpression(
                binaryExpression,
                types.stringLiteral(content.referenceId),
                types.stringLiteral('')
              )

              dynamicVariantsToAppend.add(conditionalExpression)
            } else {
              classNamesToAppend.add(content.referenceId)
            }
            return
          }

          default: {
            throw new PluginStyledJSX(
              `Un-supported style reference ${JSON.stringify(styleRef.content, null, 2)}`
            )
          }
        }
      })

      // Handle {{ xxx }} template expressions in class names by converting to dynamic values
      let joinedClasses = Array.from(classNamesToAppend).join(' ')
      const dynamicVals: Array<
        types.Identifier | types.MemberExpression | types.ConditionalExpression
      > = Array.from(dynamicVariantsToAppend)

      const templateClassMatches = joinedClasses.match(/\{\{\s*(.+?)\s*\}\}/g)
      if (templateClassMatches) {
        for (const match of templateClassMatches) {
          const expr = match.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '')
          dynamicVals.push(
            ASTUtils.parseJSExpressionAsAST(expr) as types.Identifier | types.MemberExpression
          )
        }
        joinedClasses = joinedClasses
          .replace(/\{\{\s*(.+?)\s*\}\}/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      }

      ASTUtils.addClassStringOnJSXTag(
        root as types.JSXElement,
        joinedClasses,
        'className',
        dynamicVals
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

    // Convert {{ state.xxx }} template expressions to ${xxx} styled-jsx interpolations
    // Handles both well-formed {{ state.xxx }} and malformed/unclosed {{ state.xxx patterns
    const convertStateTemplates = (css: string): string => {
      return css.replace(
        /\{\{\s*(.*?state\..+?)(\s*\}\}|(?=["`;])|\s*$)/gm,
        (_match, expr, closing) => {
          let cleanExpr = expr.trim()
          // Replace all state.xxx references with just xxx
          cleanExpr = cleanExpr.replace(/state\.(\w+)/g, '$1')
          // Remove trailing semicolons or whitespace
          cleanExpr = cleanExpr.replace(/[;\s]+$/, '')
          const isClosed = closing && closing.includes('}}')
          return '${' + cleanExpr + '}' + (isClosed ? '' : 'px)')
        }
      )
    }
    const cssString = convertStateTemplates(classMap.join('\n'))

    const styleJSXAST = generateStyledJSXTag(cssString)
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
