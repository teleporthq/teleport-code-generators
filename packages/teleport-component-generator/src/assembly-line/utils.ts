import { UIDLDependency, ChunkDefinition } from '@teleporthq/teleport-types'

export const extractExternalDependencies = (dependencies: Record<string, UIDLDependency>) => {
  return Object.keys(dependencies)
    .filter((key) => {
      return dependencies[key].type === 'package'
    })
    .reduce((acc: Record<string, string>, key) => {
      const depInfo = dependencies[key]
      if (depInfo.path && (depInfo.type === 'library' || depInfo.type === 'package')) {
        acc[depInfo.path] = depInfo.version
      }

      return acc
    }, {})
}

export const groupChunksByFileType = (
  chunks: ChunkDefinition[]
): Record<string, ChunkDefinition[]> => {
  return chunks.reduce((chunksByFileType: Record<string, ChunkDefinition[]>, chunk) => {
    const fileType = chunk.fileType
    if (!chunksByFileType[fileType]) {
      chunksByFileType[fileType] = []
    }
    chunksByFileType[fileType].push(chunk)
    return chunksByFileType
  }, {})
}
