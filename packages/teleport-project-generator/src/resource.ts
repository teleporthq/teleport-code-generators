import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import {
  ChunkDefinition,
  ChunkType,
  FileType,
  UIDLDependency,
  UIDLResourceItem,
} from '@teleporthq/teleport-types'

export const resourceGenerator = (
  resource: UIDLResourceItem
): { chunks: ChunkDefinition[]; dependencies: Record<string, UIDLDependency> } => {
  const chunks: ChunkDefinition[] = []
  const dependenncies: Record<string, UIDLDependency> = {}

  const ast = ASTUtils.generateRemoteResourceASTs(resource)
  chunks.push({
    type: ChunkType.AST,
    fileType: FileType.JS,
    name: 'fetch-chunk',
    content: ast,
    linkAfter: [],
  })

  return {
    chunks,
    dependncies,
  }
}
