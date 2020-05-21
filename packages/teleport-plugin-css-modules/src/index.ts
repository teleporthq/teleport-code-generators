import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { StyleUtils, StyleBuilders, ASTUtils } from '@teleporthq/teleport-plugin-common'
import * as types from '@babel/types'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  FileType,
  ChunkType,
  UIDLelementNodeReferenceStyles,
} from '@teleporthq/teleport-types'

interface CSSModulesConfig {
  componentChunkName?: string
  styleObjectImportName?: string
  styleChunkName?: string
  camelCaseClassNames?: boolean
  moduleExtension?: boolean
  classAttributeName?: string
}

const defaultConfigProps = {
  componentChunkName: 'jsx-component',
  styleChunkName: 'css-modules',
  styleObjectImportName: 'styles',
  camelCaseClassNames: false,
  moduleExtension: false,
  classAttributeName: 'className',
}

export const createCSSModulesPlugin: ComponentPluginFactory<CSSModulesConfig> = (config = {}) => {
  const {
    componentChunkName,
    styleObjectImportName,
    styleChunkName,
    camelCaseClassNames,
    moduleExtension,
    classAttributeName,
  } = {
    ...defaultConfigProps,
    ...config,
  }

  const cssModulesPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure

    const componentChunk = chunks.filter((chunk) => chunk.name === componentChunkName)[0]

    if (!componentChunk) {
      throw new Error(
        `JSX based component chunk with name ${componentChunkName} was required and not found.`
      )
    }

    const cssClasses: string[] = []
    let appendClassName: boolean = false
    const astNodesLookup = (componentChunk.meta.nodesLookup || {}) as Record<string, unknown>
    // @ts-ignore
    const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop

    UIDLUtils.traverseElements(uidl.node, (element) => {
      const { style, key, referencedStyles } = element

      if (!style && !referencedStyles) {
        return
      }

      const className = StringUtils.camelCaseToDashCase(key)
      const jsFriendlyClassName = StringUtils.dashCaseToCamelCase(className)

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
                cssClasses.push(
                  StyleBuilders.createCSSClassWithMediaQuery(
                    className,
                    `max-width: ${condition.maxWidth}px`,
                    // @ts-ignore
                    StyleUtils.getContentOfStyleObject(styleRef.content.styles)
                  )
                )
              }

              if (condition.conditionType === 'element-state') {
                cssClasses.push(
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

      if (style) {
        const root = astNodesLookup[key]
        const { staticStyles, dynamicStyles } = UIDLUtils.splitDynamicAndStaticStyles(style)

        if (Object.keys(staticStyles).length > 0) {
          cssClasses.push(
            StyleBuilders.createCSSClass(
              className,
              // @ts-ignore
              StyleUtils.getContentOfStyleObject(staticStyles)
            )
          )
          appendClassName = true
        }

        if (appendClassName) {
          // When the className is equal to the jsFriendlyClassName, it can be safely addressed with `styles.<className>`
          const classNameIsJSFriendly = className === jsFriendlyClassName
          const classReferenceIdentifier =
            camelCaseClassNames || classNameIsJSFriendly
              ? `styles.${jsFriendlyClassName}`
              : `styles['${className}']`

          ASTUtils.addDynamicAttributeToJSXTag(
            root as types.JSXElement,
            classAttributeName,
            classReferenceIdentifier
          )
        }

        if (Object.keys(dynamicStyles).length) {
          const rootStyles = UIDLUtils.cleanupNestedStyles(dynamicStyles)

          const inlineStyles = UIDLUtils.transformDynamicStyles(rootStyles, (styleValue) =>
            StyleBuilders.createDynamicStyleExpression(styleValue, propsPrefix)
          )

          // If dynamic styles are on nested-styles they are unfortunately lost, since inline style does not support that
          if (Object.keys(inlineStyles).length > 0) {
            ASTUtils.addAttributeToJSXTag(root as types.JSXElement, 'style', inlineStyles)
          }
        }
      }
    })

    /**
     * If no classes were added, we don't need to import anything or to alter any code
     */
    if (!cssClasses.length) {
      return structure
    }

    /**
     * Setup an import statement for the styles
     * The name of the file is either in the meta of the component generator
     * or we fallback to the name of the component
     */
    let cssFileName = UIDLUtils.getStyleFileName(uidl)

    /**
     * In case the moduleExtension flag is passed, the file name should be in the form [fileName].module.css
     */
    if (moduleExtension) {
      cssFileName = `${cssFileName}.module`
      uidl.outputOptions = uidl.outputOptions || {}
      uidl.outputOptions.styleFileName = cssFileName
    }

    dependencies[styleObjectImportName] = {
      type: 'local',
      path: `./${cssFileName}.${FileType.CSS}`,
    }

    structure.chunks.push({
      name: styleChunkName,
      type: ChunkType.STRING,
      fileType: FileType.CSS,
      content: cssClasses.join('\n'),
      linkAfter: [],
    })

    return structure
  }

  return cssModulesPlugin
}

export default createCSSModulesPlugin()
