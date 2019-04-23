import { ComponentPluginFactory, ComponentPlugin } from '../../typings/generators'
import { generateStyledWrapper } from './utils'
import { traverseElements } from '../../shared/utils/uidl-utils'

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

    traverseElements(node, (element) => {
      const { style } = element
      if (style) {
        const code = {
          type: 'js',
          name: '',
          linkAfter: [importChunkName],
          content: generateStyledWrapper(element.name),
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
