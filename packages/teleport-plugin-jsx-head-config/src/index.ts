import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { createJSXTag } from '@teleporthq/teleport-shared/dist/cjs/builders/ast-builders'
import * as types from '@babel/types'

interface JSXHeadPluginConfig {
  componentChunkName?: string
  configTagIdentifier?: string
  configTagDependencyPath?: string
}

export const createPlugin: ComponentPluginFactory<JSXHeadPluginConfig> = (config) => {
  const {
    componentChunkName = 'jsx-component',
    configTagIdentifier = 'Helmet',
    configTagDependencyPath = 'react-helmet',
  } = config || {}

  const propTypesPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)

    const astContent = createJSXTag('title', [types.jsxText(`You are on page: ${uidl.name}`)])

    const headConfigTag = createJSXTag(configTagIdentifier, [astContent])

    const rootKey = uidl.node.content.key
    const rootElement = componentChunk.meta.nodesLookup[rootKey] as types.JSXElement

    // Head config added as the first child of the root element
    rootElement.children.unshift(headConfigTag)

    dependencies[configTagIdentifier] = {
      type: 'library',
      path: configTagDependencyPath,
    }

    return structure
  }

  return propTypesPlugin
}

export default createPlugin()
