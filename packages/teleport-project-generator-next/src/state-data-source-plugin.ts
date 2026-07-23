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
  generateRawQueryFetcher,
  generateSafeFileName,
  sanitizeFileName,
  validateDataSourceConfig,
} from '@teleporthq/teleport-plugin-next-data-source'
import { isSelectOnlyQuery } from './global-state/data-source-utils'

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
// A placeholder that is NOT runtime-resolvable: anything other than
// {{Current User.<field>}} (signed-in user, from the global auth context) or
// {{Current Page Entity.id}} (the details-page row — its id IS the dynamic
// route param, so it can be read from the router without loading the entity).
// Other Current Page Entity columns are excluded: resolving them requires the
// fetched entity row, whose prop shape isn't known to this plugin.
const NON_RUNTIME_RESOLVABLE_PLACEHOLDER =
  /\{\{(?!Current User\.\w+\}\})(?!Current Page Entity\.id\}\})[^}]+\}\}/

const queryHasUnresolvedPlaceholder = (definition: UIDLStateDefinition): boolean => {
  if (typeof definition.query !== 'string' || definition.query.length === 0) {
    return false
  }
  return UNRESOLVED_TEMPLATE_PLACEHOLDER.test(definition.query)
}

/**
 * True when every `{{...}}` placeholder in the query is resolvable on the
 * client at runtime, so the state can be populated through a generated API
 * route + client-side fetch instead of being dropped.
 */
const queryPlaceholdersAreRuntimeResolvable = (definition: UIDLStateDefinition): boolean => {
  if (!queryHasUnresolvedPlaceholder(definition)) {
    return false
  }
  return !NON_RUNTIME_RESOLVABLE_PLACEHOLDER.test(definition.query)
}

interface RuntimeQueryToken {
  kind: 'user' | 'entity'
  field: string
  paramName: string
}

/**
 * Parses the runtime-resolvable `{{…}}` tokens out of a query, replacing each
 * distinct token with a `$N` placeholder (in order of first appearance —
 * matching the query-param order the generated API route destructures).
 * Handles both quoted (`'{{…}}'`) and bare occurrences, like the global-state
 * parser does.
 */
const parseRuntimeQueryTokens = (
  query: string
): { parameterizedQuery: string; tokens: RuntimeQueryToken[] } => {
  const tokens: RuntimeQueryToken[] = []
  const orderedRawTokens: string[] = []

  const tokenRe = /\{\{(Current User\.(\w+)|Current Page Entity\.id)\}\}/g
  let match = tokenRe.exec(query)
  while (match !== null) {
    const raw = match[0]
    if (!orderedRawTokens.includes(raw)) {
      orderedRawTokens.push(raw)
      if (match[2]) {
        const field = match[2]
        tokens.push({
          kind: 'user',
          field,
          paramName: `currentUser${field.charAt(0).toUpperCase()}${field.slice(1)}`,
        })
      } else {
        tokens.push({ kind: 'entity', field: 'id', paramName: 'currentPageEntityId' })
      }
    }
    match = tokenRe.exec(query)
  }

  let parameterizedQuery = query
  orderedRawTokens.forEach((raw, index) => {
    const quoted = `'${raw}'`
    if (parameterizedQuery.includes(quoted)) {
      parameterizedQuery = parameterizedQuery.split(quoted).join(`$${index + 1}`)
    } else {
      parameterizedQuery = parameterizedQuery.split(raw).join(`$${index + 1}`)
    }
  })

  return { parameterizedQuery, tokens }
}

interface BoundState {
  stateKey: string
  definition: UIDLStateDefinition
  binding: UIDLStateDataSourceBinding
}

/**
 * Collects all state definitions that have a dataSourceBinding, split by how
 * their data can be resolved:
 *
 * - `buildTime`: no `{{...}}` placeholder in the query — fetched once inside
 *   `getStaticProps`. Emitting a build-time fetch for a placeholder query
 *   would send the literal placeholder text to the database, crashing
 *   Postgres with `invalid input syntax for type uuid: "{{Current User.id}}"`.
 * - `runtimeUser`: every placeholder is `{{Current User.<field>}}` or
 *   `{{Current Page Entity.id}}` — fetched at runtime through a generated
 *   API route once the signed-in user / dynamic route param is available on
 *   the client.
 *
 * States with any other placeholder (e.g. `{{urlDifferentiator}}`) are
 * skipped: they are expected to be populated by a lifecycle workflow that
 * has the full trigger context.
 */
const collectBoundStates = (
  stateDefinitions: Record<string, UIDLStateDefinition>
): { buildTime: BoundState[]; runtimeUser: BoundState[] } => {
  const buildTime: BoundState[] = []
  const runtimeUser: BoundState[] = []

  for (const [stateKey, definition] of Object.entries(stateDefinitions)) {
    if (!definition.dataSourceBinding) {
      continue
    }
    if (queryHasUnresolvedPlaceholder(definition)) {
      if (queryPlaceholdersAreRuntimeResolvable(definition)) {
        runtimeUser.push({ stateKey, definition, binding: definition.dataSourceBinding })
        continue
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[state-data-source-plugin] Skipping getStaticProps fetch for state "${stateKey}" — query contains unresolved {{...}} placeholder (only resolvable at runtime). Populate this state via a page-load workflow instead.`
      )
      continue
    }
    buildTime.push({
      stateKey,
      definition,
      binding: definition.dataSourceBinding,
    })
  }

  return { buildTime, runtimeUser }
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
  fetchDiscriminator: string
  states: BoundState[]
}

/**
 * Stable hash of everything buildFetchParams derives from a state definition
 * (rawQuery + sorts + static filters). Two states may only share a fetch when
 * this matches — grouping by table alone made every state in the group receive
 * the FIRST state's query result (e.g. a 1-row aggregate state getting an
 * N-row JOIN, duplicating the dashboard KPI block N times).
 */
const computeFetchDiscriminator = (definition: UIDLStateDefinition): string => {
  const staticFilters = (definition.filterConfig || []).filter(
    (f: UIDLFilterConfigEntry) => !f.isDynamic
  )
  const fingerprint = JSON.stringify({
    query: definition.query && definition.query.trim() ? definition.query : '',
    sorts: definition.sortConfig || [],
    filters: staticFilters,
  })
  let hash = 5381
  for (let i = 0; i < fingerprint.length; i++) {
    // tslint:disable-next-line:no-bitwise
    hash = ((hash << 5) + hash + fingerprint.charCodeAt(i)) | 0
  }
  // tslint:disable-next-line:no-bitwise
  return (hash >>> 0).toString(36)
}

const groupByDataSourceAndTable = (
  boundStates: BoundState[],
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
    const fetchDiscriminator = computeFetchDiscriminator(state.definition)
    const groupKey = `${binding.dataSourceId}::${tableName}::${fetchDiscriminator}`

    if (!groupMap.has(groupKey)) {
      const fileName = generateSafeFileName(dataSource.type, tableName, binding.dataSourceId)
      const fetcherImportName = StringUtils.dashCaseToCamelCase(fileName)

      groupMap.set(groupKey, {
        dataSource,
        tableName,
        fileName,
        fetcherImportName,
        fetchDiscriminator,
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

/**
 * Finds the page component's function body inside the jsx-component chunk so
 * hooks can be injected before its return statement. Mirrors the lookup the
 * workflows plugin performs.
 */
const findComponentBody = (chunks: ChunkDefinition[]): types.BlockStatement | null => {
  const jsxComponent = chunks.find(
    (chunk) =>
      chunk.name === 'jsx-component' &&
      typeof chunk.content === 'object' &&
      chunk.content !== null &&
      'type' in (chunk.content as object) &&
      (chunk.content as types.Node).type === 'VariableDeclaration'
  )
  if (!jsxComponent) {
    return null
  }

  const declarator = (jsxComponent.content as types.VariableDeclaration).declarations[0]
  const init = declarator?.init
  if (!init || (init.type !== 'ArrowFunctionExpression' && init.type !== 'FunctionExpression')) {
    return null
  }
  const body = (init as types.ArrowFunctionExpression).body
  return body.type === 'BlockStatement' ? body : null
}

/**
 * Builds the `setter(<value>)` statement for one runtime-fetched state, where
 * `__data` holds the API route's `result.data` (the query's rows array).
 */
const buildRuntimeSetterStatement = (state: BoundState): types.ExpressionStatement => {
  const { stateKey, definition, binding } = state
  const dataIdentifier = types.identifier('__data')
  const accessPath = binding.refPath.slice(1)

  let valueExpr: types.Expression
  if (accessPath.length > 0) {
    valueExpr = types.logicalExpression(
      '??',
      buildRefPathExtraction(dataIdentifier, binding.refPath),
      getTypeFallbackExpression(definition)
    )
  } else if (definition.type === 'array') {
    // The route returns the rows array directly, but never let a malformed
    // payload poison an array-typed state (mirrors the workflow runtime guard).
    valueExpr = types.conditionalExpression(
      types.callExpression(
        types.memberExpression(types.identifier('Array'), types.identifier('isArray')),
        [dataIdentifier]
      ),
      dataIdentifier,
      types.arrayExpression([])
    )
  } else {
    valueExpr = dataIdentifier
  }

  valueExpr = wrapWithMappingFunction(valueExpr, definition)

  const setterName = `set${stateKey.charAt(0).toUpperCase()}${stateKey.slice(1)}`
  return types.expressionStatement(types.callExpression(types.identifier(setterName), [valueExpr]))
}

/**
 * Builds the client-side fetch effect for one runtime fetch group:
 *
 *   useEffect(() => {
 *     const __user = __pageStateCtx?.currentUser
 *     if (!__user) return
 *     fetch('/api/page-state/<route>?currentUserId=' + encodeURIComponent(__user.id ?? ''))
 *       .then((__res) => __res.json())
 *       .then((__result) => {
 *         if (!__result || __result.success !== true) return
 *         const __data = __result.data
 *         set<State>(...)
 *       })
 *       .catch((__err) => console.error(...))
 *   }, [__pageStateCtx?.currentUser])
 */
const buildRuntimeTokenFetchEffect = (
  group: FetchGroup,
  routeName: string,
  tokens: RuntimeQueryToken[],
  dynamicRouteAttribute?: string
): types.ExpressionStatement => {
  const needsUser = tokens.some((t) => t.kind === 'user')
  const needsEntity = tokens.some((t) => t.kind === 'entity')

  const setup: types.Statement[] = []
  const deps: types.Expression[] = []

  if (needsUser) {
    setup.push(
      types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('__user'),
          types.optionalMemberExpression(
            types.identifier('__pageStateCtx'),
            types.identifier('currentUser'),
            false,
            true
          )
        ),
      ]),
      types.ifStatement(
        types.unaryExpression('!', types.identifier('__user')),
        types.returnStatement()
      )
    )
    deps.push(
      types.optionalMemberExpression(
        types.identifier('__pageStateCtx'),
        types.identifier('currentUser'),
        false,
        true
      )
    )
  }

  const buildEntityIdAccess = () =>
    types.optionalMemberExpression(
      types.memberExpression(types.identifier('__pageStateRouter'), types.identifier('query')),
      types.stringLiteral(dynamicRouteAttribute || 'id'),
      true,
      true
    )

  if (needsEntity) {
    // The dynamic route param IS the entity id (getStaticPaths/getServerSideProps
    // resolve the page by `id = params[<attr>]`), so no entity fetch is needed.
    setup.push(
      types.variableDeclaration('const', [
        types.variableDeclarator(types.identifier('__entityId'), buildEntityIdAccess()),
      ]),
      types.ifStatement(
        types.unaryExpression('!', types.identifier('__entityId')),
        types.returnStatement()
      )
    )
    deps.push(buildEntityIdAccess())
  }

  // Build the URL: literal prefix + encodeURIComponent(<value>) per token
  let urlExpr: types.Expression = types.stringLiteral(
    `/api/page-state/${routeName}${tokens.length > 0 ? '?' : ''}`
  )
  tokens.forEach((token, index) => {
    const prefix = `${index > 0 ? '&' : ''}${token.paramName}=`
    const valueExpr: types.Expression =
      token.kind === 'user'
        ? types.logicalExpression(
            '??',
            types.optionalMemberExpression(
              types.identifier('__user'),
              types.identifier(token.field),
              false,
              true
            ),
            types.stringLiteral('')
          )
        : types.identifier('__entityId')
    urlExpr = types.binaryExpression(
      '+',
      types.binaryExpression('+', urlExpr, types.stringLiteral(prefix)),
      types.callExpression(types.identifier('encodeURIComponent'), [valueExpr])
    )
  })

  const resultChecks: types.Statement[] = [
    types.ifStatement(
      types.logicalExpression(
        '||',
        types.unaryExpression('!', types.identifier('__result')),
        types.binaryExpression(
          '!==',
          types.memberExpression(types.identifier('__result'), types.identifier('success')),
          types.booleanLiteral(true)
        )
      ),
      types.returnStatement()
    ),
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('__data'),
        types.memberExpression(types.identifier('__result'), types.identifier('data'))
      ),
    ]),
    ...group.states.map(buildRuntimeSetterStatement),
  ]

  const fetchChain = types.callExpression(
    types.memberExpression(
      types.callExpression(
        types.memberExpression(
          types.callExpression(
            types.memberExpression(
              types.callExpression(types.identifier('fetch'), [urlExpr]),
              types.identifier('then')
            ),
            [
              types.arrowFunctionExpression(
                [types.identifier('__res')],
                types.callExpression(
                  types.memberExpression(types.identifier('__res'), types.identifier('json')),
                  []
                )
              ),
            ]
          ),
          types.identifier('then')
        ),
        [
          types.arrowFunctionExpression(
            [types.identifier('__result')],
            types.blockStatement(resultChecks)
          ),
        ]
      ),
      types.identifier('catch')
    ),
    [
      types.arrowFunctionExpression(
        [types.identifier('__err')],
        types.blockStatement([
          types.expressionStatement(
            types.callExpression(
              types.memberExpression(types.identifier('console'), types.identifier('error')),
              [
                types.stringLiteral(
                  `Error fetching page state (${group.states.map((s) => s.stateKey).join(', ')}):`
                ),
                types.identifier('__err'),
              ]
            )
          ),
        ])
      ),
    ]
  )

  const effectBody = types.blockStatement([...setup, types.expressionStatement(fetchChain)])

  return types.expressionStatement(
    types.callExpression(types.identifier('useEffect'), [
      types.arrowFunctionExpression([], effectBody),
      types.arrayExpression(deps),
    ])
  )
}

/**
 * Emits, for page states whose query references only runtime-resolvable
 * placeholders ({{Current User.<field>}} and/or {{Current Page Entity.id}}):
 *   1. a parameterized API route (pages/api/page-state/<route>.js) that runs
 *      the raw query with the placeholder(s) bound to query params, and
 *   2. a useEffect in the page component that calls the route once the
 *      signed-in user / dynamic route param is available and writes the rows
 *      into local state.
 *
 * Without this, such states were silently dropped (no getStaticProps fetch is
 * possible — the placeholder only resolves at runtime) and any list bound to
 * them rendered empty forever unless a page-load workflow happened to exist —
 * while the SAME binding populated fine inside the GUI editor, which resolves
 * it through its own emulation (GuildForge run 801a60b6: guild-details
 * memberships list).
 */
const generateRuntimeTokenStateFetches = (
  structure: Parameters<ComponentPlugin>[0],
  runtimeStates: BoundState[],
  dataSources: Record<string, UIDLDataSource>
): void => {
  const { uidl, chunks, dependencies, options } = structure

  const extractedResources = options.extractedResources
  if (!extractedResources) {
    return
  }

  const componentBody = findComponentBody(chunks)
  if (!componentBody) {
    return
  }

  const dynamicRouteAttribute = uidl.outputOptions?.dynamicRouteAttribute

  const validStates = runtimeStates.filter((s) => isSelectOnlyQuery(s.definition.query))
  const fetchGroups = groupByDataSourceAndTable(validStates, dataSources)
  if (fetchGroups.length === 0) {
    return
  }

  const pageSlug = StringUtils.camelCaseToDashCase(sanitizeFileName(uidl.name || 'page'))

  const effects: types.Statement[] = []
  let anyGroupNeedsUser = false
  let anyGroupNeedsEntity = false

  for (const group of fetchGroups) {
    const query = group.states[0].definition.query
    const { parameterizedQuery, tokens } = parseRuntimeQueryTokens(query)
    const needsUser = tokens.some((t) => t.kind === 'user')
    const needsEntity = tokens.some((t) => t.kind === 'entity')
    const stateNames = group.states.map((s) => `"${s.stateKey}"`).join(', ')

    if (needsUser && !options.auth) {
      // eslint-disable-next-line no-console
      console.warn(
        `[state-data-source-plugin] Skipping runtime fetch for state(s) ${stateNames} — the query references {{Current User.*}} but the project has no authentication, so there is no signed-in user to resolve it with.`
      )
      continue
    }
    if (needsEntity && !dynamicRouteAttribute) {
      // eslint-disable-next-line no-console
      console.warn(
        `[state-data-source-plugin] Skipping runtime fetch for state(s) ${stateNames} — the query references {{Current Page Entity.id}} but page "${uidl.name}" is not a dynamic details page (no dynamicRouteAttribute), so there is no route param to resolve it with.`
      )
      continue
    }

    const routeName = `${pageSlug}-${sanitizeFileName(group.tableName)}-${group.fetchDiscriminator}`
    const resourceKey = `pages/api/page-state/${routeName}`

    if (!extractedResources[resourceKey]) {
      let routeContent: string
      try {
        routeContent = generateRawQueryFetcher(
          group.dataSource.config as Record<string, unknown>,
          parameterizedQuery,
          tokens.map((t) => t.paramName)
        )
      } catch {
        continue
      }
      extractedResources[resourceKey] = {
        fileName: routeName,
        fileType: FileType.JS,
        path: ['pages', 'api', 'page-state'],
        content: routeContent,
      }
    }

    effects.push(buildRuntimeTokenFetchEffect(group, routeName, tokens, dynamicRouteAttribute))
    anyGroupNeedsUser = anyGroupNeedsUser || needsUser
    anyGroupNeedsEntity = anyGroupNeedsEntity || needsEntity
  }

  if (effects.length === 0) {
    return
  }

  const returnIdx = componentBody.body.findIndex((stmt) => types.isReturnStatement(stmt))
  const insertIdx = returnIdx === -1 ? componentBody.body.length : returnIdx

  const hasDeclaration = (name: string) =>
    componentBody.body.some(
      (stmt) =>
        stmt.type === 'VariableDeclaration' &&
        stmt.declarations.some(
          (d) => d.id.type === 'Identifier' && (d.id as types.Identifier).name === name
        )
    )

  const statements: types.Statement[] = []
  if (anyGroupNeedsUser && !hasDeclaration('__pageStateCtx')) {
    statements.push(
      types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('__pageStateCtx'),
          types.callExpression(types.identifier('useGlobalContext'), [])
        ),
      ])
    )
  }
  if (anyGroupNeedsEntity && !hasDeclaration('__pageStateRouter')) {
    statements.push(
      types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('__pageStateRouter'),
          types.callExpression(types.identifier('useRouter'), [])
        ),
      ])
    )
  }
  statements.push(...effects)

  componentBody.body.splice(insertIdx, 0, ...statements)

  dependencies.useEffect = {
    type: 'library',
    path: 'react',
    version: '>=16.8.0',
    meta: { namedImport: true },
  }
  if (anyGroupNeedsUser) {
    dependencies.useGlobalContext = {
      type: 'local',
      path: '@/global-context',
      meta: { namedImport: true },
    }
  }
  if (anyGroupNeedsEntity) {
    dependencies.useRouter = {
      type: 'library',
      path: 'next/router',
      version: '^12.1.10',
      meta: { namedImport: true },
    }
  }
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
    const { buildTime: boundStates, runtimeUser: runtimeUserStates } =
      collectBoundStates(stateDefinitions)

    // States whose query references {{Current User.*}} / {{Current Page
    // Entity.id}} cannot be fetched at build time — emit an API route +
    // client-side fetch effect instead.
    if (runtimeUserStates.length > 0) {
      generateRuntimeTokenStateFetches(structure, runtimeUserStates, dataSources)
    }

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
          fetcherCode = generateDataSourceFetcherWithCore(
            dataSource,
            tableName,
            false,
            options.ecommerceSettings?.categories
          )
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
      // The discriminator keeps groups with the same table but different
      // fetch semantics (rawQuery/sorts/filters) on distinct identifiers.
      const rawDataPropKey = `__stateDs_${sanitizedDsId}_${sanitizedTable}_${group.fetchDiscriminator}_raw`

      // Check if this fetch is already registered in the parallel fetch metadata
      const parallelFetchMeta = getStaticPropsChunk.meta?.parallelFetchData as
        | ParallelFetchMeta
        | undefined
      const alreadyRegistered = parallelFetchMeta?.names.includes(rawDataPropKey)

      if (!alreadyRegistered) {
        // Every state in the group shares the same data source + table AND the
        // same fetch discriminator (rawQuery/sorts/static filters), so the
        // first state's definition is representative of the whole group.
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
