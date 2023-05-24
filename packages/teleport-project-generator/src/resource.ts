import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import {
  ChunkDefinition,
  ChunkType,
  FileType,
  UIDLDependency,
  UIDLResourceItem,
  UIDLResources,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'

export const resourceGenerator = (
  resource: UIDLResourceItem,
  mappers?: UIDLResources['mappers']
): { chunks: ChunkDefinition[]; dependencies: Record<string, UIDLDependency> } => {
  const chunks: ChunkDefinition[] = []
  const dependencies: Record<string, UIDLDependency> = {}
  const ast = ASTUtils.generateRemoteResourceASTs(resource)
  let returnStatement: types.Identifier | types.CallExpression = types.identifier('response')
  const combinedMappers = { ...(mappers || {}), ...(resource?.mappers || {}) }

  Object.keys(combinedMappers).forEach((mapper) => {
    returnStatement = types.callExpression(types.identifier(mapper), [returnStatement])
    dependencies[mapper] = combinedMappers[mapper]
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
