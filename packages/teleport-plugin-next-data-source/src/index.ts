import { ComponentPlugin, ComponentPluginFactory } from '@teleporthq/teleport-types'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import { extractDataSourceIntoNextAPIFolder, extractDataSourceIntoGetStaticProps } from './utils'

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

    return structure
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

    return structure
  }

  return nextComponentDataSourcePlugin
}

export * from './data-source-fetchers'
export * from './utils'
