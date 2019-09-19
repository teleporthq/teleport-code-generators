import {
  ComponentPluginFactory,
  ComponentPlugin,
  UIDLElementNode,
  UIDLEventHandlerStatement,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import {
  ASTBuilders,
  UIDLUtils,
  StringUtils,
  createHTMLTemplateSyntax,
} from '@teleporthq/teleport-shared'

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
    const methodsObject: Record<string, UIDLEventHandlerStatement[]> = {}

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
        eventHandlersBindingMode: (value) => `${value}()`,
        valueBinding: (value, node?: UIDLElementNode) =>
          node && node.content.dependency ? `[${value}]` : `[attr.${value}]`,
        eventEmmitter: (value) => `this.$emit('${value}')`,
        conditionalAttr: '*ngIf',
        repeatAttr: '*ngFor',
        repeatIterator: (iteratorName, iteratedCollection, useIndex) => {
          const index = useIndex ? `; index as index` : ''
          return `let ${iteratorName} of ${iteratedCollection}${index}`
        },
        customElementTagName: (value) => `app-${value}`,
        dependencyHandling: 'ignore',
      }
    )

    chunks.push({
      type: ChunkType.HAST,
      name: angularTemplateChunkName,
      fileType: FileType.HTML,
      meta: {
        nodesLookup: templateLookup,
      },
      content: templateContent,
      linkAfter: [],
    })

    const params = {
      selector: `app-${StringUtils.camelCaseToDashCase(uidl.name)}`,
      templateUrl: `${UIDLUtils.getComponentFileName(uidl)}.${FileType.HTML}`,
    }
    const componentDecoratorAST = ASTBuilders.createComponentDecorator(params)

    chunks.push({
      type: ChunkType.AST,
      name: componentDecoratorChunkName,
      fileType: FileType.TS,
      linkAfter: tsChunkAfter,
      content: componentDecoratorAST,
    })

    /* We need to import EventEmitter and Output in Angular to temit events to the parent
    So, to make sure if we need to import them we need to loop through all the methods and
    check if any of them are referring to the function that is passed as prop*/
    if (Object.keys(methodsObject).length > 0) {
      const shouldImportEventEmitter = Object.keys(methodsObject).some((method) => {
        const statements = methodsObject[method]
        if (statements.length > 0) {
          return statements.some((event) => event.type === 'propCall')
        }
        return false
      })
      if (shouldImportEventEmitter) {
        dependencies.Output = ANGULAR_CORE_DEPENDENCY
        dependencies.EventEmitter = ANGULAR_CORE_DEPENDENCY
      }
    }

    const exportAST = generateExportAST(
      uidl.name,
      propDefinitions,
      stateDefinitions,
      dataObject,
      methodsObject
    )

    chunks.push({
      type: ChunkType.AST,
      name: exportClassChunk,
      fileType: FileType.TS,
      linkAfter: tsChunkAfter,
      content: exportAST,
    })

    return structure
  }

  return angularComponentPlugin
}
export default createPlugin()
