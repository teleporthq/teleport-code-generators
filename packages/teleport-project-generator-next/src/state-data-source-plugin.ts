import {
  ComponentPlugin,
  ComponentPluginFactory,
  ChunkDefinition,
  ChunkType,
  FileType,
  UIDLDataSource,
  UIDLStateDefinition,
  UIDLStateDataSourceBinding,
  UIDLFilterConfigEntry,
} from '@teleporthq/teleport-types'
import { StringUtils } from '@teleporthq/teleport-shared'
import * as types from '@babel/types'
import {
  generateDataSourceFetcherWithCore,
  generateSafeFileName,
  sanitizeFileName,
  validateDataSourceConfig,
} from '@teleporthq/teleport-plugin-next-data-source'

interface ParallelFetchMeta {
  names: string[]
  expressions: types.Expression[]
  declaration?: types.VariableDeclaration
}

/**
 * Generates a safe fetch expression wrapped with .catch() for error handling.
 * Falls back to the provided defaultValue on error.
 */
const createSafeFetchExpressionWithFallback = (
  fetchCallExpression: types.CallExpression,
  label: string,
  defaultValue: types.Expression
): types.Expression => {
  const errorIdentifier = types.identifier('error')

  const catchHandler = types.arrowFunctionExpression(
    [errorIdentifier],
    types.blockStatement([
      types.expressionStatement(
        types.callExpression(
          types.memberExpression(types.identifier('console'), types.identifier('error')),
          [types.stringLiteral(`Error fetching state "${label}":`), errorIdentifier]
        )
      ),
      types.returnStatement(defaultValue),
    ])
  )

  return types.callExpression(
    types.memberExpression(fetchCallExpression, types.identifier('catch')),
    [catchHandler]
  )
}

/**
 * Builds the AST for extracting a value from fetched data using a refPath.
 * Uses optional chaining (?.) to safely navigate the data path.
 *
 * refPath semantics (first element is always the table name, used for fetching):
 *   ["tableName"]           → all rows → identifier as-is (fetchData returns the array)
 *   ["tableName", 0]        → first row → identifier?.[0]
 *   ["tableName", 0, "col"] → cell value → identifier?.[0]?.col
 */
const buildRefPathExtraction = (
  baseIdentifier: types.Identifier,
  refPath: Array<string | number>
): types.Expression => {
  // Skip the first element (table name) – remaining elements are the access path
  const accessPath = refPath.slice(1)

  if (accessPath.length === 0) {
    return baseIdentifier
  }

  let current: types.Expression = baseIdentifier
  for (const segment of accessPath) {
    if (typeof segment === 'number') {
      current = types.optionalMemberExpression(
        current,
        types.numericLiteral(segment),
        true, // computed
        true // optional (?.)
      )
    } else {
      const isValidIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(segment)
      current = types.optionalMemberExpression(
        current,
        isValidIdentifier ? types.identifier(segment) : types.stringLiteral(segment),
        !isValidIdentifier, // computed
        true // optional (?.)
      )
    }
  }

  return current
}

/**
 * Resolves the table name from a refPath.
 * The first element of refPath is always the table name.
 */
const getTableNameFromRefPath = (refPath: Array<string | number>): string | null => {
  if (!refPath || refPath.length === 0) {
    return null
  }
  const firstElement = refPath[0]
  return typeof firstElement === 'string' ? firstElement : null
}

/**
 * Determines the appropriate fallback default value AST for a state type.
 * When the fetch fails, the state should fall back to its static defaultValue.
 * For the getStaticProps catch block, we use type-appropriate empty values.
 */
const getTypeFallbackExpression = (stateDefinition: UIDLStateDefinition): types.Expression => {
  switch (stateDefinition.type) {
    case 'array':
      return types.arrayExpression([])
    case 'object':
      return types.objectExpression([])
    case 'string':
      return types.stringLiteral('')
    case 'number':
      return types.numericLiteral(0)
    case 'boolean':
      return types.booleanLiteral(false)
    default:
      return types.nullLiteral()
  }
}

const registerParallelFetch = (
  getStaticPropsChunk: ChunkDefinition,
  tryBlock: types.TryStatement,
  propKey: string,
  expression: types.Expression
) => {
  if (!getStaticPropsChunk.meta) {
    getStaticPropsChunk.meta = {}
  }

  const meta =
    (getStaticPropsChunk.meta.parallelFetchData as ParallelFetchMeta) ??
    ((getStaticPropsChunk.meta.parallelFetchData = {
      names: [],
      expressions: [],
    }) as ParallelFetchMeta)

  meta.names.push(propKey)
  meta.expressions.push(expression)

  updateParallelFetchStatement(tryBlock, meta)
}

const updateParallelFetchStatement = (tryBlock: types.TryStatement, meta: ParallelFetchMeta) => {
  if (meta.declaration) {
    const existingIndex = tryBlock.block.body.indexOf(meta.declaration)
    if (existingIndex !== -1) {
      tryBlock.block.body.splice(existingIndex, 1)
    }
  }

  const promiseAllCall = types.awaitExpression(
    types.callExpression(
      types.memberExpression(types.identifier('Promise'), types.identifier('all')),
      [types.arrayExpression(meta.expressions.map((expression) => expression))]
    )
  )

  const arrayPattern = types.arrayPattern(meta.names.map((name) => types.identifier(name)))

  meta.declaration = types.variableDeclaration('const', [
    types.variableDeclarator(arrayPattern, promiseAllCall),
  ])

  tryBlock.block.body.unshift(meta.declaration)
}

/**
 * Finds the getStaticProps chunk and its try block from the existing chunks array.
 */
const findGetStaticPropsChunkAndTryBlock = (
  chunks: ChunkDefinition[]
): { chunk: ChunkDefinition | null; tryBlock: types.TryStatement | null } => {
  const chunk = chunks.find((c) => c.name === 'getStaticProps') || null
  if (!chunk) {
    return { chunk: null, tryBlock: null }
  }

  const functionDeclaration = (chunk.content as types.ExportNamedDeclaration)
    .declaration as types.FunctionDeclaration
  const functionBody = functionDeclaration.body.body
  const tryBlock = functionBody.find(
    (subNode) => subNode.type === 'TryStatement'
  ) as types.TryStatement | null

  return { chunk, tryBlock }
}

/**
 * Creates a new getStaticProps chunk with a try/catch block.
 */
const createGetStaticPropsChunk = (): {
  chunk: ChunkDefinition
  tryBlock: types.TryStatement
} => {
  const tryBlock = types.tryStatement(
    types.blockStatement([
      types.returnStatement(
        types.objectExpression([
          types.objectProperty(types.identifier('props'), types.objectExpression([])),
          types.objectProperty(types.identifier('revalidate'), types.numericLiteral(1)),
        ])
      ),
    ]),
    types.catchClause(
      types.identifier('error'),
      types.blockStatement([
        types.expressionStatement(
          types.callExpression(
            types.memberExpression(types.identifier('console'), types.identifier('error')),
            [types.stringLiteral('Error in getStaticProps:'), types.identifier('error')]
          )
        ),
        types.returnStatement(
          types.objectExpression([
            types.objectProperty(types.identifier('props'), types.objectExpression([])),
          ])
        ),
      ])
    )
  )

  const chunk: ChunkDefinition = {
    name: 'getStaticProps',
    type: ChunkType.AST,
    fileType: FileType.JS,
    content: types.exportNamedDeclaration(
      types.functionDeclaration(
        types.identifier('getStaticProps'),
        [types.identifier('context')],
        types.blockStatement([tryBlock]),
        false,
        true
      )
    ),
    linkAfter: ['jsx-component'],
  }

  return { chunk, tryBlock }
}

/**
 * Adds a prop to the getStaticProps return statement.
 */
const addPropToGetStaticPropsReturn = (
  tryBlock: types.TryStatement,
  propKey: string,
  valueExpression: types.Expression
): void => {
  const returnStatement = tryBlock.block.body.find(
    (subNode) => subNode.type === 'ReturnStatement'
  ) as types.ReturnStatement | undefined

  if (!returnStatement || !returnStatement.argument) {
    return
  }

  const propsObject = (returnStatement.argument as types.ObjectExpression).properties.find(
    (property) =>
      (property as types.ObjectProperty).key &&
      ((property as types.ObjectProperty).key as types.Identifier).name === 'props'
  ) as types.ObjectProperty | undefined

  if (!propsObject) {
    return
  }

  const propsValue = propsObject.value as types.ObjectExpression

  // Check if prop already exists
  const existingProp = propsValue.properties.find(
    (prop) =>
      prop.type === 'ObjectProperty' &&
      prop.key.type === 'Identifier' &&
      (prop.key as types.Identifier).name === propKey
  )

  if (!existingProp) {
    propsValue.properties.unshift(
      types.objectProperty(types.identifier(propKey), valueExpression, false, false)
    )
  }
}

/**
 * Matches any double-brace template placeholder, e.g. `{{Current User.id}}`,
 * `{{user.email}}`, `{{ foo.bar }}`. These placeholders are only
 * resolvable at runtime (with a NextAuth session, request context, etc.)
 * so any query carrying one CANNOT be executed at build time inside
 * `getStaticProps`. Emitting a fetch for such a state produces a build-
 * time `fetchData({ rawQuery })` call that sends the literal placeholder
 * text to the database, crashing Postgres with
 * `invalid input syntax for type uuid: "{{Current User.id}}"`.
 */
const UNRESOLVED_TEMPLATE_PLACEHOLDER = /\{\{[^}]+\}\}/

const queryHasUnresolvedPlaceholder = (definition: UIDLStateDefinition): boolean => {
  if (typeof definition.query !== 'string' || definition.query.length === 0) {
    return false
  }
  return UNRESOLVED_TEMPLATE_PLACEHOLDER.test(definition.query)
}

/**
 * Collects all state definitions that have a dataSourceBinding AND whose
 * query is safe to execute at build time.
 *
 * States whose `query` contains an unresolved `{{...}}` placeholder are
 * intentionally skipped — we refuse to emit a broken `getStaticProps`
 * fetch that would send the literal placeholder text to the database.
 * Those states are expected to be populated at runtime by a lifecycle
 * workflow (e.g. `event-page-loaded`) that has access to the real
 * session and can interpolate the placeholder properly.
 */
const collectBoundStates = (
  stateDefinitions: Record<string, UIDLStateDefinition>
): Array<{
  stateKey: string
  definition: UIDLStateDefinition
  binding: UIDLStateDataSourceBinding
}> => {
  const result: Array<{
    stateKey: string
    definition: UIDLStateDefinition
    binding: UIDLStateDataSourceBinding
  }> = []

  for (const [stateKey, definition] of Object.entries(stateDefinitions)) {
    if (!definition.dataSourceBinding) {
      continue
    }
    if (queryHasUnresolvedPlaceholder(definition)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[state-data-source-plugin] Skipping getStaticProps fetch for state "${stateKey}" — query contains unresolved {{...}} placeholder (only resolvable at runtime). Populate this state via a page-load workflow instead.`
      )
      continue
    }
    result.push({
      stateKey,
      definition,
      binding: definition.dataSourceBinding,
    })
  }

  return result
}

/**
 * Groups bound states by their data source + table combination to avoid duplicate fetches.
 * Multiple states can bind to the same table but extract different refPaths.
 */
interface FetchGroup {
  dataSource: UIDLDataSource
  tableName: string
  fileName: string
  fetcherImportName: string
  states: Array<{
    stateKey: string
    definition: UIDLStateDefinition
    binding: UIDLStateDataSourceBinding
  }>
}

const groupByDataSourceAndTable = (
  boundStates: Array<{
    stateKey: string
    definition: UIDLStateDefinition
    binding: UIDLStateDataSourceBinding
  }>,
  dataSources: Record<string, UIDLDataSource>
): FetchGroup[] => {
  const groupMap = new Map<string, FetchGroup>()

  for (const state of boundStates) {
    const { binding } = state
    const dataSource = dataSources[binding.dataSourceId]
    if (!dataSource) {
      continue
    }

    const configValidation = validateDataSourceConfig(dataSource)
    if (!configValidation.isValid) {
      continue
    }

    const tableName = getTableNameFromRefPath(binding.refPath) || 'data'
    const groupKey = `${binding.dataSourceId}::${tableName}`

    if (!groupMap.has(groupKey)) {
      const fileName = generateSafeFileName(dataSource.type, tableName, binding.dataSourceId)
      const fetcherImportName = StringUtils.dashCaseToCamelCase(fileName)

      groupMap.set(groupKey, {
        dataSource,
        tableName,
        fileName,
        fetcherImportName,
        states: [],
      })
    }

    groupMap.get(groupKey)!.states.push(state)
  }

  return Array.from(groupMap.values())
}

/**
 * Builds the fetch params AST (sorts, filters) from a state definition.
 * Only includes static filters — dynamic filters cannot be resolved at build time.
 */
const buildFetchParams = (definition: UIDLStateDefinition): types.ObjectExpression => {
  const properties: types.ObjectProperty[] = []

  // Add sort config
  if (definition.sortConfig && definition.sortConfig.length > 0) {
    properties.push(
      types.objectProperty(
        types.identifier('sorts'),
        types.stringLiteral(JSON.stringify(definition.sortConfig))
      )
    )
  }

  // Add static filter config (exclude dynamic filters)
  if (definition.filterConfig && definition.filterConfig.length > 0) {
    const staticFilters = definition.filterConfig.filter((f: UIDLFilterConfigEntry) => !f.isDynamic)
    if (staticFilters.length > 0) {
      properties.push(
        types.objectProperty(
          types.identifier('filters'),
          types.stringLiteral(JSON.stringify(staticFilters))
        )
      )
    }
  }

  // Add raw query if present
  if (definition.query && definition.query.trim()) {
    properties.push(
      types.objectProperty(types.identifier('rawQuery'), types.stringLiteral(definition.query))
    )
  }

  return types.objectExpression(properties)
}

/**
 * Wraps a value expression with a mapping function IIFE if the definition has one.
 * Generates: (function() { try { <mappingFunction>; return mapData(value); } catch(e) { return value; } })()
 */
const wrapWithMappingFunction = (
  valueExpr: types.Expression,
  definition: UIDLStateDefinition
): types.Expression => {
  if (!definition.mappingFunction || !definition.mappingFunction.trim()) {
    return valueExpr
  }

  // Parse the mapping function as statements
  const inputParam = types.identifier('__rawData')
  const tryBlock = types.tryStatement(
    types.blockStatement([
      // The mapping function code is injected as raw code via template
      // We use an IIFE approach: eval the function then call it
      types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('__mapFn'),
          types.callExpression(types.identifier('Function'), [
            types.stringLiteral('items'),
            types.stringLiteral(
              `"use strict"; ${definition.mappingFunction}; return mapData(items);`
            ),
          ])
        ),
      ]),
      types.returnStatement(types.callExpression(types.identifier('__mapFn'), [inputParam])),
    ]),
    types.catchClause(
      types.identifier('__mapErr'),
      types.blockStatement([
        types.expressionStatement(
          types.callExpression(
            types.memberExpression(types.identifier('console'), types.identifier('error')),
            [types.stringLiteral('Mapping function error:'), types.identifier('__mapErr')]
          )
        ),
        types.returnStatement(inputParam),
      ])
    )
  )

  const iife = types.callExpression(
    types.arrowFunctionExpression([inputParam], types.blockStatement([tryBlock])),
    [valueExpr]
  )

  return iife
}

export const createStateDataSourcePlugin: ComponentPluginFactory<{}> = () => {
  const stateDataSourcePlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure
    const { stateDefinitions = {} } = uidl

    const dataSources = options.dataSources
    if (!dataSources || Object.keys(dataSources).length === 0) {
      return structure
    }

    // Collect states with dataSourceBinding
    const boundStates = collectBoundStates(stateDefinitions)
    if (boundStates.length === 0) {
      return structure
    }

    // Group by data source + table to deduplicate fetches
    const fetchGroups = groupByDataSourceAndTable(boundStates, dataSources)
    if (fetchGroups.length === 0) {
      return structure
    }

    // Find or create getStaticProps chunk
    let { chunk: getStaticPropsChunk, tryBlock } = findGetStaticPropsChunkAndTryBlock(chunks)
    if (!getStaticPropsChunk || !tryBlock) {
      const created = createGetStaticPropsChunk()
      getStaticPropsChunk = created.chunk
      tryBlock = created.tryBlock
      chunks.push(getStaticPropsChunk)
    }

    // Compute folder depth for import paths
    // componentFolderPath contains subfolders within pages/ (e.g. ['admin'] for pages/admin/X.js)
    const componentFolderPath = (uidl.outputOptions as any)?.folderPath || []
    const depth = (componentFolderPath.length || 0) + 1
    const relativePrefix = '../'.repeat(depth)

    const extractedResources = options.extractedResources

    for (const group of fetchGroups) {
      const { dataSource, tableName, fileName, fetcherImportName, states } = group

      // Generate fetcher utility file if not already extracted
      if (extractedResources && !extractedResources[`utils/${fileName}`]) {
        let fetcherCode: string
        try {
          fetcherCode = generateDataSourceFetcherWithCore(dataSource, tableName)
        } catch (error) {
          // Skip this group if fetcher generation fails
          continue
        }

        extractedResources[`utils/${fileName}`] = {
          fileName,
          fileType: FileType.JS,
          path: ['utils', 'data-sources'],
          content: fetcherCode,
        }
      }

      // Add import dependency for the fetcher module
      if (!dependencies[fetcherImportName]) {
        dependencies[fetcherImportName] = {
          type: 'local',
          path: `${relativePrefix}utils/data-sources/${fileName}`,
        }
      }

      // NOTE: Do NOT add package dependencies (like 'pg') for the data source type
      // to the page's dependency map. The data source utility module
      // (utils/data-sources/*.js) already imports 'pg' internally. Adding it as a
      // page-level dependency causes 'import pg from "pg"' to appear in React
      // pages, which crashes on the client side since 'pg' is a Node.js-only module.

      // For each state in this group, we need a prop key and a fetch + extraction
      // If multiple states share the same fetch, we use one fetch call and extract different paths
      // We use a single raw data prop for the whole group, then derive individual state props
      const sanitizedDsId = StringUtils.dashCaseToCamelCase(
        sanitizeFileName(dataSource.id).substring(0, 8)
      )
      const sanitizedTable = StringUtils.dashCaseToCamelCase(sanitizeFileName(tableName))
      const rawDataPropKey = `__stateDs_${sanitizedDsId}_${sanitizedTable}_raw`

      // Check if this fetch is already registered in the parallel fetch metadata
      const parallelFetchMeta = getStaticPropsChunk.meta?.parallelFetchData as
        | ParallelFetchMeta
        | undefined
      const alreadyRegistered = parallelFetchMeta?.names.includes(rawDataPropKey)

      if (!alreadyRegistered) {
        // Build fetch params from the first state's sort/filter config
        // (all states in the group share the same data source + table)
        const fetchParams = buildFetchParams(states[0].definition)

        // Create the fetch expression: fetcherImportName.fetchData(params)
        const fetchCallExpression = types.callExpression(
          types.memberExpression(
            types.identifier(fetcherImportName),
            types.identifier('fetchData')
          ),
          [fetchParams]
        )

        // Wrap with .catch() fallback
        const safeFetchExpression = createSafeFetchExpressionWithFallback(
          fetchCallExpression,
          rawDataPropKey,
          types.arrayExpression([])
        )

        // Register in parallel fetch (Promise.all pattern)
        registerParallelFetch(getStaticPropsChunk, tryBlock, rawDataPropKey, safeFetchExpression)
      }

      // For each bound state, add a prop that extracts the appropriate value using refPath
      for (const state of states) {
        const { stateKey, definition, binding } = state
        const rawDataIdentifier = types.identifier(rawDataPropKey)
        const extractedValue = buildRefPathExtraction(rawDataIdentifier, binding.refPath)
        const accessPath = binding.refPath.slice(1)

        // When refPath only has the table name, the raw fetch result is the value (all rows).
        // When refPath has deeper access, use optional chaining + nullish coalescing for safety.
        let propValue: types.Expression
        if (accessPath.length > 0) {
          propValue = types.logicalExpression(
            '??',
            extractedValue,
            getTypeFallbackExpression(definition)
          )
        } else {
          propValue = extractedValue
        }

        // Apply mapping function if present
        propValue = wrapWithMappingFunction(propValue, definition)

        addPropToGetStaticPropsReturn(tryBlock, stateKey, propValue)
      }
    }

    return structure
  }

  return stateDataSourcePlugin
}
