import { createDefaultExport } from '@teleporthq/teleport-shared/dist/cjs/builders/ast-builders'

import { createClassComponent, createPureComponent } from './utils'
import createJSXSyntax from '@teleporthq/teleport-shared/dist/cjs/node-handlers/node-to-jsx'

import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'

import {
  DEFAULT_COMPONENT_CHUNK_NAME,
  DEFAULT_EXPORT_CHUNK_NAME,
  DEFAULT_IMPORT_CHUNK_NAME,
  PREACT_COMPONENT_DEPENDENCY,
} from './constants'
import { JSXGenerationOptions } from '@teleporthq/teleport-shared/dist/cjs/node-handlers/node-to-jsx/types'

interface ReactChunkConfig {
  componentChunkName: string
  exportChunkName: string
  importChunkName: string
}

export const createPlugin: ComponentPluginFactory<ReactChunkConfig> = (config) => {
  const {
    componentChunkName = DEFAULT_COMPONENT_CHUNK_NAME,
    exportChunkName = DEFAULT_EXPORT_CHUNK_NAME,
    importChunkName = DEFAULT_IMPORT_CHUNK_NAME,
  } = config || {}

  const reactComponentPlugin: ComponentPlugin = async (structure) => {
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
      useHooks: false,
    }

    const jsxTagStructure = createJSXSyntax(uidl.node, jsxParams, jsxOptions)

    if (!usePureComponent) {
      dependencies.Component = PREACT_COMPONENT_DEPENDENCY
    }

    const preactComponent = usePureComponent
      ? createPureComponent(uidl.name, propDefinitions, jsxTagStructure)
      : createClassComponent(uidl.name, propDefinitions, stateDefinitions, jsxTagStructure)

    structure.chunks.push({
      type: 'js',
      name: componentChunkName,
      meta: {
        nodesLookup,
        dynamicRefPrefix: jsxOptions.dynamicReferencePrefixMap,
      },
      content: preactComponent,
      linkAfter: [importChunkName],
    })

    structure.chunks.push({
      type: 'js',
      name: exportChunkName,
      content: createDefaultExport(uidl.name),
      linkAfter: [componentChunkName],
    })

    return structure
  }

  return reactComponentPlugin
}

export default createPlugin()
