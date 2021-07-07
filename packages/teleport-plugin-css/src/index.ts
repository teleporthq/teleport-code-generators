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
  PluginCSS,
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
  dynamicVariantPrefix?: string
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
    dynamicVariantPrefix,
  } = config || {}

  const cssPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure
    const { node, styleSetDefinitions: componentStyleSet = {} } = uidl
    const { projectStyleSet, designLanguage: { tokens = {} } = {}, isRootComponent } = options || {}
    const {
      styleSetDefinitions = {},
      fileName: projectStyleSheetName,
      path,
    } = projectStyleSet || {}

    if (isRootComponent) {
      if (Object.keys(tokens).length > 0 || Object.keys(styleSetDefinitions).length > 0) {
        dependencies[projectStyleSheetName] = {
          type: 'local',
          path: `${path}/${projectStyleSheetName}.${FileType.CSS}`,
          meta: {
            importJustPath: true,
          },
        }
      }

      return structure
    }

    const templateChunk = chunks.find((chunk) => chunk.name === templateChunkName)
    const componentDecoratorChunk = chunks.find(
      (chunk) => chunk.name === componentDecoratorChunkName
    )

    const templateLookup = templateChunk.meta.nodesLookup as Record<
      string,
      HastNode | types.JSXElement
    >

    const propsPrefix: string = templateChunk.meta.dynamicRefPrefix
      ? ((templateChunk.meta.dynamicRefPrefix as Record<string, unknown>).prop as string)
      : ('' as string)

    const cssMap: string[] = []
    const mediaStylesMap: Record<string, Record<string, unknown>> = {}

    UIDLUtils.traverseElements(node, (element) => {
      const classNamesToAppend: Set<string> = new Set()
      const dynamicVariantsToAppend: Set<string> = new Set()
      const { style = {}, key, referencedStyles = {} } = element

      if (!style && !referencedStyles) {
        return
      }
      const root = templateLookup[key]

      const elementClassName = StringUtils.camelCaseToDashCase(key)
      const componentFileName = UIDLUtils.getComponentFileName(uidl) // Filename used to enforce dash case naming
      const className = forceScoping // when the framework doesn't provide automating scoping for classNames
        ? `${componentFileName}-${elementClassName}`
        : elementClassName

      const { staticStyles, dynamicStyles, tokenStyles } =
        UIDLUtils.splitDynamicAndStaticStyles(style)

      if (Object.keys(staticStyles).length > 0 || Object.keys(tokenStyles).length > 0) {
        const collectedStyles = {
          ...StyleUtils.getContentOfStyleObject(staticStyles),
          ...StyleUtils.getCSSVariablesContentFromTokenStyles(tokenStyles),
        } as Record<string, string | number>

        cssMap.push(StyleBuilders.createCSSClass(className, collectedStyles))
        classNamesToAppend.add(className)
      }

      if (Object.keys(dynamicStyles).length > 0) {
        /* If dynamic styles are on nested-styles they are unfortunately lost, 
          since inline style does not support that */
        if (templateStyle === 'html') {
          const inlineStyles = createDynamicInlineStyle(dynamicStyles)
          HASTUtils.addAttributeToNode(
            root as HastNode,
            inlineStyleAttributeKey,
            `{${inlineStyles}}`
          )
        } else {
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

      Object.values(referencedStyles).forEach((styleRef: UIDLElementNodeReferenceStyles) => {
        switch (styleRef.content.mapType) {
          case 'inlined': {
            const filtredStyles = UIDLUtils.splitDynamicAndStaticStyles(styleRef.content.styles)
            const collectedStyles = {
              ...StyleUtils.getContentOfStyleObject(filtredStyles.staticStyles),
              ...StyleUtils.getCSSVariablesContentFromTokenStyles(filtredStyles.tokenStyles),
            } as Record<string, string | number>

            const condition = styleRef.content.conditions[0]
            const { conditionType } = condition
            if (conditionType === 'screen-size') {
              const { maxWidth } = condition as UIDLStyleMediaQueryScreenSizeCondition
              mediaStylesMap[maxWidth] = {
                ...mediaStylesMap[maxWidth],
                [className]: collectedStyles,
              }
            }

            if (condition.conditionType === 'element-state') {
              cssMap.push(
                StyleBuilders.createCSSClassWithSelector(
                  className,
                  `&:${condition.content}`,
                  collectedStyles
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
              if (!dynamicVariantPrefix && templateStyle === 'html') {
                throw new PluginCSS(
                  `Node ${
                    element.name || element.key
                  } is using dynamic variant based on prop. But "dynamicVariantPrefix" is not defiend.
                  ${JSON.stringify(styleRef.content.content, null, 2)}`
                )
              }

              dynamicVariantsToAppend.add(styleRef.content.content.content.id)
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
            const { content } = styleRef
            const referedStyle = styleSetDefinitions[content.referenceId]
            if (!referedStyle) {
              throw new PluginCSS(
                `Style used from global stylesheet is missing - ${content.referenceId}`
              )
            }
            classNamesToAppend.add(content.referenceId)
            return
          }

          default: {
            throw new PluginCSS(
              `We support only project-referenced or inlined, received ${JSON.stringify(
                styleRef.content,
                null,
                2
              )}`
            )
          }
        }
      })

      if (templateStyle === 'html') {
        if (classNamesToAppend.size > 0) {
          HASTUtils.addClassToNode(root as HastNode, Array.from(classNamesToAppend).join(' '))
        }

        if (dynamicVariantsToAppend.size > 1) {
          throw new PluginCSS(`Node ${
            node.content?.name || node.content?.key
          } is using multiple dynamic variants using propDefinitions.
          We can have only one dynamic variant at once`)
        }

        if (dynamicVariantPrefix && dynamicVariantsToAppend.size > 0) {
          HASTUtils.addAttributeToNode(
            root as HastNode,
            dynamicVariantPrefix,
            Array.from(dynamicVariantsToAppend).join(' ')
          )
        }
      } else {
        ASTUtils.addClassStringOnJSXTag(
          root as types.JSXElement,
          Array.from(classNamesToAppend).join(' '),
          classAttributeName,
          Array.from(dynamicVariantsToAppend).map((variant) => {
            const dynamicAttrValueIdentifier: types.Identifier = dynamicVariantPrefix
              ? types.identifier(dynamicVariantPrefix)
              : types.identifier(propsPrefix)

            return types.memberExpression(dynamicAttrValueIdentifier, types.identifier(variant))
          })
        )
      }
    })

    if (Object.keys(componentStyleSet).length > 0) {
      StyleBuilders.generateStylesFromStyleSetDefinitions(componentStyleSet, cssMap, mediaStylesMap)
    }

    if (Object.keys(mediaStylesMap).length > 0) {
      cssMap.push(...StyleBuilders.generateMediaStyle(mediaStylesMap))
    }

    if (cssMap.length > 0) {
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
        cssMap.unshift(`:host { \n  display: contents; \n}`)
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

      chunks.push({
        type: ChunkType.STRING,
        name: chunkName,
        fileType: FileType.CSS,
        content: cssMap.join('\n'),
        linkAfter: [],
      })
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
