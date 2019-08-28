import * as types from '@babel/types'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { traverseElements } from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import { ASSETS_IDENTIFIER } from '@teleporthq/teleport-shared/dist/cjs/constants'
import { setResourceURIObject, setResourceRequireCall } from './utils'

interface StyledComponentsConfig {
  componentChunkName: string
  importChunkName?: string
  componentLibrary?: 'react' | 'reactnative'
}

export const createPlugin: ComponentPluginFactory<StyledComponentsConfig> = (config) => {
  const { componentChunkName = 'jsx-component' } = config || {}

  const reactStyledComponentsPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure
    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup as Record<string, types.JSXElement>

    traverseElements(uidl.node, (element) => {
      if (element.elementType !== 'Image' || !(element.attrs && element.attrs.source)) {
        return
      }

      const jsxElement = jsxNodesLookup[element.key]
      const sourceAttr = element.attrs.source
      const sourceAttrAST = jsxElement.openingElement.attributes.find(
        (attr) => attr.type === 'JSXAttribute' && attr.name.name === 'source'
      ) as types.JSXAttribute

      if (!sourceAttrAST) {
        return
      }

      if (sourceAttr.type === 'static') {
        const sourcePath = sourceAttr.content.toString()
        if (sourcePath.includes(ASSETS_IDENTIFIER)) {
          // Assuming the components are generated next to the assets folder
          setResourceRequireCall(sourceAttrAST, `..${sourcePath}`)
        } else {
          setResourceURIObject(sourceAttrAST)
        }
      } else {
        setResourceURIObject(sourceAttrAST)
      }
    })

    return structure
  }

  return reactStyledComponentsPlugin
}

export default createPlugin()
