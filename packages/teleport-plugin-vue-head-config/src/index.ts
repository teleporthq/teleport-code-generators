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
    } = {}

    if (uidl.meta && uidl.meta.title) {
      headObject.title = uidl.meta.title
    }

    if (uidl.meta && uidl.meta.metaTags) {
      headObject.meta = uidl.meta.metaTags
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
