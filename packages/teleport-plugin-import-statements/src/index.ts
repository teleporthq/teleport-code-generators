import { createGenericImportStatement } from '@teleporthq/teleport-shared/dist/cjs/builders/ast-builders'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkDefinition,
  ComponentDependency,
  ImportIdentifier,
} from '@teleporthq/teleport-types'
import { FILE_TYPE, CHUNK_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

interface ImportPluginConfig {
  importLibsChunkName?: string
  importPackagesChunkName?: string
  importLocalsChunkName?: string
}

export const createPlugin: ComponentPluginFactory<ImportPluginConfig> = (config) => {
  const {
    importLibsChunkName = 'import-lib',
    importPackagesChunkName = 'import-pack',
    importLocalsChunkName = 'import-local',
    fileType = FILE_TYPE.JS,
  } = config || {}

  const importPlugin: ComponentPlugin = async (structure) => {
    const { dependencies } = structure

    const libraryDependencies = groupDependenciesByPackage(dependencies, 'library')
    const packageDependencies = groupDependenciesByPackage(dependencies, 'package')
    const localDependencies = groupDependenciesByPackage(dependencies, 'local')
    addImportChunk(structure.chunks, libraryDependencies, importLibsChunkName, fileType)
    addImportChunk(structure.chunks, packageDependencies, importPackagesChunkName, fileType)
    addImportChunk(structure.chunks, localDependencies, importLocalsChunkName, fileType)
    return structure
  }

  return importPlugin
}

export default createPlugin()

const groupDependenciesByPackage = (
  dependencies: Record<string, ComponentDependency>,
  packageType?: string
) => {
  const result: Record<string, ImportIdentifier[]> = {}

  Object.keys(dependencies)
    .filter((key) => (packageType && dependencies[key].type === packageType) || !packageType)
    .forEach((key) => {
      const dep = dependencies[key]

      // Should not be the case at this point
      if (!dep.path) {
        return
      }

      if (!result[dep.path]) {
        result[dep.path] = [] // Initialize the dependencies from this path
      }

      const importJustPath = (dep.meta && dep.meta.importJustPath) || false
      const namedImport = !!(dep.meta && dep.meta.namedImport)
      const originalName = dep.meta && dep.meta.originalName ? dep.meta.originalName : key

      result[dep.path].push({
        identifierName: key,
        namedImport,
        originalName,
        importJustPath,
      })
    })

  return result
}

const addImportChunk = (
  chunks: ChunkDefinition[],
  dependencies: Record<string, ImportIdentifier[]>,
  newChunkName: string,
  fileType: string
) => {
  const importASTs = Object.keys(dependencies).map((key) =>
    createGenericImportStatement(key, dependencies[key])
  )

  chunks.push({
    type: CHUNK_TYPE.AST,
    name: newChunkName,
    fileType,
    content: importASTs,
    linkAfter: [],
  })
}
