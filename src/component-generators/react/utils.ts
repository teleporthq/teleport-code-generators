import { ChunkDefinition } from '../types'

// TODO: Move to assembly line (core package)
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
