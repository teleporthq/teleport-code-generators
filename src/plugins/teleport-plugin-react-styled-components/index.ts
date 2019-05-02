import { ComponentPluginFactory, ComponentPlugin } from '../../typings/generators'
import { generateStyledComponent } from './utils'
import { traverseElements, transformDynamicStyles } from '../../shared/utils/uidl-utils'
import { stringToUpperCamelCase } from '../../shared/utils/string-utils'
import {
  createJSXSpreadAttribute,
  addDynamicAttributeOnTag,
} from '../../shared/utils/ast-jsx-utils'

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
        const className = `${stringToUpperCamelCase(key)}`
        let timesReferred: number = 0

        Object.keys(style).map((item) => {
          // @ts-ignore-next-line
          if (style[item].content.referenceType === 'prop') {
            timesReferred++
          }
        })

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
