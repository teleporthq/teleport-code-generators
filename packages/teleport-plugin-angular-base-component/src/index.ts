import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { FILE_TYPE } from '@teleporthq/teleport-shared/lib/constants'
import * as htmlUtils from '@teleporthq/teleport-shared/lib/utils/html-utils'
import { createHTMLNode } from '@teleporthq/teleport-shared/lib/builders/html-builders'

import {
  DEFAULT_ANGULAR_TEMPLATE_CHUNK_NAME,
  COMPONENT_DEPENDENCY,
  DEFAULT_ANGULAR_TS_CHUNK_NAME,
  DEFAULT_TS_FILE_AFTER,
} from './constants'
import { generateNodeSyntax, generateAngularComponentTS, extractStateObject } from './utils'

interface AngularComponentConfig {
  angularTemplateChunkName: string
  angularTSChunkName: string
  htmlFileId: string
  tsFileId: string
  tsFIlesAfter: string[]
}

export const createPlugin: ComponentPluginFactory<AngularComponentConfig> = (config) => {
  const {
    angularTemplateChunkName = DEFAULT_ANGULAR_TEMPLATE_CHUNK_NAME,
    angularTSChunkName = DEFAULT_ANGULAR_TS_CHUNK_NAME,
    htmlFileId = FILE_TYPE.HTML,
    tsFileId = FILE_TYPE.TS,
    tsFIlesAfter = DEFAULT_TS_FILE_AFTER,
  } = config || {}

  const angularBasicComponentChunks: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure

    dependencies.Component = COMPONENT_DEPENDENCY

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
      name: angularTemplateChunkName,
      meta: {
        lookup: templateLookup,
        fileId: htmlFileId,
      },
      content: templateContent,
      linkAfter: [],
    })

    const stateObject = uidl.stateDefinitions ? extractStateObject(uidl.stateDefinitions) : {}
    const jsContent = generateAngularComponentTS(
      uidl,
      {
        ...stateObject,
        ...dataObject,
      },
      methodsObject,
      dependencies
    )

    chunks.push({
      type: 'ts',
      name: angularTSChunkName,
      meta: {
        fileId: tsFileId,
      },
      content: jsContent,
      linkAfter: tsFIlesAfter,
    })

    return structure
  }

  return angularBasicComponentChunks
}

export default createPlugin()
