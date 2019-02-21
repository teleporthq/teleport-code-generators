import { ComponentPlugin, ComponentPluginFactory } from '../../../types'
import { buildDefaultPropsAst, buildTypesOfPropsAst } from './utils'

interface ReactJSPropTypesConfig {
  componentChunkName?: string
  defaultPropsChunkName?: string
  typesOfPropsChunkName?: string
  exportComponentName?: string
}

export const createPlugin: ComponentPluginFactory<ReactJSPropTypesConfig> = (config) => {
  const {
    componentChunkName = 'react-component',
    defaultPropsChunkName = 'react-component-default-props',
    typesOfPropsChunkName = 'react-component-types-of-props',
    exportComponentName = 'export',
  } = config || {}

  const reactJSPropTypesChunkPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure
    const { name } = uidl

    const componentChunk = chunks.filter((chunk) => chunk.name === componentChunkName)[0]
    const exportChunk = chunks.filter((chunk) => chunk.name === exportComponentName)[0]

    if (!componentChunk) {
      throw new Error(
        `React component chunk with name ${componentChunkName} was required and not found.`
      )
    }

    if (!uidl.propDefinitions) {
      return structure
    }

    // TODO used the name from the mappings of the component, not from the UIDL
    const defaultPropsAst = buildDefaultPropsAst(name, uidl.propDefinitions)
    const typesOfPropsAst = buildTypesOfPropsAst(name, 'PropTypes', uidl.propDefinitions)

    if (!defaultPropsAst && !typesOfPropsAst) {
      return structure
    }

    dependencies.PropTypes = {
      type: 'library',
      path: 'prop-types',
    }

    chunks.push({
      type: 'js',
      name: defaultPropsChunkName,
      linker: {
        after: [componentChunkName],
      },
      content: defaultPropsAst,
    })

    chunks.push({
      type: 'js',
      name: typesOfPropsChunkName,
      linker: {
        after: [componentChunkName],
      },
      content: typesOfPropsAst,
    })

    // push export of component after declarations of types
    if (!exportChunk.linker) {
      exportChunk.linker = {}
    }

    if (!exportChunk.linker.after) {
      exportChunk.linker.after = []
    }

    exportChunk.linker.after.push(typesOfPropsChunkName, defaultPropsChunkName)

    return structure
  }

  return reactJSPropTypesChunkPlugin
}

export default createPlugin()
