import { ComponentPlugin, ComponentPluginFactory } from '@teleporthq/teleport-types'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import { extractDataSourceIntoNextAPIFolder, extractDataSourceIntoGetStaticProps } from './utils'
import { createNextArrayMapperPaginationPlugin } from './pagination-plugin'

interface SearchConfig {
  searchEnabled: boolean
  searchDebounce: number
}

interface PaginationConfig {
  perPageMap: Map<string, number>
  searchConfigMap: Map<string, SearchConfig>
  queryColumnsMap: Map<string, string[]>
  limitMap: Map<string, number>
}

function extractPaginationConfigEarly(uidlNode: any, resources: any): PaginationConfig {
  const perPageMap = new Map<string, number>()
  const searchConfigMap = new Map<string, SearchConfig>()
  const queryColumnsMap = new Map<string, string[]>()
  const limitMap = new Map<string, number>()

  const dataSourceToRenderProp = new Map<string, string>()

  const traverse = (node: any): void => {
    if (!node || typeof node !== 'object') {
      return
    }

    if (
      node.type === 'data-source-list' &&
      node.content?.renderPropIdentifier &&
      node.content?.resource?.id
    ) {
      const renderProp = node.content.renderPropIdentifier
      const resourceId = node.content.resource.id
      dataSourceToRenderProp.set(resourceId, renderProp)

      // Try to get queryColumns from the node's resource params first
      if (node.content?.resource?.params?.queryColumns) {
        const queryColumnsValue = node.content.resource.params.queryColumns
        if (queryColumnsValue.type === 'static' && Array.isArray(queryColumnsValue.content)) {
          queryColumnsMap.set(renderProp, queryColumnsValue.content)
        }
      } else if (resources?.items?.[resourceId]?.params?.queryColumns) {
        const queryColumnsValue = resources.items[resourceId].params.queryColumns
        if (queryColumnsValue.type === 'static' && Array.isArray(queryColumnsValue.content)) {
          queryColumnsMap.set(renderProp, queryColumnsValue.content)
        }
      }

      // Extract limit parameter from resource.params.limit for plain array mappers
      if (node.content?.resource?.params?.limit) {
        const limitValue = node.content.resource.params.limit
        if (limitValue.type === 'static' && typeof limitValue.content === 'number') {
          limitMap.set(renderProp, limitValue.content)
        }
      } else if (resources?.items?.[resourceId]?.params?.limit) {
        const limitValue = resources.items[resourceId].params.limit
        if (limitValue.type === 'static' && typeof limitValue.content === 'number') {
          limitMap.set(renderProp, limitValue.content)
        }
      }
    }

    if (node.type === 'cms-list-repeater') {
      const perPage = node.content?.perPage
      const paginated = node.content?.paginated
      const renderProp = node.content?.renderPropIdentifier
      const searchEnabled = node.content?.searchEnabled
      const searchDebounce = node.content?.searchDebounce

      if (paginated && perPage && renderProp) {
        perPageMap.set(renderProp, perPage)
      }

      if (searchEnabled && renderProp) {
        searchConfigMap.set(renderProp, {
          searchEnabled: true,
          searchDebounce: searchDebounce || 300,
        })
      }

      if (node.content?.nodes?.list) {
        traverse(node.content.nodes.list)
      }
      if (node.content?.nodes?.empty) {
        traverse(node.content.nodes.empty)
      }
      if (node.content?.nodes?.loading) {
        traverse(node.content.nodes.loading)
      }
      return
    }

    if (node.content) {
      if (node.content.children && Array.isArray(node.content.children)) {
        for (const child of node.content.children) {
          traverse(child)
        }
      }
      if (node.content.node) {
        traverse(node.content.node)
      }
      if (node.content.nodes) {
        if (node.content.nodes.success) {
          traverse(node.content.nodes.success)
        }
        if (node.content.nodes.error) {
          traverse(node.content.nodes.error)
        }
        if (node.content.nodes.loading) {
          traverse(node.content.nodes.loading)
        }
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        traverse(child)
      }
    }
  }

  traverse(uidlNode)

  return { perPageMap, searchConfigMap, queryColumnsMap, limitMap }
}

export const createNextPagesDataSourcePlugin: ComponentPluginFactory<{}> = () => {
  const nextPagesDataSourcePlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, options, dependencies } = structure

    // Early return if no options or dataSources
    if (!options || !options.dataSources) {
      return structure
    }

    const { dataSources } = options

    // Check if dataSources is empty
    if (!dataSources || Object.keys(dataSources).length === 0) {
      return structure
    }

    const componentChunk = chunks.find((chunk) => chunk.name === 'jsx-component')
    if (!componentChunk) {
      return structure
    }

    // Check if extractedResources exists
    if (!options.extractedResources) {
      return structure
    }

    // Extract pagination and search config EARLY, before any transformations happen
    const opts = options as any
    if (!opts.paginationConfig) {
      opts.paginationConfig = {
        perPageMap: new Map<string, number>(),
        searchConfigMap: new Map<string, SearchConfig>(),
        queryColumnsMap: new Map<string, string[]>(),
        limitMap: new Map<string, number>(),
      }
    }

    // Extract for THIS page and merge with existing maps
    const pageConfig = extractPaginationConfigEarly(uidl.node, (uidl as any).resources)
    pageConfig.perPageMap.forEach((perPage, dataSourceId) => {
      opts.paginationConfig.perPageMap.set(dataSourceId, perPage)
    })
    pageConfig.searchConfigMap.forEach((searchConfig, dataSourceId) => {
      opts.paginationConfig.searchConfigMap.set(dataSourceId, searchConfig)
    })
    pageConfig.queryColumnsMap.forEach((queryColumns, dataSourceId) => {
      opts.paginationConfig.queryColumnsMap.set(dataSourceId, queryColumns)
    })
    pageConfig.limitMap.forEach((limit, dataSourceId) => {
      opts.paginationConfig.limitMap.set(dataSourceId, limit)
    })

    let getStaticPropsChunk = chunks.find((chunk) => chunk.name === 'getStaticProps')

    // Track which dataSourceId + tableName combinations have been processed
    const processedDataSources = new Set<string>()

    UIDLUtils.traverseNodes(uidl.node, (node) => {
      // Data source nodes can be either:
      // 1. Direct: node.type === 'data-source-item' or 'data-source-list'
      // 2. Wrapped in element: node.type === 'element' && node.content.type === 'data-source-item' or 'data-source-list'

      let dataSourceNode = null

      if (node.type === 'data-source-item' || node.type === 'data-source-list') {
        // Direct data source node
        dataSourceNode = node
      } else if (
        node.type === 'element' &&
        node.content &&
        typeof node.content === 'object' &&
        'type' in node.content &&
        (node.content.type === 'data-source-item' || node.content.type === 'data-source-list')
      ) {
        // Element node wrapping a data source node
        // tslint:disable-next-line:no-any
        dataSourceNode = node.content as any
      }

      if (!dataSourceNode) {
        return
      }

      // Check if node has initialData (means it's already connected to getStaticProps)
      if (
        dataSourceNode.content.initialData !== undefined ||
        dataSourceNode.content.resource === undefined
      ) {
        return
      }

      // Get dataSourceId and tableName to create unique key
      const resourceDef = dataSourceNode.content.resourceDefinition
      if (!resourceDef) {
        return
      }

      const dataSourceKey = `${resourceDef.dataSourceId}:${resourceDef.tableName || 'data'}`

      // Check if resource has dynamic parameters
      // tslint:disable-next-line:no-any
      const hasResourceDynamicParams = dataSourceNode.content.resource?.params
        ? Object.values(dataSourceNode.content.resource.params).some(
            (param: any) => param.type === 'expr' || param.type === 'dynamic'
          )
        : false

      // If no dynamic params, extract to getStaticProps (server-side)
      // Otherwise, extract to API route (client-side)
      if (!hasResourceDynamicParams) {
        // Skip if we've already processed this dataSource + table combination
        if (processedDataSources.has(dataSourceKey)) {
          return
        }

        const result = extractDataSourceIntoGetStaticProps(
          dataSourceNode,
          dataSources,
          componentChunk,
          getStaticPropsChunk,
          chunks,
          options.extractedResources,
          dependencies
        )

        if (result.success && result.chunk) {
          getStaticPropsChunk = result.chunk
          // Mark this dataSource + table as processed
          processedDataSources.add(dataSourceKey)
        }
      } else {
        extractDataSourceIntoNextAPIFolder(
          dataSourceNode,
          dataSources,
          componentChunk,
          options.extractedResources
        )
      }
    })

    const paginationPlugin = createNextArrayMapperPaginationPlugin()
    return paginationPlugin(structure)
  }

  return nextPagesDataSourcePlugin
}

export const createNextComponentDataSourcePlugin: ComponentPluginFactory<{}> = () => {
  const nextComponentDataSourcePlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, options } = structure

    // Early return if no options or dataSources
    if (!options || !options.dataSources) {
      return structure
    }

    const { dataSources } = options

    // Check if dataSources is empty
    if (!dataSources || Object.keys(dataSources).length === 0) {
      return structure
    }

    // Extract pagination and search config EARLY, before any transformations happen
    const opts = options as any
    if (!opts.paginationConfig) {
      opts.paginationConfig = {
        perPageMap: new Map<string, number>(),
        searchConfigMap: new Map<string, SearchConfig>(),
        queryColumnsMap: new Map<string, string[]>(),
        limitMap: new Map<string, number>(),
      }
    }

    // Extract for THIS component and merge with existing maps
    const componentConfig = extractPaginationConfigEarly(uidl.node, (uidl as any).resources)
    componentConfig.perPageMap.forEach((perPage, dataSourceId) => {
      opts.paginationConfig.perPageMap.set(dataSourceId, perPage)
    })
    componentConfig.searchConfigMap.forEach((searchConfig, dataSourceId) => {
      opts.paginationConfig.searchConfigMap.set(dataSourceId, searchConfig)
    })
    componentConfig.queryColumnsMap.forEach((queryColumns, dataSourceId) => {
      opts.paginationConfig.queryColumnsMap.set(dataSourceId, queryColumns)
    })
    componentConfig.limitMap.forEach((limit, dataSourceId) => {
      opts.paginationConfig.limitMap.set(dataSourceId, limit)
    })

    const componentChunk = chunks.find((chunk) => chunk.name === 'jsx-component')
    if (!componentChunk) {
      return structure
    }

    // Check if extractedResources exists
    if (!options.extractedResources) {
      return structure
    }

    UIDLUtils.traverseNodes(uidl.node, (node) => {
      // Data source nodes can be either:
      // 1. Direct: node.type === 'data-source-item' or 'data-source-list'
      // 2. Wrapped in element: node.type === 'element' && node.content.type === 'data-source-item' or 'data-source-list'

      let dataSourceNode = null

      if (node.type === 'data-source-item' || node.type === 'data-source-list') {
        // Direct data source node
        dataSourceNode = node
      } else if (
        node.type === 'element' &&
        node.content &&
        typeof node.content === 'object' &&
        'type' in node.content &&
        (node.content.type === 'data-source-item' || node.content.type === 'data-source-list')
      ) {
        // Element node wrapping a data source node
        // tslint:disable-next-line:no-any
        dataSourceNode = node.content as any
      }

      if (!dataSourceNode) {
        return
      }

      extractDataSourceIntoNextAPIFolder(
        dataSourceNode,
        dataSources,
        componentChunk,
        options.extractedResources
      )
    })

    const paginationPlugin = createNextArrayMapperPaginationPlugin()
    return paginationPlugin(structure)
  }

  return nextComponentDataSourcePlugin
}

export * from './data-source-fetchers'
export * from './utils'
export * from './array-mapper-pagination'
export * from './pagination-plugin'
export * from './count-fetchers'
