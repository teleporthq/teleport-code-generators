import { createClassComponent, createPureComponent } from './utils'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import {
  createJSXSyntax,
  JSXGenerationOptions,
  ASTBuilders,
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
  PREACT_COMPONENT_DEPENDENCY,
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

    const usePureComponent = Object.keys(stateDefinitions).length === 0

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
        state: 'state',
        local: '',
      },
      dependencyHandling: 'import',
      stateHandling: 'function',
      slotHandling: 'props',
    }

    const jsxTagStructure = createJSXSyntax(uidl.node, jsxParams, jsxOptions)

    if (!usePureComponent) {
      dependencies.Component = PREACT_COMPONENT_DEPENDENCY
    }

    const componentName = UIDLUtils.getComponentClassName(uidl)
    const preactComponent = usePureComponent
      ? createPureComponent(componentName, propDefinitions, jsxTagStructure)
      : createClassComponent(componentName, propDefinitions, stateDefinitions, jsxTagStructure)

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
