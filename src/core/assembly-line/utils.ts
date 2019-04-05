import { ComponentDependency } from '../../typings/uidl-definitions'
import { ChunkDefinition } from '../../typings/generators'

export const extractExternalDependencies = (
  dependencies: Record<string, ComponentDependency>
): Record<string, string> => {
  return Object.keys(dependencies)
    .filter((key) => {
      return dependencies[key].type === 'package'
    })
    .reduce((acc: any, key) => {
      const depInfo = dependencies[key]
      if (depInfo.path) {
        acc[depInfo.path] = depInfo.version
      }

      return acc
    }, {})
}

export const groupChunksByFileId = (
  chunks: ChunkDefinition[]
): Record<string, ChunkDefinition[]> => {
  return chunks.reduce((chunksByFileId: Record<string, ChunkDefinition[]>, chunk) => {
    const fileId = (chunk.meta && chunk.meta.fileId) || 'default'
    if (!chunksByFileId[fileId]) {
      chunksByFileId[fileId] = []
    }
    chunksByFileId[fileId].push(chunk)
    return chunksByFileId
  }, {})
}
