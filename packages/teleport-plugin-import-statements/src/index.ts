import { ASTBuilders } from '@teleporthq/teleport-plugin-common'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkDefinition,
  UIDLDependency,
  ImportIdentifier,
  ChunkType,
  FileType,
  ComponentStructure,
} from '@teleporthq/teleport-types'

interface ImportPluginConfig {
  importLibsChunkName?: string
  importPackagesChunkName?: string
  importLocalsChunkName?: string
  fileType?: FileType
}

export const createImportPlugin: ComponentPluginFactory<ImportPluginConfig> = (
  config: ImportPluginConfig
) => {
  const {
    importLibsChunkName = 'import-lib',
    importPackagesChunkName = 'import-pack',
    importLocalsChunkName = 'import-local',
    fileType = FileType.JS,
  } = config || {}

  const importPlugin: ComponentPlugin = async (structure: ComponentStructure) => {
    const { uidl, dependencies } = structure
    let collectedDependencies = dependencies

    if (uidl?.importDefinitions) {
      const { importDefinitions = {} } = uidl

      collectedDependencies = {
        ...collectedDependencies,
        ...importDefinitions,
      }
      if (Object.keys(importDefinitions).length > 0) {
        Object.keys(importDefinitions).forEach((dependencyRef) => {
          const dependency = importDefinitions[dependencyRef]
          if (
            dependency.meta?.useAsReference ||
            dependency.meta?.importJustPath ||
            dependency?.meta.needsWindowObject
          ) {
            return
          }

          dependencies[dependencyRef] = {
            type: 'package',
            path: dependency.meta?.importJustPath ? dependency.path : dependencyRef,
            version: dependency.version,
            meta: {
              importJustPath: dependency?.meta?.importJustPath,
              originalName: dependency?.meta?.originalName,
              namedImport: dependency?.meta?.namedImport,
            },
          }
        })
      }
    }

    const libraryDependencies = groupDependenciesByPackage(collectedDependencies, 'library')
    const packageDependencies = groupDependenciesByPackage(collectedDependencies, 'package')
    const localDependencies = groupDependenciesByPackage(collectedDependencies, 'local')
    addImportChunk(structure.chunks, libraryDependencies, importLibsChunkName, fileType)
    addImportChunk(structure.chunks, packageDependencies, importPackagesChunkName, fileType)
    addImportChunk(structure.chunks, localDependencies, importLocalsChunkName, fileType)
    return structure
  }

  return importPlugin
}

const groupDependenciesByPackage = (
  dependencies: Record<string, UIDLDependency>,
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

      if (dep?.meta && 'needsWindowObject' in dep.meta) {
        return
      }

      if (dep?.meta?.importAlias) {
        result[dep.meta.importAlias] = []
      }

      if (!dep?.meta?.importAlias && !result[dep.path]) {
        result[dep.path] = [] // Initialize the dependencies from this path
      }

      const importJustPath = (dep.meta && dep.meta.importJustPath) || false
      const namedImport = !!(dep.meta && dep.meta.namedImport)
      const originalName = dep.meta && dep.meta.originalName ? dep.meta.originalName : key

      result[dep?.meta?.importAlias ?? dep.path].push({
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
  fileType: FileType
) => {
  const importASTs = Object.keys(dependencies).map((key) =>
    ASTBuilders.createGenericImportStatement(key, dependencies[key])
  )

  chunks.push({
    type: ChunkType.AST,
    name: newChunkName,
    fileType,
    content: importASTs,
    linkAfter: [],
  })
}

export default createImportPlugin()
