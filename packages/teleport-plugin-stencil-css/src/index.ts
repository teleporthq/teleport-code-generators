import { camelCaseToDashCase } from '@teleporthq/teleport-shared/dist/cjs/utils/string-utils'
import { addPropertyToASTObject } from '@teleporthq/teleport-shared/dist/cjs/utils/ast-js-utils'
import {
  splitDynamicAndStaticStyles,
  cleanupNestedStyles,
  traverseElements,
  transformDynamicStyles,
} from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import {
  createCSSClass,
  createDynamicStyleExpression,
} from '@teleporthq/teleport-shared/dist/cjs/builders/css-builders'
import { getContentOfStyleObject } from '@teleporthq/teleport-shared/dist/cjs/utils/jss-utils'
import { addAttributeToJSXTag } from '@teleporthq/teleport-shared/dist/cjs/utils/ast-jsx-utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { FILE_TYPE, CHUNK_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

interface StencilStyleChunkConfig {
  componentChunkName: string
  componentDecoratorChunkName: string
  styleChunkName: string
  styleFileId: string
}

export const createPlugin: ComponentPluginFactory<StencilStyleChunkConfig> = (config) => {
  const {
    componentChunkName = 'jsx-component',
    componentDecoratorChunkName = 'decorator',
    styleChunkName = 'stencil-style',
    styleFileId = FILE_TYPE.CSS,
  } = config || {}

  const stencilComponentStyleChunkPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure

    const { node } = uidl

    const stencilComponent = chunks.find((chunk) => chunk.name === componentChunkName)
    const stencilDecorator = chunks.find((chunk) => chunk.name === componentDecoratorChunkName)
    if (!stencilComponent || !stencilDecorator) {
      throw new Error(
        `JSX based component chunk with name '${componentChunkName}' and decorator with name '${componentDecoratorChunkName}' were required and not found.`
      )
    }

    const jsxNodesLookup = stencilComponent.meta.nodesLookup
    const propsPrefix = stencilComponent.meta.dynamicRefPrefix.prop

    const jssStylesArray = []

    traverseElements(node, (element) => {
      const { style, key } = element

      if (style) {
        const { staticStyles, dynamicStyles } = splitDynamicAndStaticStyles(style)
        const root = jsxNodesLookup[key]

        if (Object.keys(dynamicStyles).length > 0) {
          const rootStyles = cleanupNestedStyles(dynamicStyles)
          const inlineStyles = transformDynamicStyles(rootStyles, (styleValue) =>
            createDynamicStyleExpression(styleValue, propsPrefix)
          )

          // If dynamic styles are on nested-styles they are unfortunately lost, since inline style does not support that
          if (Object.keys(inlineStyles).length > 0) {
            addAttributeToJSXTag(root, 'style', inlineStyles)
          }
        }

        if (Object.keys(staticStyles).length > 0) {
          const className = camelCaseToDashCase(key)
          jssStylesArray.push(createCSSClass(className, getContentOfStyleObject(staticStyles)))

          addAttributeToJSXTag(root, 'class', className)
        }
      }
    })

    if (jssStylesArray.length > 0) {
      const cssFileName = (uidl.meta && uidl.meta.fileName) || camelCaseToDashCase(uidl.name)

      const decoratorAST = stencilDecorator.content
      const decoratorParam = decoratorAST.expression.arguments[0]
      addPropertyToASTObject(decoratorParam, 'styleUrl', `${cssFileName}.css`)

      chunks.push({
        type: CHUNK_TYPE.STRING,
        name: styleChunkName,
        fileId: styleFileId,
        content: jssStylesArray.join('\n'),
        linkAfter: [],
      })
    }

    return structure
  }

  return stencilComponentStyleChunkPlugin
}

export default createPlugin()
