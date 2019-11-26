import * as types from '@babel/types'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { generateStyledComponent, countPropReferences, removeUnusedDependencies } from './utils'
import { UIDLUtils, StringUtils } from '@teleporthq/teleport-shared'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'

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
    const { uidl, chunks, dependencies } = structure
    const { node, name } = uidl
    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup as Record<string, types.JSXElement>
    const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop
    const jssStyleMap: Record<string, any> = {}

    UIDLUtils.traverseElements(node, (element) => {
      let { style } = element
      const { key, elementType } = element
      if (style && Object.keys(style).length > 0) {
        const root = jsxNodesLookup[key]
        let className = StringUtils.dashCaseToUpperCamelCase(key)

        // Styled components might create an element that clashes with native element (Text, View, Image, etc.)
        if (
          illegalComponentNames.includes(className) ||
          StringUtils.dashCaseToUpperCamelCase(key) === name ||
          Object.keys(dependencies).includes(className)
        ) {
          className = `Styled${className}`
        }

        const timesReferred = countPropReferences(style, 0)

        if (componentLibrary === 'reactnative') {
          style = UIDLUtils.cleanupNestedStyles(style)
        }

        jssStyleMap[className] = UIDLUtils.transformDynamicStyles(
          style,
          (styleValue, attribute) => {
            if (styleValue.content.referenceType === 'prop') {
              const dashCaseAttribute = StringUtils.dashCaseToCamelCase(attribute)
              switch (timesReferred) {
                case 1:
                  ASTUtils.addDynamicAttributeToJSXTag(
                    root,
                    dashCaseAttribute,
                    styleValue.content.id,
                    propsPrefix
                  )
                  return `\$\{props => props.${dashCaseAttribute}\}`
                default:
                  return `\$\{props => props.${styleValue.content.id}\}`
              }
            }
            throw new Error(
              `Error running transformDynamicStyles in reactStyledComponentsPlugin. Unsupported styleValue.content.referenceType value ${styleValue.content.referenceType}`
            )
          }
        )

        if (timesReferred > 1) {
          ASTUtils.addSpreadAttributeToJSXTag(root, propsPrefix)
        }

        ASTUtils.renameJSXTag(root, className)

        const code = {
          type: ChunkType.AST,
          fileType: FileType.JS,
          name: className,
          linkAfter: [importChunkName],
          content: generateStyledComponent(className, elementType, jssStyleMap[className]),
        }
        chunks.push(code)
      }
    })

    if (Object.keys(jssStyleMap).length === 0) {
      return structure
    }

    dependencies.styled = {
      type: 'library',
      path: componentLibrary === 'react' ? 'styled-components' : 'styled-components/native',
      version: '4.2.0',
    }

    // React Native elements are imported from styled-components/native, so direct dependency to `react-native` is removed
    if (componentLibrary === 'reactnative') {
      removeUnusedDependencies(dependencies, jsxNodesLookup)
    }

    return structure
  }

  return reactStyledComponentsPlugin
}

export default createReactStyledComponentsPlugin()
