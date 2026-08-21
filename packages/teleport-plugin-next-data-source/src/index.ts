import {
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
  ChunkType,
  UIDLComponentSEO,
  UIDLDynamicReference,
} from '@teleporthq/teleport-types'
import { UIDLUtils, StringUtils } from '@teleporthq/teleport-shared'
import {
  extractDataSourceIntoNextAPIFolder,
  extractDataSourceIntoGetStaticProps,
  sanitizeFileName,
  hasUnresolvableDynamicParams,
} from './utils'
import { createNextArrayMapperPaginationPlugin } from './pagination-plugin'
import { DATA_SOURCE_ISR_REVALIDATE_SECONDS } from './isr'
import * as types from '@babel/types'

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

interface DataSourceInfo {
  dataSourceId: string
  tableName: string
  dataSourceType: string
  basePropKey: string
  fileName: string
}

interface WrappedDataProviderInfo {
  propKey: string
  dataSourceInfo: DataSourceInfo
}

interface WrapContext {
  counter: number
  wrappedProviders: WrappedDataProviderInfo[]
  isPage: boolean
  fileName: string
  existingPropKeys: Set<string>
}

// Prefix used to clearly differentiate wrapped data source expression props
// from user-defined or standard renderPropIdentifier values
const WRAPPED_DS_EXPR_PREFIX = '__dsExpr_'

function containsDataSourceDataReference(astNode: any): boolean {
  if (!astNode || typeof astNode !== 'object') {
    return false
  }

  if (astNode.type === 'Identifier' && astNode.name === 'dataSourceData') {
    return true
  }

  for (const key of Object.keys(astNode)) {
    const value = astNode[key]
    if (Array.isArray(value)) {
      for (const item of value) {
        if (containsDataSourceDataReference(item)) {
          return true
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      if (containsDataSourceDataReference(value)) {
        return true
      }
    }
  }

  return false
}

function replaceDataSourceDataWithRenderProp(astNode: any, renderPropName: string): void {
  if (!astNode || typeof astNode !== 'object') {
    return
  }

  if (astNode.type === 'Identifier' && astNode.name === 'dataSourceData') {
    astNode.name = renderPropName
  }

  for (const key of Object.keys(astNode)) {
    const value = astNode[key]
    if (Array.isArray(value)) {
      value.forEach((item) => replaceDataSourceDataWithRenderProp(item, renderPropName))
    } else if (typeof value === 'object' && value !== null) {
      replaceDataSourceDataWithRenderProp(value, renderPropName)
    }
  }
}

function wrapElementInDataProvider(
  elementNode: types.JSXElement | types.JSXFragment,
  dataSourceInfo: DataSourceInfo,
  context: WrapContext
): types.JSXElement {
  context.counter++

  // Generate a unique prop key with clear prefix to avoid collision with user-defined names
  // Format: __dsExpr_{basePropKey}_{counter}
  // The double underscore prefix is a convention for internal/generated identifiers
  let uniquePropKey = `${WRAPPED_DS_EXPR_PREFIX}${dataSourceInfo.basePropKey}_${context.counter}`

  // Ensure uniqueness by checking against existing prop keys
  while (context.existingPropKeys.has(uniquePropKey)) {
    context.counter++
    uniquePropKey = `${WRAPPED_DS_EXPR_PREFIX}${dataSourceInfo.basePropKey}_${context.counter}`
  }

  // Mark this key as used
  context.existingPropKeys.add(uniquePropKey)

  replaceDataSourceDataWithRenderProp(elementNode, uniquePropKey)

  context.wrappedProviders.push({
    propKey: uniquePropKey,
    dataSourceInfo,
  })

  const dataProviderNode = types.jsxElement(
    types.jsxOpeningElement(types.jsxIdentifier('DataProvider'), [], false),
    types.jsxClosingElement(types.jsxIdentifier('DataProvider')),
    [],
    false
  )

  dataProviderNode.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('resourceDefinition'),
      types.jsxExpressionContainer(
        types.objectExpression([
          types.objectProperty(
            types.stringLiteral('type'),
            types.stringLiteral('external-data-source')
          ),
          types.objectProperty(
            types.stringLiteral('dataSourceId'),
            types.stringLiteral(dataSourceInfo.dataSourceId)
          ),
          types.objectProperty(
            types.stringLiteral('tableName'),
            types.stringLiteral(dataSourceInfo.tableName)
          ),
          types.objectProperty(
            types.stringLiteral('dataSourceType'),
            types.stringLiteral(dataSourceInfo.dataSourceType)
          ),
        ])
      )
    )
  )

  dataProviderNode.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('name'),
      types.jsxExpressionContainer(types.stringLiteral(uniquePropKey))
    )
  )

  const renderSuccessFunction = types.arrowFunctionExpression(
    [types.identifier(uniquePropKey)],
    elementNode
  )

  dataProviderNode.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('renderSuccess'),
      types.jsxExpressionContainer(renderSuccessFunction)
    )
  )

  if (context.isPage) {
    dataProviderNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('initialData'),
        types.jsxExpressionContainer(
          types.memberExpression(types.identifier('props'), types.identifier(uniquePropKey))
        )
      )
    )

    dataProviderNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('persistDataDuringLoading'),
        types.jsxExpressionContainer(types.booleanLiteral(true))
      )
    )
  } else {
    const fetchDataAST = types.arrowFunctionExpression(
      [],
      types.callExpression(
        types.memberExpression(
          types.callExpression(types.identifier('fetch'), [
            types.stringLiteral(`/api/${dataSourceInfo.fileName}`),
            types.objectExpression([
              types.objectProperty(
                types.identifier('headers'),
                types.objectExpression([
                  types.objectProperty(
                    types.stringLiteral('Content-Type'),
                    types.stringLiteral('application/json')
                  ),
                ])
              ),
            ]),
          ]),
          types.identifier('then')
        ),
        [
          types.arrowFunctionExpression(
            [types.identifier('res')],
            types.callExpression(
              types.memberExpression(
                types.callExpression(
                  types.memberExpression(types.identifier('res'), types.identifier('json')),
                  []
                ),
                types.identifier('then')
              ),
              [
                types.arrowFunctionExpression(
                  [types.identifier('response')],
                  types.optionalMemberExpression(
                    types.identifier('response'),
                    types.identifier('data'),
                    false,
                    true
                  )
                ),
              ]
            )
          ),
        ]
      )
    )

    dataProviderNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('fetchData'),
        types.jsxExpressionContainer(fetchDataAST)
      )
    )

    dataProviderNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('persistDataDuringLoading'),
        types.jsxExpressionContainer(types.booleanLiteral(true))
      )
    )
  }

  return dataProviderNode
}

function wrapDataSourceExpressionsInAttributes(
  astNode: any,
  dataSourceInfo: DataSourceInfo | null,
  context: WrapContext,
  dependencies: Record<string, any>
): void {
  if (!astNode || typeof astNode !== 'object' || !dataSourceInfo) {
    return
  }

  if (astNode.type === 'JSXElement' && astNode.openingElement?.attributes) {
    const attrs = astNode.openingElement.attributes as types.JSXAttribute[]

    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i]
      if (
        attr.type === 'JSXAttribute' &&
        attr.value &&
        attr.value.type === 'JSXExpressionContainer'
      ) {
        const expr = attr.value.expression

        if (
          (expr.type === 'JSXElement' || expr.type === 'JSXFragment') &&
          containsDataSourceDataReference(expr)
        ) {
          dependencies.DataProvider = {
            type: 'package',
            path: '@teleporthq/react-components',
            version: 'latest',
            meta: {
              namedImport: true,
            },
          }

          const wrappedElement = wrapElementInDataProvider(
            expr as types.JSXElement | types.JSXFragment,
            dataSourceInfo,
            context
          )

          attr.value = types.jsxExpressionContainer(wrappedElement)
        }
      }
    }
  }

  for (const key of Object.keys(astNode)) {
    const value = astNode[key]
    if (Array.isArray(value)) {
      value.forEach((item) =>
        wrapDataSourceExpressionsInAttributes(item, dataSourceInfo, context, dependencies)
      )
    } else if (typeof value === 'object' && value !== null) {
      wrapDataSourceExpressionsInAttributes(value, dataSourceInfo, context, dependencies)
    }
  }
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

    // Track the first data source info for wrapping dataSourceData expressions
    let firstDataSourceInfo: DataSourceInfo | null = null
    // Track fetcher import name for wrapped providers
    let fetcherImportName: string | null = null
    // Track the position counter for each (dataSourceId, tableName) combination
    // This is used to match the correct DataProvider in the JSX based on UIDL order
    const dataProviderPositionCounters = new Map<string, number>()

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

      // Track the position of this data-source-list for matching the correct DataProvider
      // The key is (dataSourceId, tableName) since all matching DataProviders share these
      const positionKey = `${resourceDef.dataSourceId}:${resourceDef.tableName || 'data'}`
      const currentPosition = dataProviderPositionCounters.get(positionKey) || 0
      dataProviderPositionCounters.set(positionKey, currentPosition + 1)

      // Check if this data-source-list contains a cms-list-repeater with pagination or search
      // If so, skip it - the pagination plugin will handle the data fetching
      // tslint:disable-next-line:no-any
      const hasPaginatedOrSearchRepeater = (nodeToCheck: any): boolean => {
        if (!nodeToCheck || typeof nodeToCheck !== 'object') {
          return false
        }

        if (nodeToCheck.type === 'cms-list-repeater') {
          const content = nodeToCheck.content
          if (content?.paginated || content?.searchEnabled) {
            return true
          }
        }

        // Check children array
        if (nodeToCheck.content?.children && Array.isArray(nodeToCheck.content.children)) {
          for (const child of nodeToCheck.content.children) {
            if (hasPaginatedOrSearchRepeater(child)) {
              return true
            }
          }
        }

        // Check nodes object (data-source-list has nodes.success, nodes.error, etc.)
        if (nodeToCheck.content?.nodes && typeof nodeToCheck.content.nodes === 'object') {
          for (const nodeKey of Object.keys(nodeToCheck.content.nodes)) {
            if (hasPaginatedOrSearchRepeater(nodeToCheck.content.nodes[nodeKey])) {
              return true
            }
          }
        }

        return false
      }

      if (hasPaginatedOrSearchRepeater(dataSourceNode)) {
        // Skip this node but position counter is already incremented above
        return
      }

      // Check if resource has dynamic parameters that can't be resolved server-side
      const dynamicRouteAttr = uidl.outputOptions?.dynamicRouteAttribute
      // tslint:disable-next-line:no-any
      const hasResourceDynamicParams = dataSourceNode.content.resource?.params
        ? hasUnresolvableDynamicParams(dataSourceNode.content.resource.params, dynamicRouteAttr)
        : false

      // If no dynamic params (or all are route-resolvable), extract to getStaticProps (server-side)
      // Otherwise, extract to API route (client-side)
      if (!hasResourceDynamicParams) {
        // extractDataSourceIntoGetStaticProps is called for every UIDL data-source node.
        // When multiple nodes share the same dataSourceKey (same resource ID), the function is
        // idempotent for getStaticProps (skips duplicate fetches via existingInFetchMeta) but
        // still updates the next uninitialized DataProvider JSX node on each call.
        const result = extractDataSourceIntoGetStaticProps(
          dataSourceNode,
          dataSources,
          componentChunk,
          getStaticPropsChunk,
          chunks,
          options.extractedResources,
          dependencies,
          dynamicRouteAttr,
          uidl.outputOptions?.folderPath,
          options.ecommerceSettings?.categories
        )

        if (result.success && result.chunk) {
          getStaticPropsChunk = result.chunk

          // Track the first data source info for wrapping dataSourceData expressions
          if (!firstDataSourceInfo) {
            const dataSource = dataSources[resourceDef.dataSourceId]
            if (dataSource) {
              const sanitizedDsName = StringUtils.dashCaseToCamelCase(
                sanitizeFileName(dataSource.name || resourceDef.dataSourceId)
              )
              const sanitizedTableName = StringUtils.dashCaseToCamelCase(
                sanitizeFileName(resourceDef.tableName || 'data')
              )
              const fileName = StringUtils.camelCaseToDashCase(
                `${sanitizeFileName(resourceDef.dataSourceType)}-${sanitizeFileName(
                  resourceDef.tableName || 'data'
                )}-${sanitizeFileName(resourceDef.dataSourceId).substring(0, 8)}`
              )
              firstDataSourceInfo = {
                dataSourceId: resourceDef.dataSourceId,
                tableName: resourceDef.tableName || 'data',
                dataSourceType: resourceDef.dataSourceType,
                basePropKey: `${sanitizedDsName}_${sanitizedTableName}_data`,
                fileName,
              }
              fetcherImportName = StringUtils.dashCaseToCamelCase(fileName)
            }
          }
        }
      } else {
        extractDataSourceIntoNextAPIFolder(
          dataSourceNode,
          dataSources,
          componentChunk,
          options.extractedResources,
          options.ecommerceSettings?.categories
        )
      }
    })

    // After processing all data source nodes, wrap any element props containing dataSourceData
    // expressions in a DataProvider
    if (firstDataSourceInfo && componentChunk.content) {
      // Collect existing prop keys from getStaticProps to avoid collisions
      const existingPropKeys = new Set<string>()

      if (getStaticPropsChunk) {
        try {
          const funcDecl = (getStaticPropsChunk.content as types.ExportNamedDeclaration)
            .declaration as types.FunctionDeclaration
          const tryStmt = funcDecl.body.body.find(
            (s) => s.type === 'TryStatement'
          ) as types.TryStatement
          if (tryStmt) {
            const retStmt = tryStmt.block.body.find(
              (s) => s.type === 'ReturnStatement'
            ) as types.ReturnStatement
            if (retStmt) {
              const propsProp = (retStmt.argument as types.ObjectExpression).properties.find(
                (p) => ((p as types.ObjectProperty).key as types.Identifier).name === 'props'
              ) as types.ObjectProperty
              if (propsProp) {
                const propsVal = propsProp.value as types.ObjectExpression
                for (const prop of propsVal.properties) {
                  if (prop.type === 'ObjectProperty') {
                    const keyName =
                      (prop.key as types.Identifier).name ||
                      ((prop.key as types.StringLiteral).value as string)
                    if (keyName) {
                      existingPropKeys.add(keyName)
                    }
                  }
                }
              }
            }
          }
        } catch {
          // Ignore errors in parsing existing props
        }
      }

      const wrapContext: WrapContext = {
        counter: 0,
        wrappedProviders: [],
        isPage: true,
        fileName: firstDataSourceInfo.fileName,
        existingPropKeys,
      }

      wrapDataSourceExpressionsInAttributes(
        componentChunk.content,
        firstDataSourceInfo,
        wrapContext,
        dependencies
      )

      // Add wrapped providers to getStaticProps
      if (wrapContext.wrappedProviders.length > 0 && getStaticPropsChunk && fetcherImportName) {
        const functionDeclaration = (getStaticPropsChunk.content as types.ExportNamedDeclaration)
          .declaration as types.FunctionDeclaration
        const functionBody = functionDeclaration.body.body
        const tryBlock = functionBody.find(
          (subNode) => subNode.type === 'TryStatement'
        ) as types.TryStatement

        if (tryBlock) {
          const returnStatement = tryBlock.block.body.find(
            (subNode) => subNode.type === 'ReturnStatement'
          ) as types.ReturnStatement

          if (returnStatement) {
            const propsObject = (
              returnStatement.argument as types.ObjectExpression
            ).properties.find(
              (property) =>
                ((property as types.ObjectProperty).key as types.Identifier).name === 'props'
            ) as types.ObjectProperty

            const propsValue = propsObject.value as types.ObjectExpression

            // Get the existing parallel fetch metadata
            const meta = (getStaticPropsChunk.meta?.parallelFetchData as any) || {
              names: [],
              expressions: [],
            }

            for (const wrapped of wrapContext.wrappedProviders) {
              // Add to parallel fetch
              const fetchCallExpression = types.callExpression(
                types.memberExpression(
                  types.identifier(fetcherImportName),
                  types.identifier('fetchData')
                ),
                [types.objectExpression([])]
              )

              const safeFetchExpression = types.callExpression(
                types.memberExpression(fetchCallExpression, types.identifier('catch')),
                [
                  types.arrowFunctionExpression(
                    [types.identifier('error')],
                    types.blockStatement([
                      types.expressionStatement(
                        types.callExpression(
                          types.memberExpression(
                            types.identifier('console'),
                            types.identifier('error')
                          ),
                          [
                            types.stringLiteral(`Error fetching ${wrapped.propKey}:`),
                            types.identifier('error'),
                          ]
                        )
                      ),
                      types.returnStatement(types.arrayExpression([])),
                    ])
                  ),
                ]
              )

              meta.names.push(wrapped.propKey)
              meta.expressions.push(safeFetchExpression)

              // Add prop to return object
              propsValue.properties.push(
                types.objectProperty(
                  types.identifier(wrapped.propKey),
                  types.identifier(wrapped.propKey),
                  false,
                  true
                )
              )
            }

            // Update the parallel fetch statement
            if (meta.declaration) {
              const existingIndex = tryBlock.block.body.indexOf(meta.declaration)
              if (existingIndex !== -1) {
                tryBlock.block.body.splice(existingIndex, 1)
              }
            }

            const promiseAllCall = types.awaitExpression(
              types.callExpression(
                types.memberExpression(types.identifier('Promise'), types.identifier('all')),
                [types.arrayExpression(meta.expressions)]
              )
            )

            const arrayPattern = types.arrayPattern(
              meta.names.map((name: string) => types.identifier(name))
            )

            meta.declaration = types.variableDeclaration('const', [
              types.variableDeclarator(arrayPattern, promiseAllCall),
            ])

            tryBlock.block.body.unshift(meta.declaration)

            getStaticPropsChunk.meta = getStaticPropsChunk.meta || {}
            getStaticPropsChunk.meta.parallelFetchData = meta
          }
        }
      }
    }

    // Stringify complex params in DataProvider components before pagination plugin runs
    stringifyComplexParamsInDataProviders(componentChunk)

    // If getStaticProps doesn't exist yet but we have paginated/search data sources,
    // create a basic getStaticProps structure for the pagination plugin to populate
    if (!getStaticPropsChunk && opts.paginationConfig) {
      const hasPaginatedOrSearchDataSources =
        opts.paginationConfig.perPageMap.size > 0 || opts.paginationConfig.searchConfigMap.size > 0

      if (hasPaginatedOrSearchDataSources) {
        // Create a basic getStaticProps structure with Promise.all
        const getStaticPropsAST = types.exportNamedDeclaration(
          (() => {
            const node = types.functionDeclaration(
              types.identifier('getStaticProps'),
              [types.identifier('context')],
              types.blockStatement([
                types.tryStatement(
                  types.blockStatement([
                    // Create Promise.all structure that updateGetStaticProps expects
                    types.variableDeclaration('const', [
                      types.variableDeclarator(
                        types.arrayPattern([]),
                        types.awaitExpression(
                          types.callExpression(
                            types.memberExpression(
                              types.identifier('Promise'),
                              types.identifier('all')
                            ),
                            [types.arrayExpression([])]
                          )
                        )
                      ),
                    ]),
                    types.returnStatement(
                      types.objectExpression([
                        types.objectProperty(types.identifier('props'), types.objectExpression([])),
                        // ⛔ WITHOUT THIS THE PAGE IS A BUILD-TIME SNAPSHOT FOREVER.
                        // The non-paginated shape in `utils.ts` has always carried
                        // it; this bootstrap did not, so every paginated list page
                        // (blog, products, orders, every admin list) served its
                        // build-time first page from the CDN for the life of the
                        // deployment — a post moved back to draft still shipped.
                        // See ./isr.ts.
                        types.objectProperty(
                          types.identifier('revalidate'),
                          types.numericLiteral(DATA_SOURCE_ISR_REVALIDATE_SECONDS)
                        ),
                      ])
                    ),
                  ]),
                  types.catchClause(
                    types.identifier('error'),
                    types.blockStatement([
                      types.expressionStatement(
                        types.callExpression(
                          types.memberExpression(
                            types.identifier('console'),
                            types.identifier('error')
                          ),
                          [
                            types.stringLiteral('Error in getStaticProps:'),
                            types.identifier('error'),
                          ]
                        )
                      ),
                      types.returnStatement(
                        types.objectExpression([
                          types.objectProperty(
                            types.identifier('props'),
                            types.objectExpression([])
                          ),
                        ])
                      ),
                    ])
                  )
                ),
              ]),
              false,
              true
            )

            node.async = true
            return node
          })()
        )

        getStaticPropsChunk = {
          name: 'getStaticProps',
          type: ChunkType.AST,
          fileType: FileType.JS,
          content: getStaticPropsAST,
          linkAfter: ['jsx-component'],
        }

        chunks.push(getStaticPropsChunk)
      }
    }

    // For pages with dynamicRouteAttribute and dynamic SEO references,
    // add the SEO-referenced fields as direct page props from the fetched data.
    // The head config plugin generates props?.metaTitle from refPath: ['metaTitle'],
    // so we need those fields at the top level of props.
    if (uidl.outputOptions?.dynamicRouteAttribute && getStaticPropsChunk && uidl.seo) {
      addDynamicSeoPropsToGetStaticProps(uidl.seo, getStaticPropsChunk)
    }

    const paginationPlugin = createNextArrayMapperPaginationPlugin()
    return paginationPlugin(structure)
  }

  return nextPagesDataSourcePlugin
}

/**
 * Extracts dynamic SEO reference paths from UIDLComponentSEO and returns the
 * refPath arrays for prop-based dynamic references.
 */
function extractDynamicSeoRefPaths(seo: UIDLComponentSEO): string[][] {
  const paths: string[][] = []

  const extractFromValue = (value: unknown) => {
    if (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      (value as { type: string }).type === 'dynamic'
    ) {
      const dynRef = value as UIDLDynamicReference
      if (dynRef.content.referenceType === 'prop' && dynRef.content.refPath?.length) {
        paths.push(dynRef.content.refPath)
      }
    }
  }

  if (seo.title) {
    extractFromValue(seo.title)
  }

  if (seo.metaTags) {
    seo.metaTags.forEach((tag) => {
      Object.values(tag).forEach(extractFromValue)
    })
  }

  return paths
}

/**
 * For pages with dynamic route attributes and dynamic SEO prop references,
 * augments the getStaticProps return to include SEO fields extracted from
 * the first fetched entity. This enables server-side SEO resolution.
 */
function addDynamicSeoPropsToGetStaticProps(
  seo: UIDLComponentSEO,
  getStaticPropsChunk: { content: unknown; type: string }
): void {
  const seoRefPaths = extractDynamicSeoRefPaths(seo)
  if (seoRefPaths.length === 0) {
    return
  }

  try {
    const exportDecl = getStaticPropsChunk.content as types.ExportNamedDeclaration
    if (!exportDecl?.declaration || exportDecl.declaration.type !== 'FunctionDeclaration') {
      return
    }

    const funcBody = exportDecl.declaration.body
    const tryStmt = funcBody.body.find((s) => s.type === 'TryStatement') as types.TryStatement
    if (!tryStmt) {
      return
    }

    const returnStmt = tryStmt.block.body.find(
      (s) => s.type === 'ReturnStatement'
    ) as types.ReturnStatement
    if (!returnStmt?.argument || returnStmt.argument.type !== 'ObjectExpression') {
      return
    }

    const propsProperty = returnStmt.argument.properties.find(
      (p) =>
        p.type === 'ObjectProperty' &&
        ((p.key as types.Identifier)?.name === 'props' ||
          (p.key as types.StringLiteral)?.value === 'props')
    ) as types.ObjectProperty | undefined
    if (!propsProperty || propsProperty.value.type !== 'ObjectExpression') {
      return
    }

    const propsObj = propsProperty.value as types.ObjectExpression

    // Find the first data prop (non-spread, non-string-keyed) as the source entity.
    // Exclude spread elements and meta spreads that the data-source plugin adds.
    const firstDataProp = propsObj.properties.find(
      (p) => p.type === 'ObjectProperty' && (p.key as types.Identifier)?.name !== undefined
    ) as types.ObjectProperty | undefined

    if (!firstDataProp) {
      return
    }

    const addedSeoFields = new Set<string>()

    for (const refPath of seoRefPaths) {
      const fieldName = refPath[refPath.length - 1]
      if (addedSeoFields.has(fieldName)) {
        continue
      }
      addedSeoFields.add(fieldName)

      let memberExpr: types.Expression = types.cloneNode(
        firstDataProp.value as types.Expression,
        true
      )

      // If the prop value is an array (no index access), get the first element
      const valueStr = JSON.stringify(firstDataProp.value)
      const hasIndexAccess = valueStr.includes('"computed":true')
      if (!hasIndexAccess) {
        memberExpr = types.optionalMemberExpression(memberExpr, types.numericLiteral(0), true, true)
      }

      for (const segment of refPath) {
        memberExpr = types.optionalMemberExpression(
          memberExpr,
          types.identifier(segment),
          false,
          true
        )
      }

      const seoValue = types.logicalExpression('??', memberExpr, types.stringLiteral(''))

      propsObj.properties.push(types.objectProperty(types.identifier(fieldName), seoValue))
    }
  } catch {
    // If AST manipulation fails, skip SEO prop injection silently
  }
}

// Helper function to stringify complex params (sorts, filters) in DataProvider components
function stringifyComplexParamsInDataProviders(componentChunk: any): void {
  if (!componentChunk || !componentChunk.content) {
    return
  }

  // tslint:disable-next-line:no-any
  const traverseAST = (astNode: any): void => {
    if (!astNode || typeof astNode !== 'object') {
      return
    }

    // Check if this is a DataProvider JSXElement
    if (astNode.type === 'JSXElement' && astNode.openingElement?.name?.name === 'DataProvider') {
      const attrs = astNode.openingElement.attributes

      // Find the params attribute
      const paramsAttr = attrs.find(
        // tslint:disable-next-line:no-any
        (attr: any) =>
          attr.type === 'JSXAttribute' &&
          attr.name?.name === 'params' &&
          attr.value?.type === 'JSXExpressionContainer'
      )

      if (paramsAttr) {
        let paramsObj = null

        // Handle direct ObjectExpression
        if (paramsAttr.value?.expression?.type === 'ObjectExpression') {
          paramsObj = paramsAttr.value.expression
        }
        // Handle useMemo wrapped params: useMemo(() => ({...}), [...])
        else if (
          paramsAttr.value?.expression?.type === 'CallExpression' &&
          paramsAttr.value.expression.callee?.name === 'useMemo' &&
          paramsAttr.value.expression.arguments?.length > 0
        ) {
          const firstArg = paramsAttr.value.expression.arguments[0]
          // Check if it's an arrow function returning an object
          if (
            firstArg.type === 'ArrowFunctionExpression' &&
            firstArg.body?.type === 'ObjectExpression'
          ) {
            paramsObj = firstArg.body
          }
        }

        if (paramsObj && paramsObj.properties) {
          const properties = paramsObj.properties

          // Find sorts, filters and queryColumns properties and stringify them
          for (let i = 0; i < properties.length; i++) {
            const prop = properties[i]
            // Get the key name from either Identifier or StringLiteral
            const keyName =
              prop.key?.type === 'Identifier'
                ? prop.key.name
                : prop.key?.type === 'StringLiteral'
                ? prop.key.value
                : undefined

            if (
              prop.type === 'ObjectProperty' &&
              (keyName === 'sorts' || keyName === 'filters' || keyName === 'queryColumns') &&
              prop.value?.type === 'ArrayExpression'
            ) {
              // Replace the array with JSON.stringify(array)
              properties[i] = types.objectProperty(
                prop.key,
                types.callExpression(
                  types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
                  [prop.value]
                )
              )
            }
          }
        }
      }
    }

    // Recursively traverse all properties
    for (const key of Object.keys(astNode)) {
      const value = astNode[key]
      if (Array.isArray(value)) {
        value.forEach((item) => traverseAST(item))
      } else if (typeof value === 'object' && value !== null) {
        traverseAST(value)
      }
    }
  }

  traverseAST(componentChunk.content)
}

export const createNextComponentDataSourcePlugin: ComponentPluginFactory<{}> = () => {
  const nextComponentDataSourcePlugin: ComponentPlugin = async (structure) => {
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

    // Track the first data source info for wrapping dataSourceData expressions
    let firstDataSourceInfo: DataSourceInfo | null = null

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

      // Track the first data source info for wrapping dataSourceData expressions
      if (!firstDataSourceInfo) {
        const resourceDef = dataSourceNode.content?.resourceDefinition
        if (resourceDef) {
          const dataSource = dataSources[resourceDef.dataSourceId]
          if (dataSource) {
            const sanitizedDsName = StringUtils.dashCaseToCamelCase(
              sanitizeFileName(dataSource.name || resourceDef.dataSourceId)
            )
            const sanitizedTableName = StringUtils.dashCaseToCamelCase(
              sanitizeFileName(resourceDef.tableName || 'data')
            )
            const fileName = StringUtils.camelCaseToDashCase(
              `${sanitizeFileName(resourceDef.dataSourceType)}-${sanitizeFileName(
                resourceDef.tableName || 'data'
              )}-${sanitizeFileName(resourceDef.dataSourceId).substring(0, 8)}`
            )
            firstDataSourceInfo = {
              dataSourceId: resourceDef.dataSourceId,
              tableName: resourceDef.tableName || 'data',
              dataSourceType: resourceDef.dataSourceType,
              basePropKey: `${sanitizedDsName}_${sanitizedTableName}_data`,
              fileName,
            }
          }
        }
      }

      extractDataSourceIntoNextAPIFolder(
        dataSourceNode,
        dataSources,
        componentChunk,
        options.extractedResources,
        options.ecommerceSettings?.categories
      )
    })

    // If no data source nodes were found but there are dataSources available,
    // use the first available dataSource to create firstDataSourceInfo
    // This handles the case where a component has element props with dataSourceData expressions
    // but no explicit data source nodes
    if (!firstDataSourceInfo && Object.keys(dataSources).length > 0) {
      const firstDataSourceId = Object.keys(dataSources)[0]
      const dataSource = dataSources[firstDataSourceId]
      if (dataSource) {
        // Check if there's already an existing utils module for this data source
        // by looking for any file that matches the pattern {type}-*-{dsIdPrefix}
        const dsIdPrefix = sanitizeFileName(firstDataSourceId).substring(0, 8)
        const dsType = sanitizeFileName(dataSource.type)
        let existingFileName: string | null = null
        let existingTableName: string | null = null

        for (const key of Object.keys(options.extractedResources)) {
          if (key.startsWith('utils/') && key.includes(dsIdPrefix) && key.includes(dsType)) {
            // Extract the file name from the key (e.g., 'utils/cockroachdb-users-0e678dd9' -> 'cockroachdb-users-0e678dd9')
            existingFileName = key.replace('utils/', '').replace('.js', '')
            // Extract table name from filename (e.g., 'cockroachdb-users-0e678dd9' -> 'users')
            const parts = existingFileName.split('-')
            if (parts.length >= 3) {
              // Table name is between type and dsIdPrefix
              existingTableName = parts.slice(1, -1).join('-')
            }
            break
          }
        }

        const tableName = existingTableName || 'data'
        const sanitizedDsName = StringUtils.dashCaseToCamelCase(
          sanitizeFileName(dataSource.name || firstDataSourceId)
        )
        const sanitizedTableName = StringUtils.dashCaseToCamelCase(sanitizeFileName(tableName))
        const fileName =
          existingFileName ||
          StringUtils.camelCaseToDashCase(`${dsType}-${sanitizeFileName(tableName)}-${dsIdPrefix}`)
        firstDataSourceInfo = {
          dataSourceId: firstDataSourceId,
          tableName,
          dataSourceType: dataSource.type,
          basePropKey: `${sanitizedDsName}_${sanitizedTableName}_data`,
          fileName,
        }
      }
    }

    // After processing all data source nodes, wrap any element props containing dataSourceData
    // expressions in a DataProvider (for components, use fetchData instead of initialData)
    if (firstDataSourceInfo && componentChunk.content) {
      // For components, we don't have getStaticProps, so start with empty set
      // The existingPropKeys will track keys within this component to avoid duplicates
      const existingPropKeys = new Set<string>()

      const wrapContext: WrapContext = {
        counter: 0,
        wrappedProviders: [],
        isPage: false, // Components don't have getStaticProps
        fileName: firstDataSourceInfo.fileName,
        existingPropKeys,
      }

      wrapDataSourceExpressionsInAttributes(
        componentChunk.content,
        firstDataSourceInfo,
        wrapContext,
        dependencies
      )

      // For components, ensure API file is created for wrapped providers
      if (wrapContext.wrappedProviders.length > 0) {
        const dataSource = dataSources[firstDataSourceInfo.dataSourceId]
        const fileName = firstDataSourceInfo.fileName

        // First, ensure the utils data source module exists
        if (dataSource && !options.extractedResources[`utils/${fileName}`]) {
          const { generateDataSourceFetcherWithCore } = require('./data-source-fetchers')
          try {
            const fetcherCode = generateDataSourceFetcherWithCore(
              dataSource,
              firstDataSourceInfo.tableName,
              false,
              options.ecommerceSettings?.categories
            )
            options.extractedResources[`utils/${fileName}`] = {
              fileName,
              fileType: FileType.JS,
              path: ['utils', 'data-sources'],
              content: fetcherCode,
            }
          } catch (error) {
            // Silently fail
          }
        }

        // Then, create the API route that imports from utils and exports the handler
        if (!options.extractedResources[`api/${fileName}`]) {
          const apiRouteCode = `import dataSourceModule from '../../utils/data-sources/${fileName}'

export default dataSourceModule.handler
`
          options.extractedResources[`api/${fileName}`] = {
            fileName,
            fileType: FileType.JS,
            path: ['pages', 'api'],
            content: apiRouteCode,
          }
        }
      }
    }

    // Stringify complex params in DataProvider components before pagination plugin runs
    stringifyComplexParamsInDataProviders(componentChunk)

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
