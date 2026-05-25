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
import { StringUtils } from '@teleporthq/teleport-shared'

/**
 * Checks if a resource points to a local data source API route.
 * These resources should use direct fetchData calls instead of HTTP fetch.
 */
const isDataSourceResource = (resource: UIDLResourceItem): boolean => {
  return (
    resource.path?.baseUrl?.type === 'static' &&
    typeof resource.path.baseUrl.content === 'string' &&
    resource.path.baseUrl.content.startsWith('/api') &&
    resource.params?.dataSourceId?.type === 'static' &&
    resource.params?.dataSourceType?.type === 'static' &&
    resource.params?.tableName?.type === 'static'
  )
}

/**
 * Computes the data source utility file name from resource params.
 * Must match the naming convention used by teleport-plugin-next-data-source.
 */
const getDataSourceUtilityFileName = (resource: UIDLResourceItem): string => {
  const dataSourceType = String(resource.params.dataSourceType.content)
  const tableName = String(resource.params.tableName.content)
  const dataSourceId = String(resource.params.dataSourceId.content)

  const sanitize = (input: string): string =>
    input
      .replace(/\.\./g, '')
      .replace(/[\/\\]/g, '-')
      .replace(/[<>:"|?*\x00-\x1F]/g, '')
      .replace(/\s+/g, '-')
      .replace(/^[-._]+|[-._]+$/g, '')

  const shortId = sanitize(dataSourceId).substring(0, 8)
  const baseName = `${sanitize(dataSourceType)}-${sanitize(tableName)}-${shortId}`
  return StringUtils.camelCaseToDashCase(baseName)
}

/**
 * Generates a resource that directly calls the data source utility's fetchData,
 * bypassing HTTP. This is necessary for server-side contexts (getStaticProps)
 * where fetch() to local API routes doesn't work.
 */
const generateDirectDataSourceResource = (
  resource: UIDLResourceItem
): { chunks: ChunkDefinition[]; dependencies: Record<string, UIDLDependency> } => {
  const fileName = getDataSourceUtilityFileName(resource)
  const importPath = `../utils/data-sources/${fileName}`

  // Generate: import dataSourceModule from '../utils/data-sources/...'
  const dependencies: Record<string, UIDLDependency> = {
    dataSourceModule: {
      type: 'local' as const,
      path: importPath,
    },
  }

  // Generate:
  // export default async function (params = {}) {
  //   const data = await dataSourceModule.fetchData(params)
  //   return { success: true, data: data }
  // }
  const fetchDataCall = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('data'),
      types.awaitExpression(
        types.callExpression(
          types.memberExpression(
            types.identifier('dataSourceModule'),
            types.identifier('fetchData')
          ),
          [types.identifier('params')]
        )
      )
    ),
  ])

  const returnObj = types.returnStatement(
    types.objectExpression([
      types.objectProperty(types.identifier('success'), types.booleanLiteral(true)),
      types.objectProperty(types.identifier('data'), types.identifier('data'), false, true),
    ])
  )

  const chunks: ChunkDefinition[] = [
    {
      type: ChunkType.AST,
      fileType: FileType.JS,
      name: 'fetch-chunk',
      content: types.exportDefaultDeclaration(
        (() => {
          const fn = types.functionDeclaration(
            null,
            [types.assignmentPattern(types.identifier('params'), types.objectExpression([]))],
            types.blockStatement([fetchDataCall, returnObj]),
            false,
            true
          )
          fn.async = true
          return fn
        })()
      ),
      linkAfter: [],
    },
  ]

  return { chunks, dependencies }
}

export const resourceGenerator = (
  resource: UIDLResourceItem,
  mappers?: UIDLResources['resourceMappers']
): { chunks: ChunkDefinition[]; dependencies: Record<string, UIDLDependency> } => {
  // For data source resources, generate direct fetchData calls instead of HTTP fetch
  if (isDataSourceResource(resource)) {
    return generateDirectDataSourceResource(resource)
  }

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
