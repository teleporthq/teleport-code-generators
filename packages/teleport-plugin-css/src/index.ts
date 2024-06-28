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
  staticPropReferences?: boolean
}

const createCSSPlugin: ComponentPluginFactory<CSSPluginConfig> = (config) => {
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
    staticPropReferences = false,
  } = config || {}

  const cssPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure
    const { node, styleSetDefinitions: componentStyleSet = {}, propDefinitions = {} } = uidl
    const { projectStyleSet, designLanguage: { tokens = {} } = {}, isRootComponent } = options || {}
    const {
      styleSetDefinitions = {},
      fileName: projectStyleSheetName,
      path: projectStyleSheetPath,
    } = projectStyleSet || {}

    if (isRootComponent) {
      if (Object.keys(tokens).length > 0 || Object.keys(styleSetDefinitions).length > 0) {
        dependencies[projectStyleSheetName] = {
          type: 'local',
          path: `${projectStyleSheetPath}${projectStyleSheetName}.${FileType.CSS}`,
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
    const mediaStylesMap: Record<
      string,
      Array<{ [x: string]: Record<string, string | number> }>
    > = {}

    UIDLUtils.traverseElements(node, (element) => {
      const classNamesToAppend: Set<string> = new Set()
      const dynamicVariantsToAppend: Set<string> = new Set()
      const {
        style = {},
        key,
        referencedStyles = {},
        dependency,
        attrs = {},
        elementType,
      } = element
      const elementClassName = StringUtils.camelCaseToDashCase(key)

      if (forceScoping && dependency?.type === 'local') {
        StyleBuilders.setPropValueForCompStyle({
          attrs,
          key,
          jsxNodesLookup: templateLookup,
          templateStyle,
          getClassName: (styleName: string) =>
            getClassName(forceScoping, StringUtils.camelCaseToDashCase(elementType), styleName),
        })
      }

      if (
        Object.keys(style).length === 0 &&
        Object.keys(referencedStyles).length === 0 &&
        Object.keys(componentStyleSet).length === 0
      ) {
        return
      }

      const root = templateLookup[key]
      if (!root) {
        throw new PluginCSS(
          `Element \n ${JSON.stringify(
            element,
            null,
            2
          )} \n with key ${key} is missing from the template chunk`
        )
      }

      const className = getClassName(forceScoping, uidl.name, elementClassName)

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
              if (!mediaStylesMap[String(maxWidth)]) {
                mediaStylesMap[String(maxWidth)] = []
              }
              mediaStylesMap[String(maxWidth)].push({ [className]: collectedStyles })
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
              const defaultPropValue =
                propDefinitions[styleRef.content.content.content.id]?.defaultValue

              if (defaultPropValue) {
                /* Changing the default value of the prop.
                  When forceScoping is enabled the classnames change. So, we need to change the default prop too. */
                propDefinitions[styleRef.content.content.content.id].defaultValue = getClassName(
                  forceScoping,
                  uidl.name,
                  String(defaultPropValue)
                )
              }

              if (staticPropReferences) {
                if (!defaultPropValue) {
                  return
                }
                if (staticPropReferences) {
                  classNamesToAppend.add(
                    getClassName(forceScoping, uidl.name, String(defaultPropValue))
                  )
                }
              } else {
                dynamicVariantsToAppend.add(styleRef.content.content.content.id)
              }
            }

            if (
              styleRef.content.content.type === 'dynamic' &&
              styleRef.content.content.content.referenceType === 'comp'
            ) {
              if (!componentStyleSet[styleRef.content.content.content.id]) {
                throw new PluginCSS(
                  `Node ${elementType} is referring to a comp style instance ${styleRef.content.content.content.id} which is missing.`
                )
              }
              classNamesToAppend.add(
                getClassName(forceScoping, uidl.name, String(styleRef.content.content.content.id))
              )
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
              `Un-supported style reference ${JSON.stringify(styleRef.content, null, 2)}`
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
      StyleBuilders.generateStylesFromStyleSetDefinitions(
        componentStyleSet,
        cssMap,
        mediaStylesMap,
        (styleName: string) => getClassName(forceScoping, uidl.name, styleName)
      )
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

export { createStyleSheetPlugin, createCSSPlugin }

export default createCSSPlugin()

const createDynamicInlineStyle = (styles: UIDLStyleDefinitions) => {
  return Object.keys(styles)
    .map((styleKey) => {
      return `${styleKey}: ${(styles[styleKey] as UIDLDynamicReference).content.id}`
    })
    .join(', ')
}

const getClassName = (scoping: boolean, uidlName: string, nodeStyleName: string) => {
  return scoping
    ? StringUtils.camelCaseToDashCase(
        `${uidlName === 'Component' ? 'AppComponent' : uidlName}-${nodeStyleName}`
      )
    : StringUtils.camelCaseToDashCase(nodeStyleName)
}
