import { createPureComponent } from './utils'
import { createJSXSyntax, JSXGenerationOptions, ASTBuilders } from '@teleporthq/teleport-shared'

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
  REACT_LIBRARY_DEPENDENCY,
  USE_STATE_DEPENDENCY,
} from './constants'

interface ReactPluginConfig {
  componentChunkName: string
  exportChunkName: string
  importChunkName: string
}

export const createReactComponentPlugin: ComponentPluginFactory<ReactPluginConfig> = (config) => {
  const {
    componentChunkName = DEFAULT_COMPONENT_CHUNK_NAME,
    exportChunkName = DEFAULT_EXPORT_CHUNK_NAME,
    importChunkName = DEFAULT_IMPORT_CHUNK_NAME,
  } = config || {}

  const reactComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, dependencies } = structure
    const { stateDefinitions = {}, propDefinitions = {} } = uidl

    dependencies.React = REACT_LIBRARY_DEPENDENCY

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
    }

    const jsxTagStructure = createJSXSyntax(uidl.node, jsxParams, jsxOptions)

    const pureComponent = createPureComponent(uidl.name, stateDefinitions, jsxTagStructure)

    structure.chunks.push({
      type: ChunkType.AST,
      fileType: FileType.JS,
      name: componentChunkName,
      meta: {
        nodesLookup,
        dynamicRefPrefix: jsxOptions.dynamicReferencePrefixMap,
      },
      content: pureComponent,
      linkAfter: [importChunkName],
    })

    structure.chunks.push({
      type: ChunkType.AST,
      fileType: FileType.JS,
      name: exportChunkName,
      content: ASTBuilders.createDefaultExport(uidl.name),
      linkAfter: [componentChunkName],
    })

    return structure
  }

  return reactComponentPlugin
}

export default createReactComponentPlugin()
