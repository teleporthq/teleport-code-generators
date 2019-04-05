import * as types from '@babel/types'
import { makeDefaultExport } from '../../shared/utils/ast-js-utils'
import { makePureComponent, generateNodeSyntax, createStateIdentifiers } from './utils'
import { ComponentPluginFactory, ComponentPlugin } from '../../typings/generators'

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

    const jsxTagStructure = generateNodeSyntax(uidl.node, {
      propDefinitions: uidl.propDefinitions || {},
      stateIdentifiers,
      nodesLookup,
      dependencies,
    }) as types.JSXElement

    const pureComponent = makePureComponent(uidl.name, stateIdentifiers, jsxTagStructure)

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
