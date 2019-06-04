import { generateVueComponentJS, generateNodeSyntax, extractStateObject } from './utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { FILE_TYPE } from '@teleporthq/teleport-shared/lib/constants'

interface VueComponentConfig {
  vueTemplateChunkName: string
  vueJSChunkName: string
  htmlFileId: string
  jsFileAfter: string[]
  jsFileId: string
}

export const ERROR_LOG_NAME = `vue-base-component`

export const createPlugin: ComponentPluginFactory<VueComponentConfig> = (config) => {
  const {
    vueTemplateChunkName = 'vue-template-chunk',
    vueJSChunkName = 'vue-js-chunk',
    htmlFileId = FILE_TYPE.HTML,
    jsFileId = FILE_TYPE.JS,
    jsFileAfter = ['import-lib', 'import-pack', 'import-local'],
  } = config || {}

  const vueBasicComponentChunks: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure

    const templateLookup: { [key: string]: any } = {}
    const dataObject: Record<string, any> = {}
    const methodsObject: Record<string, any> = {}

    const templateContent = generateNodeSyntax(uidl.node, {
      templateLookup,
      dependencies,
      dataObject,
      methodsObject,
    })

    chunks.push({
      type: 'html',
      name: vueTemplateChunkName,
      meta: {
        lookup: templateLookup,
        fileId: htmlFileId,
      },
      content: templateContent,
      linkAfter: [],
    })

    const stateObject = uidl.stateDefinitions ? extractStateObject(uidl.stateDefinitions) : {}
    const jsContent = generateVueComponentJS(
      uidl,
      Object.keys(dependencies),
      {
        ...stateObject,
        ...dataObject,
      },
      methodsObject
    )

    chunks.push({
      type: 'js',
      name: vueJSChunkName,
      meta: {
        fileId: jsFileId,
      },
      linkAfter: jsFileAfter,
      content: jsContent,
    })

    return structure
  }

  return vueBasicComponentChunks
}

export default createPlugin()
