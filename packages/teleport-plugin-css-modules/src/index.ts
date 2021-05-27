/*
  teleport-plugin-css-modules

  Plugin is responsible for generating styles from
  - Styles defined on individual nodes.
  - Styles defined in the project's global stylesheet.
  - Styles present in the component style sheeet.

  All static values and Dynamic values such as design-tokens are resolved.

  Limitations

  Any dynamic values specified in Media Queries, Component Stylesheet
  ProjectStyle sheet are lost. Since, css-modules can have dynamic values only in inline.
  */

import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { StyleBuilders, ASTUtils } from '@teleporthq/teleport-plugin-common'
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
import { generateStyledFromStyleContent } from './utils'

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
  globalStyleSheetPrefix: 'projectStyles',
}

export const createCSSModulesPlugin: ComponentPluginFactory<CSSModulesConfig> = (config = {}) => {
  const {
    componentChunkName,
    styleObjectImportName,
    styleChunkName,
    camelCaseClassNames,
    moduleExtension,
    classAttributeName,
    globalStyleSheetPrefix,
  } = {
    ...defaultConfigProps,
    ...config,
  }

  const cssModulesPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure
    const { node, styleSetDefinitions: componentStyleSheet = {} } = uidl
    const { projectStyleSet, designLanguage: { tokens = {} } = {}, isRootComponent } = options || {}
    const {
      styleSetDefinitions: globalStyleSheet = {},
      fileName: projectStyleSheetName,
      path,
      importFile = false,
    } = projectStyleSet || {}

    if (isRootComponent) {
      if (Object.keys(tokens).length > 0 || Object.keys(globalStyleSheet).length > 0) {
        const fileName = moduleExtension ? `${projectStyleSheetName}.module` : projectStyleSheetName
        dependencies[globalStyleSheetPrefix] = {
          type: 'local',
          path: `${path}/${fileName}.${FileType.CSS}`,
          meta: {
            importJustPath: true,
          },
        }
      }

      return structure
    }

    const componentChunk = chunks.filter((chunk) => chunk.name === componentChunkName)[0]
    if (!componentChunk) {
      throw new Error(
        `JSX based component chunk with name ${componentChunkName} was required and not found.`
      )
    }

    const cssClasses: string[] = []
    let isProjectStyleReferred: boolean = false
    const mediaStylesMap: Record<string, Record<string, unknown>> = {}
    const astNodesLookup = componentChunk.meta.nodesLookup || {}
    const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop as string

    /* Generating component scoped styles */
    if (Object.keys(componentStyleSheet).length > 0) {
      Object.keys(componentStyleSheet).forEach((compStyleId) => {
        const compStyle = componentStyleSheet[compStyleId]
        const compScopedClassName = camelCaseClassNames
          ? StringUtils.dashCaseToCamelCase(compStyleId)
          : StringUtils.camelCaseToDashCase(compStyleId)
        cssClasses.push(
          StyleBuilders.createCSSClass(
            compScopedClassName,
            generateStyledFromStyleContent(compStyle.content)
          )
        )
      })
    }

    UIDLUtils.traverseElements(node, (element) => {
      let appendClassName: boolean = false
      const classNamesToAppend: string[] = []
      const { style, key, referencedStyles } = element
      const jsxTag = astNodesLookup[key] as types.JSXElement
      const propReferencingClasses: types.MemberExpression[] = []

      if (!jsxTag) {
        return
      }

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

      /* Generating styles from UIDLElementNode to component style sheet */
      if (Object.keys(style || {}).length > 0) {
        const { staticStyles, dynamicStyles, tokenStyles } =
          UIDLUtils.splitDynamicAndStaticStyles(style)

        if (Object.keys(staticStyles).length > 0 || Object.keys(tokenStyles).length > 0) {
          cssClasses.push(
            StyleBuilders.createCSSClass(className, generateStyledFromStyleContent(style))
          )
          appendClassName = true
        }

        if (Object.keys(dynamicStyles).length) {
          const inlineStyles = UIDLUtils.transformDynamicStyles(dynamicStyles, (styleValue) =>
            StyleBuilders.createDynamicStyleExpression(styleValue, propsPrefix)
          )

          /* If dynamic styles are on nested-styles they are unfortunately lost, 
            since inline style does not support that */
          if (Object.keys(inlineStyles).length > 0) {
            ASTUtils.addAttributeToJSXTag(jsxTag, 'style', inlineStyles)
          }
        }
      }

      /* Any media-styles, component-scoped styles, global style sheet styles are handled here */
      if (Object.keys(referencedStyles || {}).length > 0) {
        Object.values(referencedStyles).forEach((styleRef: UIDLElementNodeReferenceStyles) => {
          switch (styleRef.content.mapType) {
            case 'inlined': {
              /* Dynamic values for media-queries are not supported */
              const collectedStyles = generateStyledFromStyleContent(styleRef.content.styles)

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
                cssClasses.push(
                  StyleBuilders.createCSSClassWithSelector(
                    className,
                    `&:${condition.content}`,
                    collectedStyles
                  )
                )
              }

              appendClassName = true
              return
            }

            case 'component-referenced': {
              const classContent = styleRef.content.content
              if (classContent.type === 'static') {
                classNamesToAppend.push(`'${classContent.content}'`)
                appendClassName = true
                return
              }

              if (
                classContent.type === 'dynamic' &&
                classContent.content.referenceType === 'prop'
              ) {
                /*
                  To maintain uniformity, all the classNames are generated using the same principle.
                  Either camelCase or dashCase completly. So, here irrespective of the default value that
                  use is setting. It is safe to change the default value depending on the naming convention
                  that we follow.
                  
                  Since, node is referring to the prop in a `className` so ideally it shouldn't be used anywhere.
                  // TODO
                  Add check in validator to see, if any prop that is referring on node with `className` is of type string
                */
                propReferencingClasses.push(
                  types.memberExpression(
                    types.identifier('styles'),
                    types.memberExpression(
                      types.identifier(propsPrefix),
                      types.identifier(classContent.content.id)
                    ),
                    true
                  )
                )
              }

              return
            }

            case 'project-referenced': {
              const { content } = styleRef
              if (content.referenceId && !content?.conditions) {
                isProjectStyleReferred = true
                const referedStyle = globalStyleSheet[content.referenceId]
                if (!referedStyle) {
                  throw new Error(
                    `Style that is being used for reference is missing - ${content.referenceId}`
                  )
                }
                const globalClassName = camelCaseClassNames
                  ? StringUtils.dashCaseToCamelCase(content.referenceId)
                  : StringUtils.camelCaseToDashCase(content.referenceId)

                classNamesToAppend.push(`${globalStyleSheetPrefix}.['${globalClassName}']`)
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
          jsxTag,
          classAttributeName,
          classNamesToAppend,
          propReferencingClasses
        )
      } else if (classNamesToAppend.length === 1) {
        ASTUtils.addDynamicAttributeToJSXTag(jsxTag, classAttributeName, classNamesToAppend[0])
      }
    })

    if (Object.keys(mediaStylesMap).length > 0) {
      cssClasses.push(...StyleBuilders.generateMediaStyle(mediaStylesMap))
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

    /* Order of imports play a important role on initial load sequence
    So, project styles should always be loaded before component styles */
    if (isProjectStyleReferred && importFile) {
      const fileName = moduleExtension ? `${projectStyleSheetName}.module` : projectStyleSheetName
      dependencies[globalStyleSheetPrefix] = {
        type: 'local',
        path: `${path}/${fileName}.${FileType.CSS}`,
      }
    }

    if (cssClasses.length > 0) {
      dependencies[styleObjectImportName] = {
        type: 'local',
        path: `./${cssFileName}.${FileType.CSS}`,
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
