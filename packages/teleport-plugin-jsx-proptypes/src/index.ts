import { buildDefaultPropsAst, buildTypesOfPropsAst } from './utils'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { UIDLUtils } from '@teleporthq/teleport-shared'

interface PropTypesConfig {
  componentChunkName?: string
  defaultPropsChunkName?: string
  typesOfPropsChunkName?: string
  exportComponentName?: string
}

export const createPropTypesPlugin: ComponentPluginFactory<PropTypesConfig> = (config) => {
  const {
    componentChunkName = 'jsx-component',
    defaultPropsChunkName = 'component-default-props',
    typesOfPropsChunkName = 'component-types-of-props',
    exportComponentName = 'export',
  } = config || {}

  const propTypesPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure

    const componentClassName = UIDLUtils.getComponentClassName(uidl)
    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    const exportChunk = chunks.find((chunk) => chunk.name === exportComponentName)

    if (!componentChunk) {
      throw new Error(
        `JSX component chunk with name ${componentChunkName} was required and not found.`
      )
    }

    if (!uidl.propDefinitions) {
      return structure
    }

    // TODO used the name from the mappings of the component, not from the UIDL
    const hasDefaultProps = Object.keys(uidl.propDefinitions).some(
      (prop) => typeof uidl.propDefinitions[prop].defaultValue !== 'undefined'
    )

    const typesOfPropsAst = buildTypesOfPropsAst(
      componentClassName,
      'PropTypes',
      uidl.propDefinitions
    )

    if (!hasDefaultProps && !typesOfPropsAst) {
      return structure
    }

    dependencies.PropTypes = {
      type: 'package',
      path: 'prop-types',
      version: '15.7.2',
    }

    if (hasDefaultProps) {
      const defaultPropsAst = buildDefaultPropsAst(componentClassName, uidl.propDefinitions)
      chunks.push({
        type: ChunkType.AST,
        fileType: FileType.JS,
        name: defaultPropsChunkName,
        linkAfter: [componentChunkName],
        content: defaultPropsAst,
      })
      exportChunk.linkAfter.push(defaultPropsChunkName)
    }

    chunks.push({
      type: ChunkType.AST,
      fileType: FileType.JS,
      name: typesOfPropsChunkName,
      linkAfter: [componentChunkName],
      content: typesOfPropsAst,
    })

    // push export of component after declarations of types
    exportChunk.linkAfter.push(typesOfPropsChunkName)

    return structure
  }

  return propTypesPlugin
}

export default createPropTypesPlugin()
