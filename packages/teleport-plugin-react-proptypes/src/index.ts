import { buildDefaultPropsAst, buildTypesOfPropsAst } from './utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

interface ReactJSPropTypesConfig {
  componentChunkName?: string
  defaultPropsChunkName?: string
  typesOfPropsChunkName?: string
  exportComponentName?: string
}

export const createPlugin: ComponentPluginFactory<ReactJSPropTypesConfig> = (config) => {
  const {
    componentChunkName = 'jsx-component',
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
    const hasDefaultProps = Object.keys(uidl.propDefinitions).some(
      (prop) => typeof uidl.propDefinitions[prop].defaultValue !== 'undefined'
    )

    const typesOfPropsAst = buildTypesOfPropsAst(name, 'PropTypes', uidl.propDefinitions)

    if (!hasDefaultProps && !typesOfPropsAst) {
      return structure
    }

    dependencies.PropTypes = {
      type: 'library',
      path: 'prop-types',
      version: '15.7.2',
    }

    if (hasDefaultProps) {
      const defaultPropsAst = buildDefaultPropsAst(name, uidl.propDefinitions)
      chunks.push({
        type: CHUNK_TYPE.AST,
        fileType: FILE_TYPE.JS,
        name: defaultPropsChunkName,
        linkAfter: [componentChunkName],
        content: defaultPropsAst,
      })
      exportChunk.linkAfter.push(defaultPropsChunkName)
    }

    chunks.push({
      type: CHUNK_TYPE.AST,
      fileType: FILE_TYPE.JS,
      name: typesOfPropsChunkName,
      linkAfter: [componentChunkName],
      content: typesOfPropsAst,
    })

    // push export of component after declarations of types
    exportChunk.linkAfter.push(typesOfPropsChunkName)

    return structure
  }

  return reactJSPropTypesChunkPlugin
}

export default createPlugin()
