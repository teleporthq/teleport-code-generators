import { createDOMInjectionNode } from './utils'
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
  DEFAULT_EXPORT_CHUNK_NAME,
  DEFAULT_IMPORT_CHUNK_NAME,
  USE_STATE_DEPENDENCY,
  PREACTJSX_PRAGMA_DEPENDENCY,
} from './constants'

interface PreactPluginConfig {
  componentChunkName: string
  exportChunkName: string
  importChunkName: string
}

export const createPreactComponentPlugin: ComponentPluginFactory<PreactPluginConfig> = (config) => {
  const {
    componentChunkName = DEFAULT_COMPONENT_CHUNK_NAME,
    exportChunkName = DEFAULT_EXPORT_CHUNK_NAME,
    importChunkName = DEFAULT_IMPORT_CHUNK_NAME,
  } = config || {}

  const preactComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, dependencies } = structure
    const { stateDefinitions = {}, propDefinitions = {} } = uidl
    dependencies.h = PREACTJSX_PRAGMA_DEPENDENCY

    if (Object.keys(stateDefinitions).length > 0) {
      dependencies.useState = USE_STATE_DEPENDENCY
    }

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
        prop: 'props',
        state: '',
        local: '',
      },
      dependencyHandling: 'import',
      stateHandling: 'hooks',
      slotHandling: 'props',
      domHTMLInjection: (content: string) => createDOMInjectionNode(content),
    }

    const jsxTagStructure = createJSXSyntax(uidl.node, jsxParams, jsxOptions)

    const componentName = UIDLUtils.getComponentClassName(uidl)
    const preactComponent = ASTUtils.createPureComponent(
      componentName,
      stateDefinitions,
      propDefinitions,
      jsxTagStructure
    )

    structure.chunks.push({
      type: ChunkType.AST,
      fileType: FileType.JS,
      name: componentChunkName,
      meta: {
        nodesLookup,
        dynamicRefPrefix: jsxOptions.dynamicReferencePrefixMap,
      },
      content: preactComponent,
      linkAfter: [importChunkName],
    })

    structure.chunks.push({
      type: ChunkType.AST,
      fileType: FileType.JS,
      name: exportChunkName,
      content: ASTBuilders.createDefaultExport(componentName),
      linkAfter: [componentChunkName],
    })

    return structure
  }

  return preactComponentPlugin
}

export default createPreactComponentPlugin()
