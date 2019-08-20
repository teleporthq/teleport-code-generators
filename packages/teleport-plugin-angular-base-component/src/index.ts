import createHTMLTemplateSyntax from '@teleporthq/teleport-shared/dist/cjs/node-handlers/node-to-html'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  UIDLElementNode,
} from '@teleporthq/teleport-types'
import { FILE_TYPE, CHUNK_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import { createComponentDecorator } from '@teleporthq/teleport-shared/dist/cjs/utils/ast-jsx-utils'
import { getComponentFileName } from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'

import { generateExportAST } from './utils'

import {
  DEFAULT_TS_CHUNK_AFTER,
  ANGULAR_CORE_DEPENDENCY,
  DEFAULT_ANGULAR_TS_CHUNK_NAME,
  DEFAULT_ANGULAR_TEMPLATE_CHUNK_NAME,
  DEFAULT_ANGULAR_DECORATOR_CHUNK_NAME,
} from './constants'

interface AngularPluginConfig {
  angularTemplateChunkName: string
  exportClassChunk: string
  componentDecoratorChunkName: string
  tsChunkAfter: string[]
}

export const createPlugin: ComponentPluginFactory<AngularPluginConfig> = (config) => {
  const {
    angularTemplateChunkName = DEFAULT_ANGULAR_TEMPLATE_CHUNK_NAME,
    exportClassChunk = DEFAULT_ANGULAR_TS_CHUNK_NAME,
    componentDecoratorChunkName = DEFAULT_ANGULAR_DECORATOR_CHUNK_NAME,
    tsChunkAfter = DEFAULT_TS_CHUNK_AFTER,
  } = config || {}

  const angularComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure
    const { stateDefinitions = {}, propDefinitions = {} } = uidl

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
        eventBinding: (value) => `(${value})`,
        valueBinding: (value, node?: UIDLElementNode) =>
          node && node.content.dependency ? `[${value}]` : `[attr.${value}]`,
        eventEmmitter: (value) => `this.$emit('${value}')`,
        conditionalAttr: '*ngIf',
        repeatAttr: '*ngFor',
        repeatIterator: (iteratorName, iteratedCollection, useIndex) => {
          const index = useIndex ? `; index as i` : ''
          return `let ${iteratorName} of ${iteratedCollection}${index}`
        },
        customElementTagName: (value) => `app-${value}`,
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

    const params = {
      selector: 'app-root',
      templateUrl: `${getComponentFileName(uidl)}.${FILE_TYPE.HTML}`,
    }
    const componentDecoratorAST = createComponentDecorator(params)

    chunks.push({
      type: CHUNK_TYPE.AST,
      name: componentDecoratorChunkName,
      fileType: FILE_TYPE.TS,
      linkAfter: tsChunkAfter,
      content: componentDecoratorAST,
    })

    const exportAST = generateExportAST(uidl.name, propDefinitions, stateDefinitions, dataObject)

    chunks.push({
      type: CHUNK_TYPE.AST,
      name: exportClassChunk,
      fileType: FILE_TYPE.TS,
      linkAfter: tsChunkAfter,
      content: exportAST,
    })

    return structure
  }

  return angularComponentPlugin
}
export default createPlugin()
