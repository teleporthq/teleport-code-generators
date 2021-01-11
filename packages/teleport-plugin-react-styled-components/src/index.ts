import * as types from '@babel/types'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { UIDLUtils, StringUtils } from '@teleporthq/teleport-shared'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import {
  generateStyledComponent,
  countPropReferences,
  removeUnusedDependencies,
  generatePropReferencesSyntax,
  countPropRefernecesFromReferencedStyles,
} from './utils'
import { createStyleSheetPlugin } from './style-sheet'

interface StyledComponentsConfig {
  componentChunkName: string
  importChunkName?: string
  componentLibrary?: 'react' | 'reactnative'
  illegalComponentNames?: string[]
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
    const { node, name } = uidl
    const { projectStyleSet } = options
    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup as Record<string, types.JSXElement>
    // @ts-ignore
    const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop
    const jssStyleMap: Record<string, unknown> = {}
    const tokensReferred: string[] = []

    UIDLUtils.traverseElements(node, (element) => {
      const { style } = element
      const { key, elementType, referencedStyles } = element

      if (!style && !referencedStyles) {
        return
      }

      const root = jsxNodesLookup[key]
      let className = StringUtils.dashCaseToUpperCamelCase(key)
      const projectReferencedClassNames: string[] = []

      let timesProsReferred = countPropReferences(style, 0)
      timesProsReferred = countPropRefernecesFromReferencedStyles(
        referencedStyles,
        timesProsReferred
      )

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
            Object.values(referencedStyles).forEach((styleRef) => {
              if (styleRef.content.mapType === 'inlined') {
                referencedStyles[styleRef.id] = {
                  ...referencedStyles[styleRef.id],
                  content: {
                    ...referencedStyles[styleRef.id].content,
                    // @ts-ignore
                    styles: styleRef.content.styles,
                  },
                }
              }
            })
          }
        }
        jssStyleMap[className] = generatePropReferencesSyntax(
          style,
          timesProsReferred,
          tokensReferred,
          root,
          propsPrefix
        )
      }

      if (referencedStyles && Object.keys(referencedStyles)?.length > 0) {
        Object.values(referencedStyles).forEach((styleRef) => {
          switch (styleRef.content?.mapType) {
            case 'inlined': {
              const { conditions } = styleRef.content
              const [condition] = conditions

              if (styleRef.content?.styles && Object.keys(styleRef.content.styles).length === 0) {
                return
              }

              if (condition.conditionType === 'screen-size') {
                jssStyleMap[className] = {
                  ...(jssStyleMap[className] as Record<string, string>),
                  [`@media(max-width: ${condition.maxWidth}px)`]: generatePropReferencesSyntax(
                    styleRef.content.styles,
                    timesProsReferred,
                    tokensReferred,
                    root,
                    propsPrefix
                  ),
                }
              }

              if (condition.conditionType === 'element-state') {
                jssStyleMap[className] = {
                  ...(jssStyleMap[className] as Record<string, string>),
                  [`&:${condition.content}`]: generatePropReferencesSyntax(
                    styleRef.content.styles,
                    timesProsReferred,
                    tokensReferred,
                    root,
                    propsPrefix
                  ),
                }
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
                const referedStyle = projectStyleSet.styleSetDefinitions[content.referenceId]
                if (!referedStyle) {
                  throw new Error(
                    `Style that is being used for reference is missing - ${content.referenceId}`
                  )
                }
                const styleName = StringUtils.dashCaseToUpperCamelCase(referedStyle.name)
                projectReferencedClassNames.push(styleName)
                dependencies[styleName] = {
                  type: 'local',
                  path: `${projectStyleSet.path}/${projectStyleSet.fileName}`,
                  meta: {
                    namedImport: true,
                  },
                }
              }

              return
            }
            default: {
              throw new Error(`
                We support only inlined and project-referenced styles as of now, received ${styleRef.content}
              `)
            }
          }
        })
      }

      if (timesProsReferred > 1) {
        ASTUtils.addSpreadAttributeToJSXTag(root, propsPrefix)
      }

      ASTUtils.renameJSXTag(root, className)

      const code = {
        type: ChunkType.AST,
        fileType: FileType.JS,
        name: className,
        linkAfter: [importChunkName],
        content: generateStyledComponent(
          className,
          elementType,
          jssStyleMap[className] as Record<string, unknown>,
          projectReferencedClassNames
        ),
      }
      chunks.push(code)
    })

    if (Object.keys(jssStyleMap).length === 0) {
      return structure
    }

    if (tokensReferred.length > 0) {
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
      version: '4.2.0',
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
