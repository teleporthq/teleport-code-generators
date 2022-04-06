import * as types from '@babel/types'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
  PluginStyledComponent,
} from '@teleporthq/teleport-types'
import { UIDLUtils, StringUtils } from '@teleporthq/teleport-shared'
import { ASTUtils, StyleBuilders } from '@teleporthq/teleport-plugin-common'
import {
  generateStyledComponent,
  removeUnusedDependencies,
  generateVariantsfromStyleSet,
  generateStyledComponentStyles,
} from './utils'
import { createStyleSheetPlugin } from './style-sheet'
import {
  componentVariantPropKey,
  componentVariantPropPrefix,
  projectVariantPropKey,
  projectVariantPropPrefix,
  VARIANT_DEPENDENCY,
} from './constants'

interface StyledComponentsConfig {
  componentChunkName: string
  importChunkName?: string
  componentLibrary?: 'react' | 'reactnative'
  illegalComponentNames?: string[]
  classAttributeName?: string
}

export const createReactStyledComponentsPlugin: ComponentPluginFactory<StyledComponentsConfig> = (
  config
) => {
  const {
    componentChunkName = 'jsx-component',
    importChunkName = 'import-local',
    componentLibrary = 'react',
    illegalComponentNames = [],
  } = config || {}

  const reactStyledComponentsPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure
    const { node, name, styleSetDefinitions: componentStyleSheet = {}, propDefinitions = {} } = uidl
    const { projectStyleSet } = options
    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup as Record<string, types.JSXElement>
    const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop as string
    const cssMap: Record<string, types.ObjectExpression> = {}
    const tokensReferred: Set<string> = new Set()

    if (Object.keys(componentStyleSheet).length > 0) {
      const variants = generateVariantsfromStyleSet(
        componentStyleSheet,
        componentVariantPropPrefix,
        componentVariantPropKey,
        tokensReferred
      )
      chunks.push({
        name: 'variant',
        type: ChunkType.AST,
        content: variants,
        fileType: FileType.JS,
        linkAfter: ['jsx-component'],
      })
      dependencies.variant = VARIANT_DEPENDENCY
    }

    UIDLUtils.traverseElements(node, (element) => {
      const { key, elementType, referencedStyles, dependency, style, attrs = {} } = element
      const propsReferred: Set<string> = new Set()
      const componentStyleReferences: Set<string> = new Set()
      const projectStyleReferences: Set<string> = new Set()

      if (dependency?.type === 'local') {
        StyleBuilders.setPropValueForCompStyle({
          attrs,
          key,
          jsxNodesLookup,
          getClassName,
        })
      }

      if (
        Object.keys(style || {}).length === 0 &&
        Object.keys(referencedStyles || {}).length === 0
      ) {
        return
      }

      const root = jsxNodesLookup[key]
      let className = StringUtils.dashCaseToUpperCamelCase(key)

      if (style && Object.keys(style).length > 0) {
        /* Styled components might create an element that
          clashes with native element (Text, View, Image, etc.) */
        if (
          illegalComponentNames.includes(className) ||
          StringUtils.dashCaseToUpperCamelCase(key) === name ||
          Object.keys(dependencies).includes(className)
        ) {
          className = `Styled${className}`
        }

        if (componentLibrary === 'reactnative') {
          if (referencedStyles && Object.keys(referencedStyles).length > 0) {
            Object.keys(referencedStyles).forEach((styleId) => {
              const styleRef = referencedStyles[styleId]
              if (styleRef.content.mapType === 'inlined') {
                referencedStyles[styleId] = {
                  ...referencedStyles[styleId],
                  content: {
                    ...referencedStyles[styleId].content,
                    // @ts-ignore
                    styles: styleRef.content.styles,
                  },
                }
              }
            })
          }
        }

        cssMap[className] = generateStyledComponentStyles({
          styles: style,
          propsReferred,
          tokensReferred,
          propsPrefix,
          tokensPrefix: 'TOKENS',
        })
      }

      if (referencedStyles && Object.keys(referencedStyles)?.length > 0) {
        Object.values(referencedStyles).forEach((styleRef) => {
          switch (styleRef.content?.mapType) {
            case 'inlined': {
              const { conditions } = styleRef.content
              const [condition] = conditions

              if (condition.conditionType === 'screen-size') {
                const nodeStyle = cssMap[className]
                const mediaStyles = types.objectProperty(
                  types.stringLiteral(`@media(max-width: ${condition.maxWidth}px)`),
                  generateStyledComponentStyles({
                    styles: styleRef.content.styles,
                    propsReferred,
                    tokensReferred,
                    propsPrefix,
                    tokensPrefix: 'TOKENS',
                  })
                )
                if (nodeStyle?.type === 'ObjectExpression') {
                  nodeStyle.properties.push(mediaStyles)
                } else {
                  cssMap[className] = ASTUtils.wrapObjectPropertiesWithExpression([mediaStyles])
                }
              }

              if (condition.conditionType === 'element-state') {
                const nodeStyle = cssMap[className]
                const mediaStyles = types.objectProperty(
                  types.stringLiteral(`&:${condition.content}`),
                  generateStyledComponentStyles({
                    styles: styleRef.content.styles,
                    propsReferred,
                    tokensReferred,
                    propsPrefix,
                    tokensPrefix: 'TOKENS',
                  })
                )
                if (nodeStyle?.type === 'ObjectExpression') {
                  nodeStyle.properties.push(mediaStyles)
                } else {
                  cssMap[className] = ASTUtils.wrapObjectPropertiesWithExpression([mediaStyles])
                }
              }

              return
            }

            case 'component-referenced': {
              if (componentStyleReferences.size > 0) {
                throw new PluginStyledComponent(
                  `Styled Components can have only one component-reference. Recevied more than one \n
                  ${JSON.stringify(referencedStyles, null, 2)}`
                )
              }

              if (styleRef.content.content.type === 'static') {
                componentStyleReferences.add(componentVariantPropPrefix)
                ASTUtils.addAttributeToJSXTag(
                  root,
                  componentVariantPropKey,
                  styleRef.content.content.content
                )
              }

              if (
                styleRef.content.content.type === 'dynamic' &&
                styleRef.content.content.content.referenceType === 'comp'
              ) {
                const usedCompStyle = componentStyleSheet[styleRef.content.content.content.id]
                if (!usedCompStyle) {
                  throw new Error(`${styleRef.content.content.content.id} is missing from props`)
                }
                componentStyleReferences.add(usedCompStyle.type)

                ASTUtils.addAttributeToJSXTag(
                  root,
                  componentVariantPropKey,
                  getClassName(styleRef.content.content.content.id)
                )
              }

              if (
                styleRef.content.content.type === 'dynamic' &&
                styleRef.content.content.content.referenceType === 'prop'
              ) {
                const prop = propDefinitions[styleRef.content.content.content.id]
                if (prop?.defaultValue) {
                  const usedCompStyle = componentStyleSheet[String(prop.defaultValue)]
                  componentStyleReferences.add(usedCompStyle.type)
                  /*
                  Changing the default value of the prop. 
                  When forceScoping is enabled the classnames change. So, we need to change the default prop too.
                */
                  propDefinitions[styleRef.content.content.content.id].defaultValue = getClassName(
                    String(prop.defaultValue)
                  )
                } else {
                  componentStyleReferences.add(componentVariantPropPrefix)
                }

                ASTUtils.addDynamicAttributeToJSXTag(
                  root,
                  componentVariantPropKey,
                  `${propsPrefix}.${styleRef.content.content.content.id}`
                )
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
              const referedStyle = projectStyleSet.styleSetDefinitions[content.referenceId]
              if (!referedStyle) {
                throw new Error(
                  `Style that is being used for reference is missing - ${content.referenceId}`
                )
              }
              dependencies[projectVariantPropPrefix] = {
                type: 'local',
                path: `${projectStyleSet.path}${projectStyleSet.fileName}`,
                meta: {
                  namedImport: true,
                },
              }
              projectStyleReferences.add(projectVariantPropPrefix)

              ASTUtils.addAttributeToJSXTag(
                root,
                projectVariantPropKey,
                getClassName(content.referenceId)
              )
              return
            }
            default: {
              throw new Error(`
                  We support only inlined and project-referenced styles as of now, received ${JSON.stringify(
                    styleRef.content,
                    null,
                    2
                  )}
                `)
            }
          }
        })
      }

      if (propsReferred.size > 0) {
        ASTUtils.addSpreadAttributeToJSXTag(root, propsPrefix)
      }

      ASTUtils.renameJSXTag(root, className)

      const code = {
        type: ChunkType.AST,
        fileType: FileType.JS,
        name: className,
        linkAfter: [importChunkName],
        content: generateStyledComponent({
          name: className,
          styles: cssMap[className],
          elementType,
          propsReferred,
          componentStyleReferences,
          projectStyleReferences,
        }),
      }
      chunks.push(code)
    })

    if (Object.keys(cssMap).length === 0) {
      return structure
    }

    if (tokensReferred.size > 0) {
      dependencies.TOKENS = {
        type: 'local',
        path: `${projectStyleSet.path}${projectStyleSet.fileName}`,
        meta: {
          namedImport: true,
        },
      }
    }

    dependencies.styled = {
      type: 'package',
      path: componentLibrary === 'react' ? 'styled-components' : 'styled-components/native',
      version: '^5.3.0',
    }

    /* React Native elements are imported from styled-components/native,
    so direct dependency to `react-native` is removed */

    if (componentLibrary === 'reactnative') {
      removeUnusedDependencies(dependencies, jsxNodesLookup)
    }

    return structure
  }

  return reactStyledComponentsPlugin
}

export { createStyleSheetPlugin }

export default createReactStyledComponentsPlugin()

const getClassName = (str: string) => StringUtils.dashCaseToCamelCase(str)
