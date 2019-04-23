import * as t from '@babel/types'
import { ComponentPluginFactory, ComponentPlugin } from '../../typings/generators'
import { generateStyledComponent } from './utils'
import { ParsedASTNode } from '../../shared/utils/ast-js-utils'
import { traverseElements, transformDynamicStyles } from '../../shared/utils/uidl-utils'

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

    const jssStyleMap = {}

    traverseElements(node, (element) => {
      const { style, key, elementType } = element
      const className = `${key}Wrapper`
      if (style) {
        jssStyleMap[className] = transformDynamicStyles(
          style,
          (styleValue) =>
            new ParsedASTNode(
              t.arrowFunctionExpression(
                [t.identifier('props')],
                t.memberExpression(t.identifier('props'), t.identifier(styleValue.content.id))
              )
            )
        )
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
