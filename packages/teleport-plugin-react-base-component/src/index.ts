import { createDefaultExport } from '@teleporthq/teleport-shared/dist/cjs/builders/ast-builders'

import { createPureComponent } from './utils'
import createJSXSyntax from '@teleporthq/teleport-shared/dist/cjs/node-handlers/node-to-jsx'

import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'

import {
  DEFAULT_COMPONENT_CHUNK_NAME,
  DEFAULT_EXPORT_CHUNK_NAME,
  DEFAULT_IMPORT_CHUNK_NAME,
  REACT_LIBRARY_DEPENDENCY,
  USE_STATE_DEPENDENCY,
} from './constants'
import { JSXGenerationOptions } from '@teleporthq/teleport-shared/dist/cjs/node-handlers/node-to-jsx/types'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

interface ReactPluginConfig {
  componentChunkName: string
  exportChunkName: string
  importChunkName: string
}

export const createPlugin: ComponentPluginFactory<ReactPluginConfig> = (config) => {
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
      type: CHUNK_TYPE.AST,
      fileType: FILE_TYPE.JS,
      name: componentChunkName,
      meta: {
        nodesLookup,
        dynamicRefPrefix: jsxOptions.dynamicReferencePrefixMap,
      },
      content: pureComponent,
      linkAfter: [importChunkName],
    })

    structure.chunks.push({
      type: CHUNK_TYPE.AST,
      fileType: FILE_TYPE.JS,
      name: exportChunkName,
      content: createDefaultExport(uidl.name),
      linkAfter: [componentChunkName],
    })

    return structure
  }

  return reactComponentPlugin
}

export default createPlugin()
