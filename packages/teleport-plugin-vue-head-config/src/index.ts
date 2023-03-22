import { ComponentPluginFactory, ComponentPlugin, UIDLMetaTag } from '@teleporthq/teleport-types'
import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'

interface VueMetaPluginConfig {
  vueJSChunkName?: string
  metaObjectKey?: string
}

export const createVueHeadConfigPlugin: ComponentPluginFactory<VueMetaPluginConfig> = (config) => {
  const { vueJSChunkName = 'vue-js-chunk', metaObjectKey = 'head' } = config || {}

  const vueHeadConfigPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure

    const componentChunk = chunks.find((chunk) => chunk.name === vueJSChunkName)
    if (!componentChunk) {
      throw new Error(`JS component chunk with name ${vueJSChunkName} was required and not found.`)
    }

    const headObject: {
      title?: string
      meta?: UIDLMetaTag[]
      link?: Array<Record<string, string>>
    } = {}

    if (uidl.seo && uidl.seo.title) {
      // TODO: add support for dynamic titles
      headObject.title = uidl.seo.title as string
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
      // @ts-ignore
      const exportObjectAST = componentChunk.content.declaration as types.ObjectExpression
      exportObjectAST.properties.push(
        types.objectProperty(
          types.identifier(metaObjectKey),
          ASTUtils.objectToObjectExpression(headObject)
        )
      )
    }

    return structure
  }

  return vueHeadConfigPlugin
}

export default createVueHeadConfigPlugin()
