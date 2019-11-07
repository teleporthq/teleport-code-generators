import * as t from '@babel/types'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { DEFAULT_IMPORT_CHUNK_NAME, DEFAULT_EXPORT_CHUNK_NAME } from './constants'
import { StringUtils } from '@teleporthq/teleport-shared'

interface ComponentsExportConfig {
  exportChunkName: string
  importChunkName: string
}

export const createExportComponentsPlugin: ComponentPluginFactory<ComponentsExportConfig> = (
  config
) => {
  const {
    exportChunkName = DEFAULT_EXPORT_CHUNK_NAME,
    importChunkName = DEFAULT_IMPORT_CHUNK_NAME,
  } = config || {}

  const componentExportGenerator: ComponentPlugin = async (structure) => {
    const { chunks, options } = structure
    const { components } = options
    let importsAST = []

    if (Object.keys(components).length === 0) {
      throw new Error('No Components Found while running, teleport-plugin-export-components')
    }

    importsAST = Object.keys(components).map((component) => {
      return t.importDeclaration(
        [t.importDefaultSpecifier(t.identifier(StringUtils.capitalize(component)))],
        t.stringLiteral(`./${StringUtils.camelCaseToDashCase(component)}`)
      )
    })

    let exportSpecifiers = []
    exportSpecifiers = Object.keys(components).map((component) =>
      t.exportSpecifier(
        t.identifier(StringUtils.capitalize(component)),
        t.identifier(StringUtils.capitalize(component))
      )
    )
    const exportAST = t.exportNamedDeclaration(null, exportSpecifiers)

    chunks.push({
      name: importChunkName,
      type: ChunkType.AST,
      fileType: FileType.JS,
      content: importsAST,
      linkAfter: [],
    })

    chunks.push({
      name: exportChunkName,
      type: ChunkType.AST,
      fileType: FileType.JS,
      content: exportAST,
      linkAfter: [importChunkName],
    })

    return structure
  }

  return componentExportGenerator
}

export default createExportComponentsPlugin()
