import createHTMLTemplateSyntax from '@teleporthq/teleport-shared/dist/cjs/node-handlers/node-to-html'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { FILE_TYPE, CHUNK_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import { getComponentFileName } from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'

import { generateExportAST, generateComponentDecorator } from './utils'

import {
  DEFAULT_ANGULAR_TEMPLATE_CHUNK_NAME,
  DEFAULT_ANGULAR_TS_CHUNK_NAME,
  ANGULAR_CORE_DEPENDENCY,
  DEFAULT_TS_CHUNK_AFTER,
} from './constants'

interface AngularPluginConfig {
  angularTemplateChunkName: string
  angularComponentChunkName: string
  tsChukAfter: string[]
}

export const createPlugin: ComponentPluginFactory<AngularPluginConfig> = (config) => {
  const {
    angularTemplateChunkName = DEFAULT_ANGULAR_TEMPLATE_CHUNK_NAME,
    angularComponentChunkName = DEFAULT_ANGULAR_TS_CHUNK_NAME,
    tsChukAfter = DEFAULT_TS_CHUNK_AFTER,
  } = config || {}

  const angularComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure
    const { stateDefinitions = {}, propDefinitions = {} } = uidl
    const fileName = getComponentFileName(uidl)

    dependencies.Component = ANGULAR_CORE_DEPENDENCY

    if (Object.keys(propDefinitions).length > 0) {
      dependencies.Input = ANGULAR_CORE_DEPENDENCY
    }

    const templateLookup: { [key: string]: any } = {}
    const dataObject: Record<string, any> = {}
    const methodsObject: Record<string, any> = {}

    const templateContent = createHTMLTemplateSyntax(
      uidl.node,
      {
        templateLookup,
        dependencies,
        dataObject,
        methodsObject,
      },
      {
        interpolation: (value) => `{{ ${value} }}`,
        eventBinding: (value) => `${value}`,
        valueBinding: (value) => `[${value}]`,
        eventEmmitter: (value) => `this.$emit('${value}')`,
        conditionalAttr: '*ngIf',
        repeatAttr: '*ngFor',
        repeatIterator: (iteratorName, iteratedCollection, useIndex) => {
          const index = useIndex ? `; index as i` : ''
          return `let ${iteratorName} of ${iteratedCollection}${index}`
        },
        noValueBindingWithRepeat: true,
      }
    )

    chunks.push({
      type: CHUNK_TYPE.HAST,
      name: angularTemplateChunkName,
      fileType: FILE_TYPE.HTML,
      meta: {
        nodesLookup: templateLookup,
      },
      content: templateContent,
      linkAfter: [],
    })

    const componentDecorator = generateComponentDecorator(fileName)

    chunks.push({
      type: CHUNK_TYPE.AST,
      name: angularComponentChunkName,
      fileType: FILE_TYPE.TS,
      linkAfter: tsChukAfter,
      content: componentDecorator,
    })

    const exportAST = generateExportAST(uidl.name, propDefinitions, stateDefinitions)

    chunks.push({
      type: CHUNK_TYPE.AST,
      name: angularComponentChunkName,
      fileType: FILE_TYPE.TS,
      linkAfter: tsChukAfter,
      content: exportAST,
    })

    return structure
  }

  return angularComponentPlugin
}
export default createPlugin()
