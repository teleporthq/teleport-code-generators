import {
  ComponentPluginFactory,
  ComponentPlugin,
  UIDLElementNode,
  UIDLEventHandlerStatement,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import {
  ASTBuilders,
  createHTMLTemplateSyntax,
  HTMLTemplateGenerationParams,
  HTMLTemplateSyntax,
} from '@teleporthq/teleport-plugin-common'

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

    for (const prop of Object.values(propDefinitions)) {
      if (prop.type === 'func' && dependencies.Output === undefined) {
        dependencies.Output = ANGULAR_CORE_DEPENDENCY
        dependencies.EventEmitter = ANGULAR_CORE_DEPENDENCY
      }

      if (dependencies.Input === undefined) {
        dependencies.Input = ANGULAR_CORE_DEPENDENCY
      }

      if (prop.type === 'element' && dependencies.ContentChild === undefined) {
        dependencies.ContentChild = ANGULAR_CORE_DEPENDENCY
        dependencies.TemplateRef = ANGULAR_CORE_DEPENDENCY
      }
    }

    const templateLookup: { [key: string]: unknown } = {}
    const dataObject: Record<string, unknown> = {}
    const methodsObject: Record<string, UIDLEventHandlerStatement[]> = {}
    const templateParams: HTMLTemplateGenerationParams = {
      templateLookup,
      dependencies,
      dataObject,
      methodsObject,
      stateDefinitions,
      propDefinitions,
    }

    const templateSyntaxOptions: HTMLTemplateSyntax = {
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
      slotBinding: '#',
      slotTagName: 'ng-template',
    }

    /*
      We need to generate jsx structure of every node that is defined in the UIDL.
      If we use these nodes in the later stage of the code-generation depends on the usage of these nodes.
    */
    for (const propKey of Object.keys(propDefinitions)) {
      const prop = propDefinitions[propKey]
      if (
        prop.type === 'element' &&
        prop.defaultValue !== undefined &&
        typeof prop.defaultValue === 'object'
      ) {
        createHTMLTemplateSyntax(
          prop.defaultValue as UIDLElementNode,
          templateParams,
          templateSyntaxOptions
        )
      }
    }

    const templateContent = createHTMLTemplateSyntax(
      uidl.node,
      templateParams,
      templateSyntaxOptions
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
