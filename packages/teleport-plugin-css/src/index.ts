import {
  StringUtils,
  UIDLUtils,
  StyleUtils,
  StyleBuilders,
  HASTUtils,
  ASTUtils,
} from '@teleporthq/teleport-shared'

import {
  ComponentPluginFactory,
  ComponentPlugin,
  UIDLDynamicReference,
  UIDLStyleDefinitions,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'

interface CSSPluginConfig {
  chunkName: string
  templateChunkName: string
  componentDecoratorChunkName: string
  inlineStyleAttributeKey: string
  classAttributeName: string
  templateStyle: 'html' | 'jsx'
  declareDependency: 'import' | 'decorator' | 'none'
}

export const createCSSPlugin: ComponentPluginFactory<CSSPluginConfig> = (config) => {
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

    UIDLUtils.traverseElements(node, (element) => {
      const { style, key } = element

      if (!style) {
        return
      }

      const { staticStyles, dynamicStyles } = UIDLUtils.splitDynamicAndStaticStyles(style)
      const root = templateLookup[key]

      if (Object.keys(staticStyles).length > 0) {
        const className = StringUtils.camelCaseToDashCase(key)
        jssStylesArray.push(
          StyleBuilders.createCSSClass(className, StyleUtils.getContentOfStyleObject(staticStyles))
        )

        if (templateStyle === 'html') {
          HASTUtils.addClassToNode(root, className)
        } else {
          ASTUtils.addClassStringOnJSXTag(root, className, classAttributeName)
        }
      }

      if (Object.keys(dynamicStyles).length > 0) {
        const rootStyles = UIDLUtils.cleanupNestedStyles(dynamicStyles)

        // If dynamic styles are on nested-styles they are unfortunately lost, since inline style does not support that
        if (Object.keys(rootStyles).length > 0) {
          if (templateStyle === 'html') {
            // simple string expression
            const inlineStyles = createDynamicInlineStyle(rootStyles)
            HASTUtils.addAttributeToNode(root, inlineStyleAttributeKey, `{${inlineStyles}}`)
          } else {
            // jsx object expression
            const inlineStyles = UIDLUtils.transformDynamicStyles(rootStyles, (styleValue) =>
              StyleBuilders.createDynamicStyleExpression(styleValue, propsPrefix)
            )
            ASTUtils.addAttributeToJSXTag(root, inlineStyleAttributeKey, inlineStyles)
          }
        }
      }
    })

    if (jssStylesArray.length > 0) {
      chunks.push({
        type: ChunkType.STRING,
        name: chunkName,
        fileType: FileType.CSS,
        content: jssStylesArray.join('\n'),
        linkAfter: [],
      })

      /**
       * Setup an import statement for the styles
       * The name of the file is either in the meta of the component generator
       * or we fallback to the name of the component
       */
      const cssFileName = UIDLUtils.getStyleFileName(uidl)

      if (declareDependency === 'decorator' && componentDecoratorChunk) {
        const decoratorAST = componentDecoratorChunk.content
        const decoratorParam = decoratorAST.expression.arguments[0]
        ASTUtils.addPropertyToASTObject(decoratorParam, 'styleUrls', [
          `${cssFileName}.${FileType.CSS}`,
        ])
      }

      if (declareDependency === 'import') {
        dependencies.styles = {
          // styles will not be used in this case as we have importJustPath flag set
          type: 'local',
          path: `./${cssFileName}.${FileType.CSS}`,
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

export default createCSSPlugin()

const createDynamicInlineStyle = (styles: UIDLStyleDefinitions) => {
  return Object.keys(styles)
    .map((styleKey) => {
      return `${styleKey}: ${(styles[styleKey] as UIDLDynamicReference).content.id}`
    })
    .join(', ')
}
