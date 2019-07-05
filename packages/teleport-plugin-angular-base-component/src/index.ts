import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { FILE_TYPE } from '@teleporthq/teleport-shared/lib/constants'
import * as htmlUtils from '@teleporthq/teleport-shared/lib/utils/html-utils'
import { createHTMLNode } from '@teleporthq/teleport-shared/lib/builders/html-builders'
import * as ts from 'typescript'

import { DEFAULT_ANGULAR_TEMPLATE_CHUNK_NAME } from './constants'

interface AngularComponentConfig {
  angularTemplateChunkName: string
  htmlFileId: string
}

export const createPlugin: ComponentPluginFactory<AngularComponentConfig> = (config) => {
  const {
    angularTemplateChunkName = DEFAULT_ANGULAR_TEMPLATE_CHUNK_NAME,
    htmlFileId = FILE_TYPE.HTML,
  } = config || {}

  const angularBasicComponentChunks: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure

    const templateLookup: { [key: string]: any } = {}
    const dataObject: Record<string, any> = {}
    const methodsObject: Record<string, any> = {}

    let templateContent = 'Welcome to Angular, from Teleport'

    if (typeof templateContent === 'string') {
      const htmlNode = createHTMLNode('span')
      htmlUtils.addTextNode(htmlNode, templateContent)
      templateContent = htmlNode
    }

    chunks.push({
      type: 'html',
      name: angularTemplateChunkName,
      meta: {
        fileId: htmlFileId,
      },
      content: templateContent,
      linkAfter: [],
    })

    return structure
  }

  return angularBasicComponentChunks
}

export default createPlugin()
