import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { ASTUtils, StyleBuilders, ASTBuilders } from '@teleporthq/teleport-plugin-common'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  UIDLAttributeValue,
} from '@teleporthq/teleport-types'
import { generateStyledJSXTag } from './utils'
import * as types from '@babel/types'

interface StyledJSXConfig {
  componentChunkName: string
}

export const createReactStyledJSXPlugin: ComponentPluginFactory<StyledJSXConfig> = (config) => {
  const { componentChunkName = 'jsx-component' } = config || {}

  const reactStyledJSXPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, options } = structure
    const { projectStyleSet } = options
    const { node } = uidl

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup as Record<string, types.JSXElement>
    // @ts-ignore
    const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop
    const mediaStylesMap: Record<string, Record<string, unknown>> = {}
    const styleJSXString: string[] = []

    const transformStyle = (style: Record<string, UIDLAttributeValue>) =>
      UIDLUtils.transformDynamicStyles(style, (styleValue) => {
        if (styleValue.content.referenceType === 'prop') {
          return `\$\{${propsPrefix}.${styleValue.content.id}\}`
        }

        throw new Error(
          `Error running transformDynamicStyles in reactStyledJSXChunkPlugin. Unsupported styleValue.content.referenceType value ${styleValue.content.referenceType}`
        )
      })

    UIDLUtils.traverseElements(node, (element) => {
      let appendClassName: boolean = false
      const classNamesToAppend: string[] = []
      const { style, key, referencedStyles } = element

      if (!style && !referencedStyles) {
        return
      }

      const root = jsxNodesLookup[key]
      const className = StringUtils.camelCaseToDashCase(key)

      if (style && Object.keys(style).length > 0) {
        // Generating the string templates for the dynamic styles
        const styleRules = transformStyle(style)

        styleJSXString.push(StyleBuilders.createCSSClass(className, styleRules))
        appendClassName = true
      }

      if (referencedStyles && Object.keys(referencedStyles).length > 0) {
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
                styleJSXString.push(
                  StyleBuilders.createCSSClassWithSelector(
                    className,
                    `&:${conditions[0].content}`,
                    // @ts-ignore
                    transformStyle(styleRef.content.styles)
                  )
                )
              }

              appendClassName = true

              return
            }
            case 'project-referenced': {
              if (!projectStyleSet) {
                throw new Error(
                  `Project Style Sheet is missing, but the node is referring to it ${element}`
                )
              }

              const { content } = styleRef
              if (content.referenceId && !content?.conditions) {
                const referedStyle = projectStyleSet.styleSetDefinitions[content.referenceId]
                if (!referencedStyles) {
                  throw new Error(
                    `Style that is being used for reference is missing - ${content.referenceId}`
                  )
                }
                classNamesToAppend.push(referedStyle.name)
              }
              return
            }
            default: {
              throw new Error('We support only project-referneced and inlined for now.')
            }
          }
        })
      }

      if (appendClassName) {
        classNamesToAppend.push(className)
      }

      if (classNamesToAppend.length > 1) {
        ASTUtils.addClassStringOnJSXTag(root, classNamesToAppend.join(' '))
      } else if (classNamesToAppend.length === 1) {
        ASTUtils.addClassStringOnJSXTag(root, className)
      }
    })

    if (Object.keys(mediaStylesMap).length > 0) {
      Object.keys(mediaStylesMap)
        .sort((a: string, b: string) => Number(a) - Number(b))
        .reverse()
        .forEach((mediaOffset: string) => {
          styleJSXString.push(
            StyleBuilders.createCSSClassWithMediaQuery(
              `max-width: ${mediaOffset}px`,
              // @ts-ignore
              mediaStylesMap[mediaOffset]
            )
          )
        })
    }

    if (!styleJSXString || !styleJSXString.length) {
      return structure
    }

    const jsxASTNodeReference = generateStyledJSXTag(styleJSXString.join('\n'))
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
