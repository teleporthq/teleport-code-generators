import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { StyleUtils, StyleBuilders, HASTUtils, ASTUtils } from '@teleporthq/teleport-plugin-common'
import * as types from '@babel/types'
import {
  UIDLelementNodeReferenceStyles,
  ComponentPluginFactory,
  ComponentPlugin,
  UIDLDynamicReference,
  UIDLStyleDefinitions,
  ChunkType,
  FileType,
  HastNode,
} from '@teleporthq/teleport-types'

interface CSSPluginConfig {
  chunkName: string
  templateChunkName: string
  componentDecoratorChunkName: string
  inlineStyleAttributeKey: string // style vs :style vs ...
  classAttributeName: string // class vs className
  forceScoping: boolean // class names get the component name prefix
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
    forceScoping = false,
  } = config || {}

  const cssPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure
    const { node } = uidl

    const templateChunk = chunks.find((chunk) => chunk.name === templateChunkName)
    const componentDecoratorChunk = chunks.find(
      (chunk) => chunk.name === componentDecoratorChunkName
    )

    const templateLookup = templateChunk.meta.nodesLookup as Record<
      string,
      HastNode | types.JSXElement
    >

    // Only JSX based chunks have dynamicRefPrefix (eg: this.props. or props.)
    // @ts-ignore
    const propsPrefix: string = templateChunk.meta.dynamicRefPrefix
      ? (templateChunk.meta.dynamicRefPrefix as Record<string, unknown>).prop
      : ''

    const jssStylesArray: string[] = []
    UIDLUtils.traverseElements(node, (element) => {
      let appendClassName: boolean = false
      const { style, key, referencedStyles } = element

      const elementClassName = StringUtils.camelCaseToDashCase(key)
      const componentFileName = UIDLUtils.getComponentFileName(uidl) // Filename used to enforce dash case naming
      const className = forceScoping // when the framework doesn't provide automating scoping for classNames
        ? `${componentFileName}-${elementClassName}`
        : elementClassName

      if (!style && !referencedStyles) {
        return
      }

      if (referencedStyles && Object.keys(referencedStyles).length > 0) {
        Object.values(referencedStyles).forEach((styleRef: UIDLelementNodeReferenceStyles) => {
          switch (styleRef.content.mapType) {
            case 'inlined': {
              const condition = styleRef.content.conditions[0]
              if (
                !condition ||
                !styleRef.content.styles ||
                Object.keys(styleRef.content.styles).length === 0
              ) {
                return
              }
              if (condition.conditionType === 'screen-size') {
                jssStylesArray.push(
                  StyleBuilders.createCSSClassWithMediaQuery(
                    className,
                    `max-width: ${condition.maxWidth}px`,
                    // @ts-ignore
                    StyleUtils.getContentOfStyleObject(styleRef.content.styles)
                  )
                )
              }

              if (condition.conditionType === 'element-state') {
                jssStylesArray.push(
                  StyleBuilders.createCSSClassWithSelector(
                    className,
                    `&:${condition.content}`,
                    // @ts-ignore
                    StyleUtils.getContentOfStyleObject(styleRef.content.styles)
                  )
                )
              }

              appendClassName = true
              return
            }
            case 'project-referenced': {
              return
            }
            default: {
              throw new Error(
                `We support only project-referenced or inlined, received ${styleRef.content}`
              )
            }
          }
        })
      }

      const { staticStyles, dynamicStyles } = UIDLUtils.splitDynamicAndStaticStyles(style)
      const root = templateLookup[key]

      if (Object.keys(staticStyles).length > 0) {
        jssStylesArray.push(
          // @ts-ignore
          StyleBuilders.createCSSClass(className, StyleUtils.getContentOfStyleObject(staticStyles))
        )
        appendClassName = true
      }

      if (appendClassName) {
        if (templateStyle === 'html') {
          HASTUtils.addClassToNode(root as HastNode, className)
        } else {
          ASTUtils.addClassStringOnJSXTag(root as types.JSXElement, className, classAttributeName)
        }
      }

      if (Object.keys(dynamicStyles).length > 0) {
        const rootStyles = UIDLUtils.cleanupNestedStyles(dynamicStyles)

        // If dynamic styles are on nested-styles they are unfortunately lost, since inline style does not support that
        if (Object.keys(rootStyles).length > 0) {
          if (templateStyle === 'html') {
            // simple string expression
            const inlineStyles = createDynamicInlineStyle(rootStyles)
            HASTUtils.addAttributeToNode(
              root as HastNode,
              inlineStyleAttributeKey,
              `{${inlineStyles}}`
            )
          } else {
            // jsx object expression
            const inlineStyles = UIDLUtils.transformDynamicStyles(rootStyles, (styleValue) =>
              StyleBuilders.createDynamicStyleExpression(styleValue, propsPrefix)
            )
            ASTUtils.addAttributeToJSXTag(
              root as types.JSXElement,
              inlineStyleAttributeKey,
              inlineStyles
            )
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
        // @ts-ignore
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
