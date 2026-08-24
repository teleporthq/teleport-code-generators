import {
  FileType,
  ProjectPlugin,
  ProjectPluginStructure,
  UIDLGlobalStateDefinition,
  UIDLDataSource,
} from '@teleporthq/teleport-types'
import {
  generateDataSourceFetcherWithCore,
  buildProductTransformOptions,
} from '@teleporthq/teleport-plugin-next-data-source'
import { JSIdentifiers, StringUtils } from '@teleporthq/teleport-shared'
import {
  collectGlobalStateFetchConfigs,
  buildRefPathAccessCode,
  buildMappingFunctionCode,
  separateFilters,
  extractCurrentUserFields,
  generateRawQueryApiRoute,
  GlobalStateFetchConfig,
} from './data-source-utils'

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Local binding for a global state inside `GlobalStateProvider`.
 *
 * The context still publishes the entry under its DECLARED name (see
 * `buildContextValueEntry`) — only the `useState` binding is sanitised, because
 * a global state may legally be called `class`, which cannot be bound.
 */
const localBindingFor = (name: string): string => JSIdentifiers.createSafeJSIdentifier(name)

/** `fetchX` helper name for a data-source-bound global state. */
const fetchFunctionName = (name: string): string =>
  JSIdentifiers.createSafeJSIdentifier(`fetch${capitalize(name)}`)

/**
 * One `key: value` line of the context object. Emitted as shorthand whenever
 * the published key and the local binding are the same string, which keeps the
 * output byte-identical for every ordinary name.
 */
const buildContextValueEntry = (contextKey: string): string => {
  const local = localBindingFor(contextKey)
  if (local === contextKey) {
    return `    ${contextKey},`
  }
  return `    ${JSON.stringify(contextKey)}: ${local},`
}

const serializeDefaultValue = (
  value: string | number | boolean | Record<string, unknown> | unknown[]
): string => {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value)
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value)
  }
  return String(value)
}

// Reconcile the UIDL-declared type with the supplied default value before we
// emit it into useState(). The GUI lets users enter any default; an array-
// typed state with a stray object default (e.g. the placeholder
// `{"0":{"name":"Ion","description":"pasca"}}`) would compile but render
// nothing — every consumer does `Array.isArray(items)` first and bails out.
// Coerce mismatches to a sane empty-of-correct-type so the page renders an
// empty Repeater on first paint and the workflow's later setter cleanly
// replaces the value.
const normalizeDefaultValueForType = (
  value: string | number | boolean | Record<string, unknown> | unknown[],
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
): string | number | boolean | Record<string, unknown> | unknown[] => {
  switch (type) {
    case 'array':
      return Array.isArray(value) ? value : []
    case 'object':
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    case 'string':
      return typeof value === 'string' ? value : ''
    case 'number':
      if (typeof value === 'number' && !Number.isNaN(value)) {
        return value
      }
      if (typeof value === 'string') {
        const n = Number(value)
        if (!Number.isNaN(n)) {
          return n
        }
      }
      return 0
    case 'boolean':
      return typeof value === 'boolean' ? value : value === 'true'
    default:
      return value
  }
}

const generateGlobalStateContextFileContent = (
  definitions: Record<string, UIDLGlobalStateDefinition>,
  dataSources?: Record<string, UIDLDataSource>,
  hasAuth?: boolean
): string => {
  const defs = Object.values(definitions)
  if (defs.length === 0) {
    return ''
  }

  const fetchConfigs = dataSources ? collectGlobalStateFetchConfigs(definitions, dataSources) : []

  const needsCurrentUser = fetchConfigs.some((c) => c.needsCurrentUser)
  const hasFetchConfigs = fetchConfigs.length > 0

  const stateLines: string[] = []
  const valueEntries: string[] = []
  const memoDepEntries: string[] = []

  for (const def of defs) {
    const { name, defaultValue, type } = def
    const setterKey = StringUtils.createGlobalStateSetterName(name)
    const normalized = normalizeDefaultValueForType(defaultValue, type)
    const serialized = serializeDefaultValue(normalized)

    stateLines.push(
      `  const [${localBindingFor(name)}, ${localBindingFor(setterKey)}] = useState(${serialized})`
    )
    valueEntries.push(buildContextValueEntry(name))
    valueEntries.push(buildContextValueEntry(setterKey))
    memoDepEntries.push(localBindingFor(name))
  }

  // Build useEffect blocks and fetch functions for data-source-bound states
  const effectBlocks: string[] = []
  let refreshFunctionCode = ''

  if (hasFetchConfigs) {
    // Generate named fetch functions
    const fetchFunctionDefs: string[] = []
    for (const config of fetchConfigs) {
      fetchFunctionDefs.push(generateFetchFunctionForState(config))
    }

    // Group useEffect blocks: independent fetches vs user-dependent
    const independentFetches = fetchConfigs.filter((c) => !c.needsCurrentUser)
    const userDependentFetches = fetchConfigs.filter((c) => c.needsCurrentUser)

    if (independentFetches.length > 0) {
      const calls = independentFetches.map((c) => `    ${fetchFunctionName(c.name)}()`).join('\n')
      effectBlocks.push(`  useEffect(() => {\n${calls}\n  }, [])`)
    }

    if (userDependentFetches.length > 0) {
      const calls = userDependentFetches.map((c) => `    ${fetchFunctionName(c.name)}()`).join('\n')
      effectBlocks.push(`  useEffect(() => {\n${calls}\n  }, [currentUser])`)
    }

    // Build refreshGlobalState switch. The `case` label is the state's DECLARED
    // name — that is what `refreshGlobalState('<name>')` is called with.
    const cases = fetchConfigs
      .map((c) => {
        return `      case ${JSON.stringify(c.name)}:\n        ${fetchFunctionName(
          c.name
        )}()\n        break`
      })
      .join('\n')

    refreshFunctionCode = `
${fetchFunctionDefs.join('\n\n')}

  const refreshGlobalState = useCallback((stateName) => {
    switch (stateName) {
${cases}
    }
  }, [])`

    // Add refreshGlobalState to the context value
    valueEntries.push(`    refreshGlobalState,`)
    memoDepEntries.push('refreshGlobalState')
  }

  // Build imports
  const imports = ['createContext', 'useContext', 'useState', 'useMemo']
  if (hasFetchConfigs) {
    imports.push('useEffect', 'useCallback')
  }

  // Build the `currentUser` source. User-dependent fetches (and their
  // `useEffect([currentUser])` deps) always reference `currentUser`, so it must
  // be declared whenever `needsCurrentUser` is true — independently of auth.
  let globalContextImport = ''
  let currentUserLine = ''
  if (needsCurrentUser) {
    if (hasAuth) {
      // Auth enabled — read the signed-in user from the global auth context.
      globalContextImport = `import { useGlobalContext } from './global-context'\n`
      currentUserLine = `  const { currentUser } = useGlobalContext()\n`
    } else {
      // No authentication in this project — there is no signed-in user and no
      // global auth context to import from. Declare `currentUser` as null so the
      // user-dependent fetch guards (`if (!currentUser) return`) cleanly no-op
      // instead of throwing `ReferenceError: currentUser is not defined`.
      currentUserLine = `  const currentUser = null\n`
    }
  }

  return `import { ${imports.join(', ')} } from 'react'
${globalContextImport}
const GlobalStateContext = createContext(null)

export const GlobalStateProvider = ({ children }) => {
${currentUserLine}${stateLines.join('\n')}
${refreshFunctionCode}
${effectBlocks.join('\n\n')}

  const value = useMemo(() => ({
${valueEntries.join('\n')}
  }), [${memoDepEntries.join(', ')}])

  return (
    <GlobalStateContext.Provider value={value}>
      {children}
    </GlobalStateContext.Provider>
  )
}

export const useGlobalState = () => {
  const context = useContext(GlobalStateContext)
  if (!context) {
    throw new Error('useGlobalState must be used within a GlobalStateProvider')
  }
  return context
}
`
}

/**
 * Generates a named async fetch function for a data-source-bound global state.
 */
const generateFetchFunctionForState = (config: GlobalStateFetchConfig): string => {
  const { name, definition } = config
  const setterName = localBindingFor(StringUtils.createGlobalStateSetterName(name))
  const refPath = definition.dataSourceBinding?.refPath || []
  const filterResult = definition.filterConfig
    ? separateFilters(definition.filterConfig)
    : { staticFilters: [], dynamicFilters: [] }
  const staticFilters = filterResult.staticFilters

  const lines: string[] = []
  lines.push(`  const ${fetchFunctionName(name)} = async () => {`)
  lines.push(`    try {`)

  if (config.hasQuery) {
    const userFields = extractCurrentUserFields(definition.query)

    if (config.needsCurrentUser) {
      lines.push(`      if (!currentUser) return`)
    }

    if (userFields.length > 0) {
      const paramParts = userFields.map(
        (f) =>
          `\`currentUser${
            f.charAt(0).toUpperCase() + f.slice(1)
          }=\${encodeURIComponent(currentUser?.${f} || '')}\``
      )
      lines.push(`      const __queryParams = ${paramParts.join(` + '&' + `)}`)
      lines.push(`      const __res = await fetch(\`/api/global-state/${name}?\${__queryParams}\`)`)
    } else {
      lines.push(`      const __res = await fetch('/api/global-state/${name}')`)
    }
  } else {
    if (config.needsCurrentUser) {
      lines.push(`      if (!currentUser) return`)
    }

    const dynamicFilterParams: string[] = []
    if (config.hasDynamicFilters && definition.filterConfig) {
      const { dynamicFilters } = separateFilters(definition.filterConfig)
      for (const df of dynamicFilters) {
        if (df.dynamicRef?.id === 'Current User' && df.dynamicRef.refPath.length > 0) {
          const field = df.dynamicRef.refPath[df.dynamicRef.refPath.length - 1]
          dynamicFilterParams.push(
            `{ "source": ${JSON.stringify(
              df.source
            )}, "destination": currentUser?.${field}, "operand": ${JSON.stringify(df.operand)} }`
          )
        }
      }
    }

    const allFiltersParts: string[] = []
    if (staticFilters.length > 0) {
      allFiltersParts.push(JSON.stringify(staticFilters).slice(1, -1))
    }
    if (dynamicFilterParams.length > 0) {
      allFiltersParts.push(dynamicFilterParams.join(', '))
    }

    const paramParts: string[] = []
    if (definition.sortConfig && definition.sortConfig.length > 0) {
      paramParts.push(`sorts: ${JSON.stringify(JSON.stringify(definition.sortConfig))}`)
    }
    if (allFiltersParts.length > 0) {
      paramParts.push(`filters: JSON.stringify([${allFiltersParts.join(', ')}])`)
    }

    if (paramParts.length > 0) {
      lines.push(`      const __params = { ${paramParts.join(', ')} }`)
      lines.push(
        `      const __queryStr = Object.entries(__params).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&')`
      )
      lines.push(
        `      const __res = await fetch('/api/global-state/${name}' + (__queryStr ? '?' + __queryStr : ''))`
      )
    } else {
      lines.push(`      const __res = await fetch('/api/global-state/${name}')`)
    }
  }

  lines.push(`      const __result = await __res.json()`)
  lines.push(`      if (__result.success) {`)

  const extractedVar = buildRefPathAccessCode('__result.data', refPath)
  const fallbackForFetch = serializeDefaultValue(
    normalizeDefaultValueForType(definition.defaultValue, definition.type)
  )
  const valueExpr =
    extractedVar === '__result.data' ? '__result.data' : `(${extractedVar} ?? ${fallbackForFetch})`
  lines.push(`        let __extracted = ${valueExpr}`)

  if (definition.mappingFunction && definition.mappingFunction.trim()) {
    lines.push(buildMappingFunctionCode(definition.mappingFunction, '__extracted', '__mapped'))
    lines.push(`        ${setterName}(__mapped)`)
  } else {
    lines.push(`        ${setterName}(__extracted)`)
  }

  lines.push(`      }`)
  lines.push(`    } catch (__err) {`)
  lines.push(`      console.error('Failed to fetch global state "${name}":', __err)`)
  lines.push(`    }`)
  lines.push(`  }`)

  return lines.join('\n')
}

export class NextGlobalStateProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files } = structure
    const definitions = uidl.globalStateDefinitions
    if (!definitions || Object.keys(definitions).length === 0) {
      return structure
    }

    const dataSources = uidl.dataSources || {}
    const hasAuth = !!uidl.authentication

    const content = generateGlobalStateContextFileContent(definitions, dataSources, hasAuth)
    if (!content) {
      return structure
    }

    files.set('global-state-context', {
      path: [],
      files: [
        {
          name: 'global-state-context',
          fileType: FileType.JS,
          content,
        },
      ],
    })

    // Generate API routes for data-source-bound global states
    this.generateGlobalStateApiRoutes(structure, definitions, dataSources)

    this.injectGlobalStateProviderIntoApp(structure)

    return structure
  }

  /**
   * Wrap GlobalProvider's children with GlobalStateProvider so GlobalStateProvider
   * runs under GlobalProvider (useGlobalContext is defined there).
   */
  private wrapGlobalProviderChildrenWithGlobalState(content: string): string | null {
    const openRe = /<GlobalProvider[^>]*>/
    const match = content.match(openRe)
    if (!match || match.index === undefined) {
      return null
    }
    const openEnd = match.index + match[0].length
    let depth = 1
    let i = openEnd
    while (i < content.length && depth > 0) {
      const sub = content.slice(i)
      const nextOpenMatch = sub.match(/<GlobalProvider[\s>]/)
      const nextOpen = nextOpenMatch ? nextOpenMatch.index! + i : -1
      const nextClose = sub.indexOf('</GlobalProvider>')
      if (nextClose === -1) {
        return null
      }
      const closeIdx = nextClose + i
      const openIdx = nextOpen === -1 ? Infinity : nextOpen
      if (openIdx < closeIdx && openIdx !== Infinity) {
        depth++
        i = openIdx + 1
      } else {
        depth--
        if (depth === 0) {
          const inner = content.slice(openEnd, closeIdx)
          return (
            content.slice(0, openEnd) +
            `<GlobalStateProvider>${inner}</GlobalStateProvider>` +
            content.slice(closeIdx)
          )
        }
        i = closeIdx + 1
      }
    }
    return null
  }

  private generateGlobalStateApiRoutes(
    structure: ProjectPluginStructure,
    definitions: Record<string, UIDLGlobalStateDefinition>,
    dataSources: Record<string, UIDLDataSource>
  ): void {
    const fetchConfigs = collectGlobalStateFetchConfigs(definitions, dataSources)

    for (const config of fetchConfigs) {
      let apiRouteContent: string

      if (config.hasQuery) {
        apiRouteContent = generateRawQueryApiRoute(config.dataSource, config.definition.query)
      } else {
        try {
          apiRouteContent = generateDataSourceFetcherWithCore(
            config.dataSource,
            config.tableName,
            true, // isApiRoute
            buildProductTransformOptions(structure.uidl)
          )
        } catch {
          continue
        }
      }

      structure.files.set(`api-global-state-${config.name}`, {
        path: ['pages', 'api', 'global-state'],
        files: [
          {
            name: config.name,
            fileType: FileType.JS,
            content: apiRouteContent,
          },
        ],
      })
    }
  }

  private injectGlobalStateProviderIntoApp(structure: ProjectPluginStructure): void {
    const { files } = structure

    let appFile: any = null

    for (const [key, record] of Array.from(files.entries())) {
      if (key === '_app' || key.includes('_app')) {
        appFile = record.files?.find(
          (f: any) => f.name === '_app' && (f.fileType === 'js' || f.fileType === 'tsx')
        )
        if (appFile) {
          break
        }
      }
    }

    if (!appFile || typeof appFile.content !== 'string') {
      return
    }
    if (appFile.content.includes('GlobalStateProvider')) {
      return
    }

    let content = appFile.content

    const importStatement = `import { GlobalStateProvider } from '../global-state-context';\n`
    const firstImportIdx = content.indexOf('import ')
    if (firstImportIdx >= 0) {
      content = content.slice(0, firstImportIdx) + importStatement + content.slice(firstImportIdx)
    } else {
      content = importStatement + content
    }

    const wrapped = this.wrapGlobalProviderChildrenWithGlobalState(content)
    if (wrapped !== null) {
      appFile.content = wrapped
      return
    }

    const returnMatch = content.match(/return\s*\(\s*/)
    if (returnMatch && returnMatch.index !== undefined) {
      const afterReturn = returnMatch.index + returnMatch[0].length
      const restContent = content.slice(afterReturn)
      const closingParenIdx = findMatchingClosingParen(restContent)
      if (closingParenIdx >= 0) {
        const innerJSX = restContent.slice(0, closingParenIdx)
        const afterClosing = restContent.slice(closingParenIdx)
        content =
          content.slice(0, afterReturn) +
          `<GlobalStateProvider>${innerJSX}</GlobalStateProvider>` +
          afterClosing
      }
    }

    appFile.content = content
  }
}

function findMatchingClosingParen(str: string): number {
  let depth = 0
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (ch === '(') {
      depth++
    }
    if (ch === ')') {
      if (depth === 0) {
        return i
      }
      depth--
    }
  }
  return -1
}
