import * as types from '@babel/types'
import { makeDefaultExport } from '@teleporthq/teleport-shared/lib/utils/ast-js-utils'
import { createPureComponent, createStateIdentifiers } from './utils'
import { generateNodeSyntax } from './node-handlers'

import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { JSXConfig } from './types'
import {
  DEFAULT_COMPONENT_CHUNK_NAME,
  DEFAULT_EXPORT_CHUNK_NAME,
  DEFAULT_IMPORT_CHUNK_NAME,
  REACT_LIBRARY_DEPENDENCY,
} from './constants'

export const createPlugin: ComponentPluginFactory<JSXConfig> = (config) => {
  const {
    componentChunkName = DEFAULT_COMPONENT_CHUNK_NAME,
    exportChunkName = DEFAULT_EXPORT_CHUNK_NAME,
    importChunkName = DEFAULT_IMPORT_CHUNK_NAME,
  } = config || {}

  const reactComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, dependencies } = structure

    dependencies.React = REACT_LIBRARY_DEPENDENCY

    const stateIdentifiers = uidl.stateDefinitions
      ? createStateIdentifiers(uidl.stateDefinitions, dependencies)
      : {}

    // We will keep a flat mapping object from each component identifier (from the UIDL) to its correspoding JSX AST Tag
    // This will help us inject style or classes at a later stage in the pipeline, upon traversing the UIDL
    // The structure will be populated as the AST is being created
    const nodesLookup = {}
    const accumulators = {
      propDefinitions: uidl.propDefinitions || {},
      stateIdentifiers,
      nodesLookup,
      dependencies,
    }
    let pureComponent: types.VariableDeclaration

    const jsxTagStructure = generateNodeSyntax(uidl.node, accumulators)

    pureComponent = createPureComponent(
      uidl.name,
      stateIdentifiers,
      jsxTagStructure,
      uidl.node.type
    )

    structure.chunks.push({
      type: 'js',
      name: componentChunkName,
      meta: {
        nodesLookup,
      },
      content: pureComponent,
      linkAfter: [importChunkName],
    })

    structure.chunks.push({
      type: 'js',
      name: exportChunkName,
      content: makeDefaultExport(uidl.name),
      linkAfter: [componentChunkName],
    })

    return structure
  }

  return reactComponentPlugin
}

export default createPlugin()
