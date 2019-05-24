import {
  ComponentPluginFactory,
  ComponentPlugin,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { generateStyledComponent, countPropReferences } from './utils'
import {
  traverseElements,
  transformDynamicStyles,
} from '@teleporthq/teleport-generator-shared/lib/utils/uidl-utils'
import { dashCaseToUpperCamelCase } from '@teleporthq/teleport-generator-shared/lib/utils/string-utils'
import {
  createJSXSpreadAttribute,
  addDynamicAttributeOnTag,
} from '@teleporthq/teleport-generator-shared/lib/utils/ast-jsx-utils'

interface StyledComponentsConfig {
  componentChunkName: string
  importChunkName?: string
}

export const createPlugin: ComponentPluginFactory<StyledComponentsConfig> = (config) => {
  const { componentChunkName = 'react-component', importChunkName = 'import-local' } = config || {}

  const reactStyledComponentsPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure
    const { node } = uidl
    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup
    const jssStyleMap = {}

    traverseElements(node, (element) => {
      const { style, key, elementType } = element
      if (style) {
        const root = jsxNodesLookup[key]
        const className = `${dashCaseToUpperCamelCase(key)}`
        const timesReferred = countPropReferences(style, 0)

        jssStyleMap[className] = transformDynamicStyles(style, (styleValue, attribute) => {
          if (styleValue.content.referenceType === 'prop') {
            switch (timesReferred) {
              case 1:
                addDynamicAttributeOnTag(root, attribute, styleValue.content.id, 'props')
                return `\$\{props => props.${attribute}\}`
              default:
                return `\$\{props => props.${styleValue.content.id}\}`
            }
          }

          throw new Error(
            `Error running transformDynamicStyles in reactStyledComponentsPlugin. Unsupported styleValue.content.referenceType value ${
              styleValue.content.referenceType
            }`
          )
        })

        if (timesReferred > 1) {
          root.openingElement.attributes.push(createJSXSpreadAttribute('props'))
        }

        root.openingElement.name.name = className

        const code = {
          type: 'js',
          name: className,
          linkAfter: [importChunkName],
          content: generateStyledComponent(className, elementType, jssStyleMap[className]),
        }
        chunks.push(code)
      }
    })

    if (!Object.keys(jssStyleMap).length) {
      return structure
    }

    dependencies.styled = {
      type: 'library',
      path: 'styled-components',
      version: '4.2.0',
    }

    return structure
  }

  return reactStyledComponentsPlugin
}

export default createPlugin()
