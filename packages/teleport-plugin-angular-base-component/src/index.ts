import {
  ComponentPluginFactory,
  ComponentPlugin,
  UIDLElementNode,
  UIDLEventHandlerStatement,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import { ASTBuilders, createHTMLTemplateSyntax } from '@teleporthq/teleport-plugin-common'

import { generateExportAST } from './utils'

import {
  DEFAULT_TS_CHUNK_AFTER,
  ANGULAR_CORE_DEPENDENCY,
  ANGULAR_PLATFORM_BROWSER,
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

export const createAngularComponentPlugin: ComponentPluginFactory<AngularPluginConfig> = (
  config
) => {
  const {
    angularTemplateChunkName = DEFAULT_ANGULAR_TEMPLATE_CHUNK_NAME,
    exportClassChunk = DEFAULT_ANGULAR_TS_CHUNK_NAME,
    componentDecoratorChunkName = DEFAULT_ANGULAR_DECORATOR_CHUNK_NAME,
    tsChunkAfter = DEFAULT_TS_CHUNK_AFTER,
  } = config || {}

  const angularComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure
    const { seo = {}, stateDefinitions = {}, propDefinitions = {} } = uidl

    dependencies.Component = ANGULAR_CORE_DEPENDENCY

    if (seo.title) {
      dependencies.Title = ANGULAR_PLATFORM_BROWSER
    }

    if (seo.metaTags && seo.metaTags.length > 0) {
      dependencies.Meta = ANGULAR_PLATFORM_BROWSER
    }

    const props = Object.values(propDefinitions)
    if (props.length > 0) {
      const functionalProps = props.filter((prop) => prop.type === 'func')
      if (functionalProps.length > 0) {
        dependencies.Output = ANGULAR_CORE_DEPENDENCY
        dependencies.EventEmitter = ANGULAR_CORE_DEPENDENCY
      }
      if (props.length - functionalProps.length > 0) {
        dependencies.Input = ANGULAR_CORE_DEPENDENCY
      }
    }

    const templateLookup: { [key: string]: unknown } = {}
    const dataObject: Record<string, unknown> = {}
    const methodsObject: Record<string, UIDLEventHandlerStatement[]> = {}

    const templateContent = createHTMLTemplateSyntax(
      uidl.node,
      {
        templateLookup,
        dependencies,
        dataObject,
        methodsObject,
        stateDefinitions,
        propDefinitions,
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
        customElementTagName: (value) => UIDLUtils.createWebComponentFriendlyName(value),
        dependencyHandling: 'ignore',
        domHTMLInjection: `[innerHTML]`,
        slotBinding: 'slot',
        slotTagName: 'div',
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

    const componentName = UIDLUtils.getComponentClassName(uidl)
    const params = {
      selector: UIDLUtils.createWebComponentFriendlyName(componentName),
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
      uidl,
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

export default createAngularComponentPlugin()
