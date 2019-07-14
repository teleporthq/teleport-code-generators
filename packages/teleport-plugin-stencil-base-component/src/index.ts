import { createClassDeclaration } from './utils'
import { generateNodeSyntax } from './node-handlers'

import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { JSXConfig } from './types'

import {
  DEFAULT_COMPONENT_CHUNK_NAME,
  DEFAULT_IMPORT_CHUNK_NAME,
  STENCIL_CORE_DEPENDENCY,
} from './constants'

export const createPlugin: ComponentPluginFactory<JSXConfig> = (config) => {
  const {
    componentChunkName = DEFAULT_COMPONENT_CHUNK_NAME,
    importChunkName = DEFAULT_IMPORT_CHUNK_NAME,
  } = config || {}

  const stencilComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, dependencies } = structure
    const { stateDefinitions = {}, propDefinitions = {} } = uidl

    dependencies.Component = STENCIL_CORE_DEPENDENCY
    dependencies.h = STENCIL_CORE_DEPENDENCY

    if (Object.keys(propDefinitions).length) {
      dependencies.Prop = STENCIL_CORE_DEPENDENCY
    }

    if (Object.keys(stateDefinitions).length) {
      dependencies.State = STENCIL_CORE_DEPENDENCY
    }

    // We will keep a flat mapping object from each component identifier (from the UIDL) to its correspoding JSX AST Tag
    // This will help us inject style or classes at a later stage in the pipeline, upon traversing the UIDL
    // The structure will be populated as the AST is being created
    const nodesLookup = {}
    const accumulators = {
      propDefinitions,
      stateDefinitions,
      nodesLookup,
      dependencies,
    }

    const jsxTagStructure = generateNodeSyntax(uidl.node, accumulators)
    const classComponentAST = createClassDeclaration(
      uidl.name,
      propDefinitions,
      stateDefinitions,
      jsxTagStructure,
      uidl.node.type
    )

    structure.chunks.push({
      type: 'js',
      name: componentChunkName,
      meta: {
        nodesLookup,
      },
      content: classComponentAST,
      linkAfter: [importChunkName],
    })

    return structure
  }

  return stencilComponentPlugin
}

export default createPlugin()
