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
    // TODO: is this fine here? Sure doesn't look like production-worthy code, but I'm not 100% sure how else to tackle this atm.
    // Essentailly, if it's a normalize function for the CMS, it now expects two parameters instead of one.
    if (mapper === 'normalize') {
      const extraParamsStatement = types.identifier('params')
      returnStatement = types.callExpression(types.identifier(mapper), [
        returnStatement,
        extraParamsStatement,
      ])
    } else {
      returnStatement = types.callExpression(types.identifier(mapper), [returnStatement])
    }

    if (!mappers[mapper]) {
      throw new TeleportError(
        `Resource mapper ${mapper} is not defined in the UIDL. Check "uidl.resources.mappers"`
      )
    }

    dependencies[mapper] = mappers[mapper]
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
