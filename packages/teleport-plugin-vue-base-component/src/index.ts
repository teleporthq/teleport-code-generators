import { generateVueComponentJS, generateNodeSyntax, extractStateObject } from './utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { FILE_TYPE, CHUNK_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import * as htmlUtils from '@teleporthq/teleport-shared/dist/cjs/utils/html-utils'
import { createHTMLNode } from '@teleporthq/teleport-shared/dist/cjs/builders/html-builders'

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
      type: CHUNK_TYPE.HAST,
      name: vueTemplateChunkName,
      fileId: htmlFileId,
      meta: {
        nodesLookup: templateLookup,
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
      type: CHUNK_TYPE.AST,
      name: vueJSChunkName,
      fileId: jsFileId,
      linkAfter: jsFileAfter,
      content: jsContent,
    })

    return structure
  }

  return vueBasicComponentChunks
}

export default createPlugin()
