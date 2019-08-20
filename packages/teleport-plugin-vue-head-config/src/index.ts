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

    const head = { title: `You are on page: ${uidl.name}` }

    const exportObjectAST = componentChunk.content.declaration as types.ObjectExpression
    exportObjectAST.properties.push(
      types.objectProperty(types.identifier(metaObjectKey), objectToObjectExpression(head))
    )

    return structure
  }

  return propTypesPlugin
}

export default createPlugin()
