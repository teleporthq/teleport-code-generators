import { ComponentPlugin, ComponentPluginFactory, ChunkDefinition } from '../../shared/types'
import { ComponentDependency } from '../../uidl-definitions/types'

import { makeGenericImportStatement } from '../../shared/utils/ast-js-utils'

interface ImportPluginConfig {
  importLibsChunkName?: string
  importPackagesChunkName?: string
  importLocalsChunkName?: string
}

export const createPlugin: ComponentPluginFactory<ImportPluginConfig> = (config) => {
  const {
    importLibsChunkName = 'import-libs',
    importPackagesChunkName = 'import-packages',
    importLocalsChunkName = 'import-local',
    fileId = null,
  } = config || {}

  const importPlugin: ComponentPlugin = async (structure) => {
    const { dependencies } = structure

    const libraryDependencies = groupDependenciesByPackage(dependencies, 'library')
    const packageDependencies = groupDependenciesByPackage(dependencies, 'package')
    const localDependencies = groupDependenciesByPackage(dependencies, 'local')
    addImportChunk(structure.chunks, libraryDependencies, importLibsChunkName, fileId)
    addImportChunk(structure.chunks, packageDependencies, importPackagesChunkName, fileId)
    addImportChunk(structure.chunks, localDependencies, importLocalsChunkName, fileId)
    return structure
  }

  return importPlugin
}

export default createPlugin()

interface ImportDependency {
  identifier: string
  namedImport: boolean
  originalName: string
}

const groupDependenciesByPackage = (
  dependencies: Record<string, ComponentDependency>,
  packageType?: string
) => {
  const result: Record<string, ImportDependency[]> = {}

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

      const namedImport = !!(dep.meta && dep.meta.namedImport)
      const originalName = dep.meta && dep.meta.originalName ? dep.meta.originalName : key

      result[dep.path].push({
        identifier: key,
        namedImport,
        originalName,
      })
    })

  return result
}

const addImportChunk = (
  chunks: ChunkDefinition[],
  dependencies: Record<string, ImportDependency[]>,
  newChunkName: string,
  fileId: string | null
) => {
  const importASTs = Object.keys(dependencies).map((key) =>
    makeGenericImportStatement(key, dependencies[key])
  )

  chunks.push({
    type: 'js',
    name: newChunkName,
    meta: {
      fileId,
    },
    content: importASTs,
  })
}
