import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import {
  ChunkDefinition,
  ChunkType,
  FileType,
  UIDLDependency,
  UIDLResourceItem,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'

export const resourceGenerator = (
  resource: UIDLResourceItem
): { chunks: ChunkDefinition[]; dependencies: Record<string, UIDLDependency> } => {
  const chunks: ChunkDefinition[] = []
  const dependencies: Record<string, UIDLDependency> = {}
  const ast = ASTUtils.generateRemoteResourceASTs(resource)
  let returnStatement: types.Identifier | types.CallExpression = types.identifier('response')

  Object.keys(resource?.mappers || {}).forEach((mapper) => {
    returnStatement = types.callExpression(types.identifier(mapper), [returnStatement])
    dependencies[mapper] = resource.mappers[mapper]
  })

  const moduleBody = [...ast, types.returnStatement(returnStatement)]

  chunks.push({
    type: ChunkType.AST,
    fileType: FileType.JS,
    name: 'fetch-chunk',
    content: types.exportDefaultDeclaration(
      types.functionDeclaration(
        null,
        [types.assignmentPattern(types.identifier('params'), types.objectExpression([]))],
        types.blockStatement(moduleBody),
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
