import * as types from '@babel/types'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { Constants, UIDLUtils } from '@teleporthq/teleport-shared'
import { setResourceURIObject, setResourceRequireCall } from './utils'

interface ReactNativeResourceLoaderPlugin {
  componentChunkName: string
}

export const createReactNativeResourcePlugin: ComponentPluginFactory<
  ReactNativeResourceLoaderPlugin
> = (config) => {
  const { componentChunkName = 'jsx-component' } = config || {}

  const reactNativeResourcePlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure
    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup as Record<string, types.JSXElement>

    UIDLUtils.traverseElements(uidl.node, (element) => {
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
        if (sourcePath.includes(Constants.ASSETS_IDENTIFIER)) {
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

  return reactNativeResourcePlugin
}

export default createReactNativeResourcePlugin()
