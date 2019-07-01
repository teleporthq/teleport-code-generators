import { generateVueComponentJS, generateNodeSyntax, extractStateObject } from './utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { FILE_TYPE } from '@teleporthq/teleport-shared/lib/constants'
import * as htmlUtils from '@teleporthq/teleport-shared/lib/utils/html-utils'
import { createHTMLNode } from '@teleporthq/teleport-shared/lib/builders/html-builders'

import {
  DEFAULT_VUE_TEMPLATE_CHUNK_NAME,
  DEFAULT_VUE_JS_CHUNK_NAME,
  DEFAULT_JS_FILE_AFTER,
} from './constants'

interface VueComponentConfig {
  vueTemplateChunkName: string
  vueJSChunkName: string
  htmlFileId: string
  jsFileAfter: string[]
  jsFileId: string
}

export const createPlugin: ComponentPluginFactory<VueComponentConfig> = (config) => {
  const {
    vueTemplateChunkName = DEFAULT_VUE_TEMPLATE_CHUNK_NAME,
    vueJSChunkName = DEFAULT_VUE_JS_CHUNK_NAME,
    htmlFileId = FILE_TYPE.HTML,
    jsFileId = FILE_TYPE.JS,
    jsFileAfter = DEFAULT_JS_FILE_AFTER,
  } = config || {}

  const vueBasicComponentChunks: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure

    const templateLookup: { [key: string]: any } = {}
    const dataObject: Record<string, any> = {}
    const methodsObject: Record<string, any> = {}

    let templateContent = generateNodeSyntax(uidl.node, {
      templateLookup,
      dependencies,
      dataObject,
      methodsObject,
    })

    if (typeof templateContent === 'string') {
      const htmlNode = createHTMLNode('span')
      htmlUtils.addTextNode(htmlNode, templateContent)
      templateContent = htmlNode
    }

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
