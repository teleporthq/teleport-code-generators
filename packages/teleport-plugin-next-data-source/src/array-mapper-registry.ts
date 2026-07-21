/**
 * ArrayMapperRegistry - Centralized registry for managing array mappers,
 * their associated states, search inputs, and pagination buttons.
 *
 * This ensures consistent index usage across:
 * - Component state declarations
 * - DataProvider params
 * - getStaticProps fetch calls and prop names
 * - Search input bindings
 * - Pagination button bindings
 */

export type MapperType = 'paginated' | 'pagination-only' | 'search-only' | 'plain'

export interface ArrayMapperRegistryEntry {
  registryIndex: number
  type: MapperType
  dataSourceIdentifier: string
  arrayMapperRenderProp: string
  uidlGlobalIndex: number

  paginated: boolean
  searchEnabled: boolean
  perPage: number
  searchDebounce: number
  searchDefaultValue?: string
  queryColumns: string[]

  stateVarPrefix: string
  pageStateVar?: string
  setPageStateVar?: string
  maxPagesStateVar?: string
  setMaxPagesStateVar?: string
  combinedStateVar?: string
  setCombinedStateVar?: string
  searchQueryVar?: string
  setSearchQueryVar?: string
  debouncedSearchQueryVar?: string
  setDebouncedSearchQueryVar?: string
  skipDebounceRefVar?: string

  getStaticPropsDataVar: string
  getStaticPropsMaxPagesVar: string
  getStaticPropsPropName: string
  getStaticPropsMaxPagesPropName: string

  searchInputClass?: string
  paginationNodeClass?: string
  prevButtonClass?: string
  nextButtonClass?: string

  dataProviderJSX?: any
  searchInputJSX?: any
}

export class ArrayMapperRegistry {
  private entries: ArrayMapperRegistryEntry[] = []
  private paginatedCount = 0
  private paginationOnlyCount = 0
  private searchOnlyCount = 0
  private plainCount = 0

  registerFromUIDL(config: {
    dataSourceIdentifier: string
    arrayMapperRenderProp: string
    uidlGlobalIndex: number
    paginated: boolean
    searchEnabled: boolean
    perPage?: number
    searchDebounce?: number
    searchDefaultValue?: string
    queryColumns?: string[]
  }): ArrayMapperRegistryEntry {
    const type = this.determineType(config.paginated, config.searchEnabled)
    const typeIndex = this.getTypeIndex(type)
    const registryIndex = this.entries.length

    const stateVarPrefix = this.generateStateVarPrefix(type, typeIndex)

    const entry: ArrayMapperRegistryEntry = {
      registryIndex,
      type,
      dataSourceIdentifier: config.dataSourceIdentifier,
      arrayMapperRenderProp: config.arrayMapperRenderProp,
      uidlGlobalIndex: config.uidlGlobalIndex,

      paginated: config.paginated,
      searchEnabled: config.searchEnabled,
      perPage: config.perPage || 10,
      searchDebounce: config.searchDebounce || 300,
      searchDefaultValue: config.searchDefaultValue,
      queryColumns: config.queryColumns || [],

      stateVarPrefix,
      ...this.generateStateVarNames(stateVarPrefix, config.paginated, config.searchEnabled),
      ...this.generateGetStaticPropsVarNames(config.dataSourceIdentifier, type, typeIndex),
    }

    this.entries.push(entry)
    this.incrementTypeCount(type)

    return entry
  }

  getEntry(registryIndex: number): ArrayMapperRegistryEntry | undefined {
    return this.entries[registryIndex]
  }

  getEntryByUIDLIndex(uidlGlobalIndex: number): ArrayMapperRegistryEntry | undefined {
    return this.entries.find((e) => e.uidlGlobalIndex === uidlGlobalIndex)
  }

  getEntriesByType(type: MapperType): ArrayMapperRegistryEntry[] {
    return this.entries.filter((e) => e.type === type)
  }

  getAllEntries(): ArrayMapperRegistryEntry[] {
    return [...this.entries]
  }

  getPaginatedEntries(): ArrayMapperRegistryEntry[] {
    return this.getEntriesByType('paginated')
  }

  getPaginationOnlyEntries(): ArrayMapperRegistryEntry[] {
    return this.getEntriesByType('pagination-only')
  }

  getSearchOnlyEntries(): ArrayMapperRegistryEntry[] {
    return this.getEntriesByType('search-only')
  }

  getPlainEntries(): ArrayMapperRegistryEntry[] {
    return this.getEntriesByType('plain')
  }

  updateJSXReferences(
    registryIndex: number,
    updates: Partial<
      Pick<
        ArrayMapperRegistryEntry,
        | 'dataProviderJSX'
        | 'searchInputJSX'
        | 'searchInputClass'
        | 'paginationNodeClass'
        | 'prevButtonClass'
        | 'nextButtonClass'
      >
    >
  ): void {
    const entry = this.entries[registryIndex]
    if (entry) {
      Object.assign(entry, updates)
    }
  }

  getStateInitializationMaxPagesPropName(entry: ArrayMapperRegistryEntry): string {
    return entry.getStaticPropsMaxPagesPropName
  }

  toDebugSummary(): string {
    return JSON.stringify(
      this.entries.map((e) => ({
        registryIndex: e.registryIndex,
        type: e.type,
        dataSource: e.dataSourceIdentifier,
        renderProp: e.arrayMapperRenderProp,
        uidlIndex: e.uidlGlobalIndex,
        statePrefix: e.stateVarPrefix,
        getStaticPropsProp: e.getStaticPropsPropName,
      })),
      null,
      2
    )
  }

  private determineType(paginated: boolean, searchEnabled: boolean): MapperType {
    if (paginated && searchEnabled) {
      return 'paginated'
    }

    if (paginated && !searchEnabled) {
      return 'pagination-only'
    }

    if (!paginated && searchEnabled) {
      return 'search-only'
    }

    return 'plain'
  }

  private getTypeIndex(type: MapperType): number {
    switch (type) {
      case 'paginated':
        return this.paginatedCount
      case 'pagination-only':
        return this.paginationOnlyCount
      case 'search-only':
        return this.searchOnlyCount
      case 'plain':
        return this.plainCount
      default:
        return 0
    }
  }

  private incrementTypeCount(type: MapperType): void {
    switch (type) {
      case 'paginated':
        this.paginatedCount++
        break
      case 'pagination-only':
        this.paginationOnlyCount++
        break
      case 'search-only':
        this.searchOnlyCount++
        break
      case 'plain':
        this.plainCount++
        break
      default:
        break
    }
  }

  private generateStateVarPrefix(type: MapperType, typeIndex: number): string {
    switch (type) {
      case 'paginated':
        return `pg_${typeIndex}`
      case 'pagination-only':
        return `paginationOnly_${typeIndex}`
      case 'search-only':
        return `searchOnly_${typeIndex}`
      case 'plain':
        return `plain_${typeIndex}`
      default:
        return ''
    }
  }

  private generateStateVarNames(
    prefix: string,
    paginated: boolean,
    searchEnabled: boolean
  ): Partial<ArrayMapperRegistryEntry> {
    const result: Partial<ArrayMapperRegistryEntry> = {}

    if (paginated) {
      if (searchEnabled) {
        result.combinedStateVar = `paginationState_${prefix}`
        result.setCombinedStateVar = `setPaginationState_${prefix}`
        result.pageStateVar = `paginationState_${prefix}.page`
        result.setPageStateVar = `setPaginationState_${prefix}`
      } else {
        result.pageStateVar = `${prefix}_page`
        result.setPageStateVar = `set${this.capitalize(prefix)}_page`
      }
      result.maxPagesStateVar = `pagination_${prefix}_maxPages`
      result.setMaxPagesStateVar = `setPagination_${prefix}_maxPages`
    } else {
      result.pageStateVar = ''
      result.setPageStateVar = ''
      result.maxPagesStateVar = ''
      result.setMaxPagesStateVar = ''
    }

    if (searchEnabled) {
      result.searchQueryVar = `search_${prefix}_query`
      result.setSearchQueryVar = `setSearch_${prefix}_query`
      result.debouncedSearchQueryVar = `debouncedSearch_${prefix}_query`
      result.setDebouncedSearchQueryVar = `setDebouncedSearch_${prefix}_query`
      result.skipDebounceRefVar = `skipDebounceOnMount_${prefix}`
    }

    return result
  }

  private generateGetStaticPropsVarNames(
    dataSourceIdentifier: string,
    type: MapperType,
    typeIndex: number
  ): Pick<
    ArrayMapperRegistryEntry,
    | 'getStaticPropsDataVar'
    | 'getStaticPropsMaxPagesVar'
    | 'getStaticPropsPropName'
    | 'getStaticPropsMaxPagesPropName'
  > {
    let suffix: string
    switch (type) {
      case 'paginated':
        suffix = `pg_${typeIndex}`
        break
      case 'pagination-only':
        suffix = `paginationOnly_${typeIndex}`
        break
      case 'search-only':
        suffix = `searchOnly_${typeIndex}`
        break
      case 'plain':
        suffix = `plain_${typeIndex}`
        break
      default:
        suffix = `plain_${typeIndex}`
        break
    }

    const dataVar = `${dataSourceIdentifier}_${suffix}`
    const maxPagesVar = `${dataSourceIdentifier}_${suffix}_maxPages`

    return {
      getStaticPropsDataVar: dataVar,
      getStaticPropsMaxPagesVar: maxPagesVar,
      getStaticPropsPropName: dataVar,
      getStaticPropsMaxPagesPropName: maxPagesVar,
    }
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }
}

export function createRegistryFromUIDL(uidlNode: any, allResources: any): ArrayMapperRegistry {
  const registry = new ArrayMapperRegistry()

  const visitedRepeaterKeys = new Set<string>()
  let uidlGlobalIndex = 0

  const findQueryColumns = (
    resourceId: string,
    nodeResource: any,
    registryResources: any
  ): string[] | undefined => {
    if (nodeResource?.params?.queryColumns) {
      const val = nodeResource.params.queryColumns
      if (val.type === 'static' && Array.isArray(val.content)) {
        return val.content
      }
    }
    if (registryResources?.items?.[resourceId]?.params?.queryColumns) {
      const val = registryResources.items[resourceId].params.queryColumns
      if (val.type === 'static' && Array.isArray(val.content)) {
        return val.content
      }
    }
    return undefined
  }

  const traverse = (node: any, currentDataSourceId?: string): void => {
    if (!node || typeof node !== 'object') {
      return
    }

    if (node.type === 'data-source-list' && node.content?.renderPropIdentifier) {
      currentDataSourceId = node.content.renderPropIdentifier
    }

    if (node.type === 'cms-list-repeater' && node.content?.renderPropIdentifier) {
      const c = node.content
      const repeaterKey = `${c.renderPropIdentifier}|${c.paginated}|${c.searchEnabled}|${
        c.perPage || 'default'
      }|${c.source || ''}`

      if (visitedRepeaterKeys.has(repeaterKey)) {
        return
      }
      visitedRepeaterKeys.add(repeaterKey)

      const resourceId = c.resource?.id
      let queryColumns: string[] | undefined
      if (resourceId) {
        queryColumns = findQueryColumns(resourceId, c.resource, allResources)
      }

      const rawDefault = c.searchDefaultValue
      const searchDefaultValue =
        rawDefault &&
        rawDefault.type === 'static' &&
        typeof rawDefault.content === 'string' &&
        rawDefault.content.length > 0
          ? rawDefault.content
          : undefined

      registry.registerFromUIDL({
        dataSourceIdentifier: currentDataSourceId || 'unknown',
        arrayMapperRenderProp: c.renderPropIdentifier,
        uidlGlobalIndex: uidlGlobalIndex++,
        paginated: !!c.paginated,
        searchEnabled: !!c.searchEnabled,
        perPage: c.perPage,
        searchDebounce: c.searchDebounce,
        searchDefaultValue,
        queryColumns,
      })
    }

    if (node.content?.children && Array.isArray(node.content.children)) {
      node.content.children.forEach((child: any) => traverse(child, currentDataSourceId))
    }
    if (node.content?.node) {
      traverse(node.content.node, currentDataSourceId)
    }
    if (node.content?.nodes) {
      Object.values(node.content.nodes).forEach((n: any) => traverse(n, currentDataSourceId))
    }
    if (Array.isArray(node.children)) {
      node.children.forEach((child: any) => traverse(child, currentDataSourceId))
    }
  }

  traverse(uidlNode)

  return registry
}
