import { createClassDeclaration } from './utils'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import {
  createJSXSyntax,
  JSXGenerationOptions,
  ASTBuilders,
  ASTUtils,
} from '@teleporthq/teleport-plugin-common'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'

import {
  DEFAULT_COMPONENT_CHUNK_NAME,
  DEFAULT_IMPORT_CHUNK_NAME,
  DEFAULT_COMPONENT_DECORATOR_CHUNK_NAME,
  LIT_HTML_CORE_DEPENDENCY,
} from './constants'

interface StencilPluginConfig {
  componentChunkName: string
  componentDecoratorChunkName: string
  importChunkName: string
}

export const createStencilComponentPlugin: ComponentPluginFactory<StencilPluginConfig> = (
  config
) => {
  const {
    componentChunkName = DEFAULT_COMPONENT_CHUNK_NAME,
    componentDecoratorChunkName = DEFAULT_COMPONENT_DECORATOR_CHUNK_NAME,
    importChunkName = DEFAULT_IMPORT_CHUNK_NAME,
  } = config || {}

  const stencilComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, dependencies } = structure
    const { stateDefinitions = {}, propDefinitions = {} } = uidl

    dependencies.LitElement = LIT_HTML_CORE_DEPENDENCY
    dependencies.html = LIT_HTML_CORE_DEPENDENCY
    dependencies.property = LIT_HTML_CORE_DEPENDENCY
    dependencies.customElement = LIT_HTML_CORE_DEPENDENCY

    // We will keep a flat mapping object from each component identifier (from the UIDL) to its correspoding JSX AST Tag
    // This will help us inject style or classes at a later stage in the pipeline, upon traversing the UIDL
    // The structure will be populated as the AST is being created
    const nodesLookup = {}
    const jsxParams = {
      propDefinitions,
      stateDefinitions,
      nodesLookup,
      dependencies,
    }

    const jsxOptions: JSXGenerationOptions = {
      dynamicReferencePrefixMap: {
        prop: 'this',
        state: 'this',
        local: '',
      },
      dependencyHandling: 'ignore',
      stateHandling: 'mutation',
      slotHandling: 'native',
      customElementTag: (name: string) => UIDLUtils.createWebComponentFriendlyName(name),
    }

    const jsxTagStructure = createJSXSyntax(uidl.node, jsxParams, jsxOptions)

    if (uidl.seo && uidl.seo.title) {
      const titleAST = ASTBuilders.createSelfClosingJSXTag('stencil-route-title')
      ASTUtils.addAttributeToJSXTag(titleAST, 'pageTitle', uidl.seo.title)
      jsxTagStructure.children.unshift(titleAST)
    }

    const componentName = UIDLUtils.getComponentClassName(uidl)
    const exportAST = createClassDeclaration(
      componentName,
      propDefinitions,
      stateDefinitions,
      jsxTagStructure
    )

    const decoratorAST = ASTBuilders.createCustomElementDecorator(
      UIDLUtils.createWebComponentFriendlyName(componentName)
    )

    structure.chunks.push({
      type: ChunkType.AST,
      fileType: FileType.TS,
      name: componentDecoratorChunkName,
      meta: {
        nodesLookup,
      },
      content: decoratorAST,
      linkAfter: [importChunkName],
    })

    structure.chunks.push({
      type: ChunkType.AST,
      fileType: FileType.TS,
      name: componentChunkName,
      meta: {
        nodesLookup,
        dynamicRefPrefix: jsxOptions.dynamicReferencePrefixMap,
      },
      content: exportAST,
      linkAfter: [importChunkName],
    })

    return structure
  }

  return stencilComponentPlugin
}

export default createStencilComponentPlugin()
