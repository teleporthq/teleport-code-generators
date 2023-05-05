import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { ChunkDefinition, ChunkType, FileType, UIDLResourceItem } from '@teleporthq/teleport-types'
import * as types from '@babel/types'

export const resourceGenerator = (
  resource: UIDLResourceItem
): { chunks: ChunkDefinition[]; dependencies: Record<string, string> } => {
  const chunks: ChunkDefinition[] = []
  const dependencies: Record<string, string> = {}

  const ast = ASTUtils.generateRemoteResourceASTs(resource)

  chunks.push({
    type: ChunkType.AST,
    fileType: FileType.JS,
    name: 'fetch-chunk',
    content: types.exportDefaultDeclaration(
      types.functionDeclaration(
        null,
        [],
        types.blockStatement([...ast, types.returnStatement(types.identifier('response'))]),
        false,
        true
      )
    ),
    linkAfter: [],
  })

  return {
    chunks,
    dependencies,
  }
}
