import { ComponentPluginFactory, ComponentPlugin, UIDLDependency } from '@teleporthq/teleport-types'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import * as types from '@babel/types'

interface NextImagePluginConfig {
  componentChunkName: string
  localAssetFolder: string
}

const NEXT_HEAD_DEPENDENCY: UIDLDependency = {
  type: 'library',
  path: 'next/head',
  version: '10.0.5',
}

export const createNextImagePlugin: ComponentPluginFactory<NextImagePluginConfig> = (config) => {
  const { componentChunkName = 'jsx-component', localAssetFolder = 'playground_assets' } =
    config || {}
  const nextImagePlugin: ComponentPlugin = async (structure) => {
    const { chunks, uidl, dependencies } = structure
    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return
    }

    UIDLUtils.traverseElements(uidl.node, (element) => {
      const { elementType, attrs } = element

      if (elementType === 'img') {
        const imageSource = attrs?.src?.content.toString()
        if (!imageSource || !imageSource.startsWith(`/${localAssetFolder}`)) {
          return
        }

        const { key } = element
        const jsxTag = ((componentChunk.meta.nodesLookup as unknown) as Record<
          string,
          types.JSXElement
        >)[key]
        ;(jsxTag.openingElement.name as types.JSXIdentifier).name = 'Image'
        ;(jsxTag.closingElement.name as types.JSXIdentifier).name = 'Image'

        if (!dependencies.Image) {
          dependencies.Image = NEXT_HEAD_DEPENDENCY
        }
      }
    })

    return structure
  }

  return nextImagePlugin
}

export default createNextImagePlugin()
