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
 * Params consumed at GENERATION time, to pick the utility module above. They
 * are already encoded in the import path, so they do not travel to `fetchData`.
 *
 * Every OTHER param on the resource is one the generated handler reads out of
 * `req.query` at runtime, so it has to be forwarded. `collectionPath` is the
 * case in hand: it tells a wrapped REST payload where its list lives, and
 * dropping it left the handler looking at `{ "categories": [...] }` instead of
 * the records — a details page whose paths were empty and whose every URL 404'd.
 */
const GENERATION_TIME_PARAMS = new Set(['dataSourceId', 'dataSourceType', 'tableName'])

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * A resource param as a literal, or null when it cannot be one. Only `static`
 * params can be baked into the call — a dynamic param has no value at
 * generation time, and the caller is the one that supplies it at runtime.
 *
 * A structured value is JSON-encoded rather than skipped. These params become
 * `req.query` entries, where everything structured already travels as JSON
 * (`filters`, `sorts`, `collectionPath`), so the handlers parse it back. The
 * alternative — dropping it — is the failure this whole path is being fixed
 * for: a param that vanishes produces a handler quietly working on the wrong
 * data, with nothing in the generated output to say so.
 */
const staticParamLiteral = (param: UIDLResourceItem['params'][string]): types.Expression => {
  if (param?.type !== 'static') {
    return null
  }

  const { content } = param
  if (typeof content === 'string') {
    return types.stringLiteral(content)
  }
  if (typeof content === 'number') {
    return types.numericLiteral(content)
  }
  if (typeof content === 'boolean') {
    return types.booleanLiteral(content)
  }
  if (content === null || content === undefined) {
    return null
  }

  return types.stringLiteral(JSON.stringify(content))
}

/**
 * What to hand `fetchData`.
 *
 * With no runtime params this stays the bare `params` identifier, so every
 * resource that has only routing params generates exactly the code it did
 * before. Otherwise the runtime params become defaults and the caller's
 * `params` spread over them LAST, so an argument passed at the call site still
 * wins over the value baked into the resource.
 */
const buildFetchDataArgument = (resource: UIDLResourceItem): types.Expression => {
  const runtimeParams = Object.keys(resource.params || {})
    .filter((name) => !GENERATION_TIME_PARAMS.has(name))
    .map((name) => ({ name, literal: staticParamLiteral(resource.params[name]) }))
    .filter(({ literal }) => literal !== null)

  if (runtimeParams.length === 0) {
    return types.identifier('params')
  }

  return types.objectExpression([
    ...runtimeParams.map(({ name, literal }) =>
      types.objectProperty(
        IDENTIFIER_PATTERN.test(name) ? types.identifier(name) : types.stringLiteral(name),
        literal
      )
    ),
    types.spreadElement(types.identifier('params')),
  ])
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
          [buildFetchDataArgument(resource)]
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
