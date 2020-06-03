import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { StyleUtils, StyleBuilders, ASTUtils } from '@teleporthq/teleport-plugin-common'
import * as types from '@babel/types'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  FileType,
  ChunkType,
  UIDLElementNodeReferenceStyles,
  UIDLStyleMediaQueryScreenSizeCondition,
} from '@teleporthq/teleport-types'
import { createStyleSheetPlugin } from './style-sheet'

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
    const { uidl, chunks, dependencies, options } = structure
    const { projectStyleSet } = options
    const componentChunk = chunks.filter((chunk) => chunk.name === componentChunkName)[0]

    if (!componentChunk) {
      throw new Error(
        `JSX based component chunk with name ${componentChunkName} was required and not found.`
      )
    }

    const cssClasses: string[] = []
    let isProjectStyleReferred: boolean = false
    const mediaStylesMap: Record<string, Record<string, unknown>> = {}
    const projectStylesReferenceOffset = `projectStyles`
    const astNodesLookup = (componentChunk.meta.nodesLookup || {}) as Record<string, unknown>
    // @ts-ignore
    const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop

    UIDLUtils.traverseElements(uidl.node, (element) => {
      let appendClassName: boolean = false
      const classNamesToAppend: string[] = []
      const { style, key, referencedStyles } = element

      if (!style && !referencedStyles) {
        return
      }

      const className = StringUtils.camelCaseToDashCase(key)
      const jsFriendlyClassName = StringUtils.dashCaseToCamelCase(className)

      const classNameIsJSFriendly = className === jsFriendlyClassName
      const classReferenceIdentifier =
        camelCaseClassNames || classNameIsJSFriendly
          ? `styles.${jsFriendlyClassName}`
          : `styles['${className}']`
      const root = astNodesLookup[key]

      if (style) {
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

        if (Object.keys(dynamicStyles).length) {
          const inlineStyles = UIDLUtils.transformDynamicStyles(dynamicStyles, (styleValue) =>
            StyleBuilders.createDynamicStyleExpression(styleValue, propsPrefix)
          )

          // If dynamic styles are on nested-styles they are unfortunately lost, since inline style does not support that
          if (Object.keys(inlineStyles).length > 0) {
            ASTUtils.addAttributeToJSXTag(root as types.JSXElement, 'style', inlineStyles)
          }
        }
      }

      if (referencedStyles && Object.keys(referencedStyles).length > 0) {
        Object.values(referencedStyles).forEach((styleRef: UIDLElementNodeReferenceStyles) => {
          switch (styleRef.content.mapType) {
            case 'inlined': {
              // We can't set dynamic styles for conditions in css-modules, they need be directly applied in the node.
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
                  cssClasses.push(
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
                classNamesToAppend.push(`${projectStylesReferenceOffset}.${referedStyle.name}`)
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
        classNamesToAppend.push(classReferenceIdentifier)
      }

      if (classNamesToAppend?.length > 1) {
        ASTUtils.addMultipleDynamicAttributesToJSXTag(
          root as types.JSXElement,
          classAttributeName,
          classNamesToAppend
        )
      } else if (classNamesToAppend.length === 1) {
        ASTUtils.addDynamicAttributeToJSXTag(
          root as types.JSXElement,
          classAttributeName,
          classNamesToAppend[0]
        )
      }
    })

    if (Object.keys(mediaStylesMap).length > 0) {
      Object.keys(mediaStylesMap)
        .sort((a: string, b: string) => Number(a) - Number(b))
        .reverse()
        .forEach((mediaOffset: string) => {
          cssClasses.push(
            StyleBuilders.createCSSClassWithMediaQuery(
              `max-width: ${mediaOffset}px`,
              // @ts-ignore
              mediaStylesMap[mediaOffset]
            )
          )
        })
    }
    /**
     * If no classes were added, we don't need to import anything or to alter any code
     */
    if (!cssClasses.length && !isProjectStyleReferred) {
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

    if (cssClasses.length > 0) {
      dependencies[styleObjectImportName] = {
        type: 'local',
        path: `./${cssFileName}.${FileType.CSS}`,
      }
    }

    if (isProjectStyleReferred) {
      const fileName = moduleExtension
        ? `${options.projectStyleSet.fileName}.module`
        : options.projectStyleSet.fileName
      dependencies[projectStylesReferenceOffset] = {
        type: 'local',
        path: `${options.projectStyleSet.path}/${fileName}.${FileType.CSS}`,
      }
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

export { createStyleSheetPlugin }

export default createCSSModulesPlugin()
