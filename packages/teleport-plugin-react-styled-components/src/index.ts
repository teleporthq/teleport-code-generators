import * as types from '@babel/types'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
  PluginStyledComponent,
  UIDLCompDynamicReference,
} from '@teleporthq/teleport-types'
import { UIDLUtils, StringUtils } from '@teleporthq/teleport-shared'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
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
    classAttributeName = 'className',
  } = config || {}

  const reactStyledComponentsPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure
    const { node, name, styleSetDefinitions: componentStyleSheet = {} } = uidl
    const { projectStyleSet } = options
    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup as Record<string, types.JSXElement>
    const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop as string
    const cssMap: Record<string, types.ObjectExpression> = {}
    const tokensReferred: Set<string> = new Set()

    UIDLUtils.traverseElements(node, (element) => {
      const { style } = element
      const { key, elementType, referencedStyles } = element
      const propsReferred: Set<string> = new Set()
      const styleReferences: Set<string> = new Set()
      const staticClasses: Set<types.Identifier> = new Set()

      if (!style && !referencedStyles) {
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
        const hasMultipleCompReferences = Object.values(referencedStyles).filter((item) => {
          if (item.content.mapType === 'component-referenced') {
            const { type, content } = item.content.content as UIDLCompDynamicReference
            if (
              type === 'dynamic' &&
              (content.referenceType === 'prop' || content.referenceType === 'comp')
            ) {
              return item
            }
          }
        })

        if (hasMultipleCompReferences.length > 1) {
          throw new PluginStyledComponent(`Styled Component can have only one reference per node.
i.e either a direct static reference from component style sheet or from props. Got both. ${JSON.stringify(
            hasMultipleCompReferences,
            null,
            2
          )}`)
        }

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
              if (styleRef.content.content.type === 'static') {
                staticClasses.add(types.identifier(`'${styleRef.content.content.content}'`))
              }

              if (
                styleRef.content.content.type === 'dynamic' &&
                styleRef.content.content.content.referenceType === 'comp'
              ) {
                styleReferences.add(componentVariantPropPrefix)
                ASTUtils.addAttributeToJSXTag(
                  root,
                  componentVariantPropKey,
                  styleRef.content.content.content.id
                )
              }

              if (
                styleRef.content.content.type === 'dynamic' &&
                styleRef.content.content.content.referenceType === 'prop'
              ) {
                styleReferences.add(componentVariantPropPrefix)
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
                path: `${projectStyleSet.path}/${projectStyleSet.fileName}`,
                meta: {
                  namedImport: true,
                },
              }
              styleReferences.add(projectVariantPropPrefix)

              ASTUtils.addAttributeToJSXTag(root, projectVariantPropKey, content.referenceId)
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

      if (staticClasses.size > 0) {
        ASTUtils.addMultipleDynamicAttributesToJSXTag(
          root,
          classAttributeName,
          Array.from(staticClasses)
        )
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
          styleReferences,
        }),
      }
      chunks.push(code)
    })

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

    if (Object.keys(cssMap).length === 0) {
      return structure
    }

    if (tokensReferred.size > 0) {
      dependencies.TOKENS = {
        type: 'local',
        path: `${projectStyleSet.path}/${projectStyleSet.fileName}`,
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
