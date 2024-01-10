import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import {
  ChunkDefinition,
  ChunkType,
  FileType,
  TeleportError,
  UIDLDependency,
  UIDLResourceItem,
  UIDLResources,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'

export const resourceGenerator = (
  resource: UIDLResourceItem,
  mappers?: UIDLResources['resourceMappers']
): { chunks: ChunkDefinition[]; dependencies: Record<string, UIDLDependency> } => {
  const chunks: ChunkDefinition[] = []
  const dependencies: Record<string, UIDLDependency> = {}
  const ast = ASTUtils.generateRemoteResourceASTs(resource)
  let returnStatement: types.Identifier | types.CallExpression = types.identifier('response')

  resource.mappers.forEach((mapper) => {
    // Fallback value for returnStatement
    returnStatement = types.callExpression(types.identifier(mapper), [returnStatement])

    if (!mappers[mapper]) {
      throw new TeleportError(
        `Resource mapper ${mapper} is not defined in the UIDL. Check "uidl.resources.mappers"`
      )
    }

    const params = mappers[mapper].params.map((param) => types.identifier(param))
    returnStatement = types.callExpression(types.identifier(mapper), [...params])

    dependencies[mapper] = mappers[mapper].dependency
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
