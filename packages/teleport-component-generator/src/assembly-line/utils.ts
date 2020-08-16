import { ChunkDefinition } from '@teleporthq/teleport-types'

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
