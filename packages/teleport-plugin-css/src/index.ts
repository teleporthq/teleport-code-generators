import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { StyleUtils, StyleBuilders, HASTUtils, ASTUtils } from '@teleporthq/teleport-plugin-common'
import * as types from '@babel/types'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  UIDLDynamicReference,
  UIDLStyleDefinitions,
  ChunkType,
  FileType,
  HastNode,
  UIDLElementNodeReferenceStyles,
  UIDLStyleMediaQueryScreenSizeCondition,
} from '@teleporthq/teleport-types'
import { createStyleSheetPlugin } from './style-sheet'

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
    // @ts-ignore
    classAttributeName = 'class',
    templateStyle = 'html',
    declareDependency = 'none',
    forceScoping = false,
  } = config || {}

  const cssPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure
    const { projectStyleSet } = options

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
    let isProjectStyleReferred: boolean = false
    const mediaStylesMap: Record<string, Record<string, unknown>> = {}

    UIDLUtils.traverseElements(node, (element) => {
      let appendClassName: boolean = false
      const classNamesToAppend: string[] = []
      const { style, key, referencedStyles } = element

      if (!style && !referencedStyles) {
        return
      }

      const root = templateLookup[key]

      const elementClassName = StringUtils.camelCaseToDashCase(key)
      const componentFileName = UIDLUtils.getComponentFileName(uidl) // Filename used to enforce dash case naming
      const className = forceScoping // when the framework doesn't provide automating scoping for classNames
        ? `${componentFileName}-${elementClassName}`
        : elementClassName

      if (style) {
        const { staticStyles, dynamicStyles } = UIDLUtils.splitDynamicAndStaticStyles(style)

        if (Object.keys(staticStyles).length > 0) {
          jssStylesArray.push(
            StyleBuilders.createCSSClass(
              className,
              // @ts-ignore
              StyleUtils.getContentOfStyleObject(staticStyles)
            )
          )

          appendClassName = true
        }

        if (Object.keys(dynamicStyles).length > 0) {
          /* If dynamic styles are on nested-styles they are unfortunately lost, 
          since inline style does not support that */

          if (Object.keys(dynamicStyles).length > 0) {
            if (templateStyle === 'html') {
              // simple string expression
              const inlineStyles = createDynamicInlineStyle(dynamicStyles)
              HASTUtils.addAttributeToNode(
                root as HastNode,
                inlineStyleAttributeKey,
                `{${inlineStyles}}`
              )
            } else {
              // jsx object expression
              const inlineStyles = UIDLUtils.transformDynamicStyles(dynamicStyles, (styleValue) =>
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
      }

      if (referencedStyles && Object.keys(referencedStyles).length > 0) {
        Object.values(referencedStyles).forEach((styleRef: UIDLElementNodeReferenceStyles) => {
          switch (styleRef.content.mapType) {
            case 'inlined': {
              /* We can't set dynamic styles for conditions in css, 
              they need be directly applied in the node. */
              const { staticStyles } = UIDLUtils.splitDynamicAndStaticStyles(
                styleRef.content.styles
              )
              if (Object.keys(staticStyles).length > 0) {
                const condition = styleRef.content.conditions[0]
                const { conditionType } = condition
                if (conditionType === 'screen-size') {
                  const { maxWidth } = condition as UIDLStyleMediaQueryScreenSizeCondition
                  mediaStylesMap[maxWidth] = {
                    ...mediaStylesMap[maxWidth],
                    [className]: StyleUtils.getContentOfStyleObject(staticStyles),
                  }
                }

                if (condition.conditionType === 'element-state') {
                  jssStylesArray.push(
                    StyleBuilders.createCSSClassWithSelector(
                      className,
                      `&:${condition.content}`,
                      // @ts-ignore
                      StyleUtils.getContentOfStyleObject(staticStyles)
                    )
                  )
                }

                appendClassName = true
              }
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
                isProjectStyleReferred = true
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
              throw new Error(
                `We support only project-referenced or inlined, received ${styleRef.content}`
              )
            }
          }
        })
      }

      if (appendClassName) {
        classNamesToAppend.push(className)
      }

      if (classNamesToAppend?.length > 0) {
        if (templateStyle === 'html') {
          HASTUtils.addClassToNode(root as HastNode, classNamesToAppend.join(' '))
        } else {
          ASTUtils.addClassStringOnJSXTag(
            root as types.JSXElement,
            classNamesToAppend.join(' '),
            classAttributeName
          )
        }
      }
    })

    if (Object.keys(mediaStylesMap).length > 0) {
      Object.keys(mediaStylesMap)
        .sort((a: string, b: string) => Number(a) - Number(b))
        .reverse()
        .forEach((mediaOffset: string) => {
          jssStylesArray.push(
            StyleBuilders.createCSSClassWithMediaQuery(
              `max-width: ${mediaOffset}px`,
              // @ts-ignore
              mediaStylesMap[mediaOffset]
            )
          )
        })
    }

    if (isProjectStyleReferred && projectStyleSet?.importFile) {
      dependencies[projectStyleSet.fileName] = {
        type: 'local',
        path: `${projectStyleSet.path}/${projectStyleSet.fileName}.${FileType.CSS}`,
        meta: {
          importJustPath: true,
        },
      }
    }

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

export { createStyleSheetPlugin }

export default createCSSPlugin()

const createDynamicInlineStyle = (styles: UIDLStyleDefinitions) => {
  return Object.keys(styles)
    .map((styleKey) => {
      return `${styleKey}: ${(styles[styleKey] as UIDLDynamicReference).content.id}`
    })
    .join(', ')
}
