/*
  teleport-plugin-css-modules

  Plugin is responsible for generating styles from
  - Styles defined on individual nodes.
  - Styles defined in the project's global stylesheet.
  - Styles present in the component style sheeet.

  All static values and Dynamic values such as design-tokens are resolved
  to css-variables.

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
  PluginCssModules,
  HastNode,
  UIDLElement,
  UIDLElementNode,
} from '@teleporthq/teleport-types'
import { createStyleSheetPlugin } from './style-sheet'
import { generateStyledFromStyleContent } from './utils'
import { isJSXElement } from '@teleporthq/teleport-plugin-common/dist/cjs/utils/ast-utils'

interface CSSModulesConfig {
  componentChunkName?: string
  styleObjectImportName?: string
  styleChunkName?: string
  moduleExtension?: boolean
  classAttributeName?: string
}

const defaultConfigProps = {
  componentChunkName: 'jsx-component',
  styleChunkName: 'css-modules',
  styleObjectImportName: 'styles',
  moduleExtension: false,
  classAttributeName: 'className',
  globalStyleSheetPrefix: 'projectStyles',
}

export const createCSSModulesPlugin: ComponentPluginFactory<CSSModulesConfig> = (config = {}) => {
  const {
    componentChunkName,
    styleObjectImportName,
    styleChunkName,
    moduleExtension,
    classAttributeName,
    globalStyleSheetPrefix,
  } = {
    ...defaultConfigProps,
    ...config,
  }

  const cssModulesPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure
    const { node, styleSetDefinitions: componentStyleSheet = {}, propDefinitions = {} } = uidl
    const { projectStyleSet, designLanguage: { tokens = {} } = {}, isRootComponent } = options || {}
    const {
      styleSetDefinitions: globalStyleSheet = {},
      fileName: projectStyleSheetName,
      path: projectStyleSheetPath,
      importFile = false,
    } = projectStyleSet || {}

    if (isRootComponent) {
      if (Object.keys(tokens).length > 0 || Object.keys(globalStyleSheet).length > 0) {
        const fileName = moduleExtension ? `${projectStyleSheetName}.module` : projectStyleSheetName
        dependencies[globalStyleSheetPrefix] = {
          type: 'local',
          path: `${projectStyleSheetPath}${fileName}.${FileType.CSS}`,
          meta: {
            importJustPath: true,
          },
        }
      }

      return structure
    }

    const componentChunk = chunks.filter((chunk) => chunk.name === componentChunkName)[0]
    if (!componentChunk) {
      throw new PluginCssModules(
        `JSX based component chunk with name ${componentChunkName} was required and not found.`
      )
    }

    const cssClasses: string[] = []
    let isProjectStyleReferred: boolean = false
    const mediaStylesMap: Record<
      string,
      Array<{ [x: string]: Record<string, string | number> }>
    > = {}
    const astNodesLookup: Record<string, HastNode | types.JSXElement> =
      (componentChunk.meta.nodesLookup as Record<string, HastNode | types.JSXElement>) || {}
    const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop as string

    const generateStylesForElementNode = (element: UIDLElement) => {
      const { style, key, referencedStyles, dependency, attrs = {}, elementType } = element
      const jsxTag = astNodesLookup[key]
      const classNamesToAppend: Set<
        types.MemberExpression | types.Identifier | types.StringLiteral
      > = new Set()

      if (!jsxTag || !isJSXElement(jsxTag)) {
        return
      }

      if (dependency?.type === 'local') {
        StyleBuilders.setPropValueForCompStyle({
          attrs,
          root: jsxTag,
          getClassName: (styleName: string) =>
            StringUtils.camelCaseToDashCase(elementType + styleName),
        })
      }

      if (!style && !referencedStyles) {
        return
      }

      if (!key) {
        throw new PluginCssModules(
          'Element node does not have a key \n' + JSON.stringify(element, null, 2)
        )
      }

      const className = StringUtils.camelCaseToDashCase(key)
      const classReferenceIdentifier = types.memberExpression(
        types.identifier(styleObjectImportName),
        types.identifier(`'${className}'`),
        true
      )

      /* Generating styles from UIDLElementNode to component style sheet */
      if (Object.keys(style || {}).length > 0) {
        const { staticStyles, dynamicStyles, tokenStyles } =
          UIDLUtils.splitDynamicAndStaticStyles(style)

        if (Object.keys(staticStyles).length > 0 || Object.keys(tokenStyles).length > 0) {
          cssClasses.push(
            StyleBuilders.createCSSClass(className, generateStyledFromStyleContent(style))
          )
          classNamesToAppend.add(classReferenceIdentifier)
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
                if (!mediaStylesMap[String(maxWidth)]) {
                  mediaStylesMap[String(maxWidth)] = []
                }
                mediaStylesMap[String(maxWidth)].push({ [className]: collectedStyles })
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

              classNamesToAppend.add(classReferenceIdentifier)
              return
            }

            case 'component-referenced': {
              const classContent = styleRef.content.content
              if (classContent.type === 'static') {
                classNamesToAppend.add(types.stringLiteral(String(classContent.content)))
                return
              }

              if (
                classContent.type === 'dynamic' &&
                classContent.content.referenceType === 'prop'
              ) {
                classNamesToAppend.add(
                  types.memberExpression(
                    types.identifier(styleObjectImportName),
                    types.memberExpression(
                      types.identifier(propsPrefix),
                      types.identifier(classContent.content.id)
                    ),
                    true
                  )
                )

                const defaultPropValue = propDefinitions[classContent.content.id]?.defaultValue
                if (!defaultPropValue) {
                  return
                }
                /*
                  Changing the default value of the prop.
                   When forceScoping is enabled the classnames change. So, we need to change the default prop too. */
                propDefinitions[classContent.content.id].defaultValue = getClassName(
                  String(defaultPropValue)
                )

                return
              }

              if (
                classContent.type === 'dynamic' &&
                classContent.content.referenceType === 'comp'
              ) {
                classNamesToAppend.add(
                  types.memberExpression(
                    types.identifier(styleObjectImportName),
                    types.identifier(`'${getClassName(classContent.content.id)}'`),
                    true
                  )
                )
              }
              return
            }

            case 'project-referenced': {
              const { content } = styleRef
              isProjectStyleReferred = true
              const referedStyle = globalStyleSheet[content.referenceId]
              if (!referedStyle) {
                throw new PluginCssModules(
                  `Style used from global stylesheet is missing - ${content.referenceId}`
                )
              }
              classNamesToAppend.add(
                types.memberExpression(
                  types.identifier(globalStyleSheetPrefix),
                  types.identifier(`'${getClassName(content.referenceId)}'`),
                  true
                )
              )
              return
            }

            default: {
              throw new PluginCssModules(`Un-supported style reference ${styleRef.content}`)
            }
          }
        })
      }

      ASTUtils.addMultipleDynamicAttributesToJSXTag(
        jsxTag,
        classAttributeName,
        Array.from(classNamesToAppend)
      )
    }

    UIDLUtils.traverseElements(node, generateStylesForElementNode)
    for (const prop of Object.values(propDefinitions)) {
      if (prop.type === 'element' && prop.defaultValue) {
        UIDLUtils.traverseElements(
          prop.defaultValue as UIDLElementNode,
          generateStylesForElementNode
        )
      }
    }

    /* Generating component scoped styles */
    if (Object.keys(componentStyleSheet).length > 0) {
      StyleBuilders.generateStylesFromStyleSetDefinitions(
        componentStyleSheet,
        cssClasses,
        mediaStylesMap,
        (styleName: string) => StringUtils.camelCaseToDashCase(uidl.name + styleName)
      )
    }

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
        path: `${projectStyleSheetPath}${fileName}.${FileType.CSS}`,
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

const getClassName = (str: string) =>
  StringUtils.removeIllegalCharacters(StringUtils.camelCaseToDashCase(str))
