import { camelCaseToDashCase } from '@teleporthq/teleport-shared/dist/cjs/utils/string-utils'
import {
  splitDynamicAndStaticStyles,
  cleanupNestedStyles,
  traverseElements,
  transformDynamicStyles,
  getStyleFileName,
} from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import {
  createCSSClass,
  createDynamicStyleExpression,
} from '@teleporthq/teleport-shared/dist/cjs/builders/css-builders'

import { getContentOfStyleObject } from '@teleporthq/teleport-shared/dist/cjs/utils/jss-utils'
import {
  addClassToNode,
  addAttributeToNode,
} from '@teleporthq/teleport-shared/dist/cjs/utils/html-utils'
import {
  addClassStringOnJSXTag,
  addAttributeToJSXTag,
} from '@teleporthq/teleport-shared/dist/cjs/utils/ast-jsx-utils'
import { addPropertyToASTObject } from '@teleporthq/teleport-shared/dist/cjs/utils/ast-js-utils'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  UIDLDynamicReference,
  UIDLStyleDefinitions,
} from '@teleporthq/teleport-types'
import { FILE_TYPE, CHUNK_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

interface CSSPluginConfig {
  chunkName: string
  templateChunkName: string
  componentDecoratorChunkName: string
  inlineStyleAttributeKey: string
  classAttributeName: string
  templateStyle: 'html' | 'jsx'
  declareDependency: 'import' | 'decorator' | 'none'
}

export const createPlugin: ComponentPluginFactory<CSSPluginConfig> = (config) => {
  const {
    chunkName = 'style-chunk',
    templateChunkName = 'template-chunk',
    componentDecoratorChunkName = 'component-decorator',
    inlineStyleAttributeKey = 'style',
    classAttributeName = 'class',
    templateStyle = 'html',
    declareDependency = 'none',
  } = config || {}

  const cssPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure

    const { node } = uidl

    const templateChunk = chunks.find((chunk) => chunk.name === templateChunkName)
    const componentDecoratorChunk = chunks.find(
      (chunk) => chunk.name === componentDecoratorChunkName
    )

    const templateLookup = templateChunk.meta.nodesLookup

    // Only JSX based chunks have dynamicRefPrefix (eg: this.props. or props.)
    const propsPrefix: string = templateChunk.meta.dynamicRefPrefix
      ? templateChunk.meta.dynamicRefPrefix.prop
      : ''

    const jssStylesArray: string[] = []

    traverseElements(node, (element) => {
      const { style, key } = element

      if (!style) {
        return
      }

      const { staticStyles, dynamicStyles } = splitDynamicAndStaticStyles(style)
      const root = templateLookup[key]

      if (Object.keys(staticStyles).length > 0) {
        const className = camelCaseToDashCase(key)
        jssStylesArray.push(createCSSClass(className, getContentOfStyleObject(staticStyles)))

        if (templateStyle === 'html') {
          addClassToNode(root, className)
        } else {
          addClassStringOnJSXTag(root, className, classAttributeName)
        }
      }

      if (Object.keys(dynamicStyles).length > 0) {
        const rootStyles = cleanupNestedStyles(dynamicStyles)

        // If dynamic styles are on nested-styles they are unfortunately lost, since inline style does not support that
        if (Object.keys(rootStyles).length > 0) {
          if (templateStyle === 'html') {
            // simple string expression
            const inlineStyles = createDynamicInlineStyle(rootStyles)
            addAttributeToNode(root, inlineStyleAttributeKey, `{${inlineStyles}}`)
          } else {
            // jsx object expression
            const inlineStyles = transformDynamicStyles(rootStyles, (styleValue) =>
              createDynamicStyleExpression(styleValue, propsPrefix)
            )
            addAttributeToJSXTag(root, inlineStyleAttributeKey, inlineStyles)
          }
        }
      }
    })

    if (jssStylesArray.length > 0) {
      chunks.push({
        type: CHUNK_TYPE.STRING,
        name: chunkName,
        fileType: FILE_TYPE.CSS,
        content: jssStylesArray.join('\n'),
        linkAfter: [],
      })

      /**
       * Setup an import statement for the styles
       * The name of the file is either in the meta of the component generator
       * or we fallback to the name of the component
       */
      const cssFileName = getStyleFileName(uidl)

      if (declareDependency === 'decorator' && componentDecoratorChunk) {
        const decoratorAST = componentDecoratorChunk.content
        const decoratorParam = decoratorAST.expression.arguments[0]
        addPropertyToASTObject(decoratorParam, 'styleUrls', [`${cssFileName}.${FILE_TYPE.CSS}`])
      }

      if (declareDependency === 'import') {
        dependencies.styles = {
          // styles will not be used in this case as we have importJustPath flag set
          type: 'local',
          path: `./${cssFileName}.${FILE_TYPE.CSS}`,
          meta: {
            importJustPath: true,
          },
        }
      }
    }

    return structure
  }

  return cssPlugin
}

export default createPlugin()

const createDynamicInlineStyle = (styles: UIDLStyleDefinitions) => {
  return Object.keys(styles)
    .map((styleKey) => {
      return `${styleKey}: ${(styles[styleKey] as UIDLDynamicReference).content.id}`
    })
    .join(', ')
}
