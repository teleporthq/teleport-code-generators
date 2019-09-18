import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { generateStyledComponent, countPropReferences } from './utils'
import {
  traverseElements,
  transformDynamicStyles,
} from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import {
  dashCaseToUpperCamelCase,
  dashCaseToCamelCase,
} from '@teleporthq/teleport-shared/dist/cjs/utils/string-utils'
import {
  addDynamicAttributeToJSXTag,
  addSpreadAttributeToJSXTag,
  renameJSXTag,
} from '@teleporthq/teleport-shared/dist/cjs/utils/ast-jsx-utils'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

interface StyledComponentsConfig {
  componentChunkName: string
  importChunkName?: string
}

export const createPlugin: ComponentPluginFactory<StyledComponentsConfig> = (config) => {
  const { componentChunkName = 'jsx-component', importChunkName = 'import-local' } = config || {}

  const reactStyledComponentsPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure
    const { node } = uidl
    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup
    const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop
    const jssStyleMap: Record<string, any> = {}

    traverseElements(node, (element) => {
      const { style, key, elementType } = element
      if (style && Object.keys(style).length > 0) {
        const root = jsxNodesLookup[key]
        const className = `${dashCaseToUpperCamelCase(key)}`
        const timesReferred = countPropReferences(style, 0)

        jssStyleMap[className] = transformDynamicStyles(style, (styleValue, attribute) => {
          if (styleValue.content.referenceType === 'prop') {
            const dashCaseAttribute = dashCaseToCamelCase(attribute)
            switch (timesReferred) {
              case 1:
                addDynamicAttributeToJSXTag(
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
        })

        if (timesReferred > 1) {
          addSpreadAttributeToJSXTag(root, propsPrefix)
        }

        renameJSXTag(root, className)

        const code = {
          type: CHUNK_TYPE.AST,
          fileType: FILE_TYPE.JS,
          name: className,
          linkAfter: [importChunkName],
          content: generateStyledComponent(className, elementType, jssStyleMap[className]),
        }
        chunks.push(code)
      }
    })

    if (Object.keys(jssStyleMap).length > 0) {
      dependencies.styled = {
        type: 'library',
        path: 'styled-components',
        version: '4.2.0',
      }
    }

    return structure
  }

  return reactStyledComponentsPlugin
}

export default createPlugin()
