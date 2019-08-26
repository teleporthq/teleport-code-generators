import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import * as types from '@babel/types'
import { objectToObjectExpression } from '@teleporthq/teleport-shared/dist/cjs/utils/ast-js-utils'

interface VueMetaPluginConfig {
  vueJSChunkName?: string
  metaObjectKey?: string
}

export const createPlugin: ComponentPluginFactory<VueMetaPluginConfig> = (config) => {
  const { vueJSChunkName = 'vue-js-chunk', metaObjectKey = 'head' } = config || {}

  const propTypesPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure

    const componentChunk = chunks.find((chunk) => chunk.name === vueJSChunkName)
    if (!componentChunk) {
      throw new Error(`JS component chunk with name ${vueJSChunkName} was required and not found.`)
    }

    const headObject: {
      title?: string
      meta?: Array<Record<string, string>>
      link?: Array<Record<string, string>>
    } = {}

    if (uidl.seo && uidl.seo.title) {
      headObject.title = uidl.seo.title
    }

    if (uidl.seo && uidl.seo.metaTags) {
      headObject.meta = uidl.seo.metaTags
    }

    if (uidl.seo.assets) {
      uidl.seo.assets.forEach((asset) => {
        // TODO: Handle other asset types when needed
        if (asset.type === 'canonical') {
          headObject.link = [{ rel: 'canonical', href: asset.path }]
        }
      })
    }

    if (Object.keys(headObject).length > 0) {
      const exportObjectAST = componentChunk.content.declaration as types.ObjectExpression
      exportObjectAST.properties.push(
        types.objectProperty(types.identifier(metaObjectKey), objectToObjectExpression(headObject))
      )
    }

    return structure
  }

  return propTypesPlugin
}

export default createPlugin()
