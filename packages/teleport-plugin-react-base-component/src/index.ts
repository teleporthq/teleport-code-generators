import * as types from '@babel/types'
import { makeDefaultExport } from '@teleporthq/teleport-shared/lib/utils/ast-js-utils'
import { makePureComponent, generateNodeSyntax, createStateIdentifiers } from './utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'

interface JSXConfig {
  componentChunkName: string
  exportChunkName: string
  importChunkName: string
}

export const ERROR_LOG_NAME = `react-base-component`

export const createPlugin: ComponentPluginFactory<JSXConfig> = (config) => {
  const {
    componentChunkName = 'react-component',
    exportChunkName = 'export',
    importChunkName = 'import-local',
  } = config || {}

  const reactComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, dependencies } = structure

    dependencies.React = {
      type: 'library',
      path: 'react',
      version: '16.8.3',
    }

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

    pureComponent = makePureComponent(uidl.name, stateIdentifiers, jsxTagStructure, uidl.node.type)

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
