import {
  ComponentPlugin,
  ComponentPluginFactory,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'
import { StringUtils } from '@teleporthq/teleport-shared'
import { generateSafeFileName } from './utils'

// ==================== UIDL-FIRST STATE MANAGEMENT ====================
// This module uses a UIDL-first approach: we scan the UIDL FIRST to identify
// ALL data source usages and assign unique state IDs BEFORE any JSX processing.
// This ensures consistent state mapping across DataProviders, search inputs, and pagination buttons.

interface DataSourceUsage {
  // Unique sequential index for this usage (0, 1, 2, ...)
  index: number
  // The data-source-list renderPropIdentifier (e.g., "dsadsa3_users_data")
  dataSourceIdentifier: string
  // The cms-list-repeater renderPropIdentifier (e.g., "context_1i871")
  arrayMapperRenderProp: string
  // Resource definition from UIDL
  resourceDefinition: {
    dataSourceId: string
    tableName: string
    dataSourceType: string
  }
  // Pagination config
  paginated: boolean
  perPage: number
  // Search config
  searchEnabled: boolean
  searchDebounce: number
  // Query columns from resource params
  queryColumns: string[]
  // Sorts from resource params
  // tslint:disable-next-line:no-any
  sorts: any[]
  // Filters from resource params
  // tslint:disable-next-line:no-any
  filters: any[]
  // Computed category
  category: 'paginated+search' | 'paginated-only' | 'search-only' | 'plain'
}

interface StateRegistry {
  usages: DataSourceUsage[]
  // Map from dataSourceIdentifier to all usages with that identifier
  byDataSourceId: Map<string, DataSourceUsage[]>
  // Map from arrayMapperRenderProp to usage
  byArrayMapperRenderProp: Map<string, DataSourceUsage>
}

// Scan UIDL to find all data source usages and build a registry
function buildStateRegistry(uidlNode: any): StateRegistry {
  const usages: DataSourceUsage[] = []
  const byDataSourceId = new Map<string, DataSourceUsage[]>()
  const byArrayMapperRenderProp = new Map<string, DataSourceUsage>()
  let index = 0

  const traverse = (
    node: any,
    parentDataSource?: { identifier: string; resourceDef: any; resourceParams: any }
  ): void => {
    if (!node || typeof node !== 'object') {
      return
    }

    // Found a data-source-list (DataProvider)
    if (node.type === 'data-source-list' && node.content?.renderPropIdentifier) {
      const dsIdentifier = node.content.renderPropIdentifier
      const resourceDef = node.content.resourceDefinition || {}
      const resourceParams = node.content.resource?.params || {}

      // Look for cms-list-repeater inside this data-source-list
      const newParent = {
        identifier: dsIdentifier,
        resourceDef,
        resourceParams,
      }

      // Traverse into success/error/loading nodes
      if (node.content.nodes?.success) {
        traverse(node.content.nodes.success, newParent)
      }
      if (node.content.nodes?.error) {
        traverse(node.content.nodes.error, newParent)
      }
      if (node.content.nodes?.loading) {
        traverse(node.content.nodes.loading, newParent)
      }
      return
    }

    // Found a cms-list-repeater (Repeater with pagination/search config)
    const isCmsListRepeater =
      node.type === 'cms-list-repeater' ||
      (node.type === 'element' && node.content?.elementType === 'cms-list-repeater')

    if (isCmsListRepeater && parentDataSource) {
      const content = node.content || node
      const arrayMapperRenderProp = content.renderPropIdentifier

      if (arrayMapperRenderProp) {
        // Extract query columns from parent's resource params
        let queryColumns: string[] = []
        if (parentDataSource.resourceParams?.queryColumns?.content) {
          queryColumns = parentDataSource.resourceParams.queryColumns.content
        }

        // Extract sorts from parent's resource params
        let sorts: any[] = []
        if (parentDataSource.resourceParams?.sorts?.content) {
          sorts = parentDataSource.resourceParams.sorts.content
        }

        // Extract filters from parent's resource params
        let filters: any[] = []
        if (parentDataSource.resourceParams?.filters?.content) {
          filters = parentDataSource.resourceParams.filters.content
        }

        // Extract limit from parent's resource params (for plain array mappers)
        let limit = 0
        if (parentDataSource.resourceParams?.limit?.content) {
          limit = parentDataSource.resourceParams.limit.content
        }

        // For paginated mappers, use perPage from cms-list-repeater
        // For plain mappers, use limit from data-source-list resource params
        const effectivePerPage = content.paginated ? content.perPage : limit || content.perPage

        const usage: DataSourceUsage = {
          index: index++,
          dataSourceIdentifier: parentDataSource.identifier,
          arrayMapperRenderProp,
          resourceDefinition: {
            dataSourceId: parentDataSource.resourceDef.dataSourceId || '',
            tableName: parentDataSource.resourceDef.tableName || '',
            dataSourceType: parentDataSource.resourceDef.dataSourceType || '',
          },
          paginated: !!content.paginated,
          perPage: effectivePerPage,
          searchEnabled: !!content.searchEnabled,
          searchDebounce: content.searchDebounce || 300,
          queryColumns,
          sorts,
          filters,
          category: 'plain',
        }

        // Determine category
        if (usage.paginated && usage.searchEnabled) {
          usage.category = 'paginated+search'
        } else if (usage.paginated) {
          usage.category = 'paginated-only'
        } else if (usage.searchEnabled) {
          usage.category = 'search-only'
        }

        usages.push(usage)

        // Add to maps
        if (!byDataSourceId.has(usage.dataSourceIdentifier)) {
          byDataSourceId.set(usage.dataSourceIdentifier, [])
        }
        byDataSourceId.get(usage.dataSourceIdentifier)!.push(usage)
        byArrayMapperRenderProp.set(arrayMapperRenderProp, usage)
      }

      // Continue traversing inside the repeater
      if (content.nodes?.list) {
        traverse(content.nodes.list, parentDataSource)
      }
      return
    }

    // Recurse into children
    if (node.content?.children && Array.isArray(node.content.children)) {
      for (const child of node.content.children) {
        traverse(child, parentDataSource)
      }
    }
    if (node.content?.node) {
      traverse(node.content.node, parentDataSource)
    }
    if (node.content?.nodes) {
      if (node.content.nodes.success) {
        traverse(node.content.nodes.success, parentDataSource)
      }
      if (node.content.nodes.error) {
        traverse(node.content.nodes.error, parentDataSource)
      }
      if (node.content.nodes.loading) {
        traverse(node.content.nodes.loading, parentDataSource)
      }
      if (node.content.nodes.list) {
        traverse(node.content.nodes.list, parentDataSource)
      }
      if (node.content.nodes.empty) {
        traverse(node.content.nodes.empty, parentDataSource)
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        traverse(child, parentDataSource)
      }
    }
  }

  traverse(uidlNode)

  return { usages, byDataSourceId, byArrayMapperRenderProp }
}

// Generate state variable names for a usage
function getStateVarsForUsage(usage: DataSourceUsage): {
  pageStateVar: string
  setPageStateVar: string
  maxPagesStateVar: string
  setMaxPagesStateVar: string
  searchQueryVar: string
  setSearchQueryVar: string
  debouncedSearchQueryVar: string
  setDebouncedSearchQueryVar: string
  combinedStateVar: string
  setCombinedStateVar: string
  skipDebounceRefVar: string
  skipCountFetchRefVar: string
  propsPrefix: string
} {
  const idx = usage.index

  return {
    pageStateVar: `ds_${idx}_page`,
    setPageStateVar: `setDs_${idx}_page`,
    maxPagesStateVar: `ds_${idx}_maxPages`,
    setMaxPagesStateVar: `setDs_${idx}_maxPages`,
    searchQueryVar: `ds_${idx}_searchQuery`,
    setSearchQueryVar: `setDs_${idx}_searchQuery`,
    debouncedSearchQueryVar: `ds_${idx}_debouncedQuery`,
    setDebouncedSearchQueryVar: `setDs_${idx}_debouncedQuery`,
    combinedStateVar: `ds_${idx}_state`,
    setCombinedStateVar: `setDs_${idx}_state`,
    skipDebounceRefVar: `ds_${idx}_skipDebounce`,
    skipCountFetchRefVar: `ds_${idx}_skipCountFetch`,
    propsPrefix: `${usage.dataSourceIdentifier}_ds_${idx}`,
  }
}

// ==================== MAIN PLUGIN ====================

export const createNextArrayMapperPaginationPlugin: ComponentPluginFactory<{}> = () => {
  const paginationPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure

    const componentChunk = chunks.find((chunk) => chunk.name === 'jsx-component')
    if (!componentChunk || componentChunk.type !== ChunkType.AST) {
      return structure
    }

    if (!options || !options.dataSources || !options.extractedResources) {
      return structure
    }

    const variableDeclaration = componentChunk.content as types.VariableDeclaration
    if (!variableDeclaration.declarations || variableDeclaration.declarations.length === 0) {
      return structure
    }
    const declarator = variableDeclaration.declarations[0] as types.VariableDeclarator
    if (!declarator.init) {
      return structure
    }
    const arrowFunction = declarator.init as types.ArrowFunctionExpression
    if (!arrowFunction.body) {
      return structure
    }
    const blockStatement = arrowFunction.body as types.BlockStatement

    // STEP 1: Build state registry from UIDL
    const registry = buildStateRegistry(uidl.node)

    if (registry.usages.length === 0) {
      return structure
    }

    // Check if this is a page or component
    const getStaticPropsChunk = chunks.find((chunk) => chunk.name === 'getStaticProps')
    const isPage = !!getStaticPropsChunk

    // Add React dependencies
    if (!dependencies.useState) {
      dependencies.useState = {
        type: 'library',
        path: 'react',
        version: '',
        meta: { namedImport: true },
      }
    }
    if (!dependencies.useMemo) {
      dependencies.useMemo = {
        type: 'library',
        path: 'react',
        version: '',
        meta: { namedImport: true },
      }
    }
    if (!dependencies.useCallback) {
      dependencies.useCallback = {
        type: 'library',
        path: 'react',
        version: '',
        meta: { namedImport: true },
      }
    }
    if (!dependencies.useRef) {
      dependencies.useRef = {
        type: 'library',
        path: 'react',
        version: '',
        meta: { namedImport: true },
      }
    }
    if (!dependencies.useEffect) {
      dependencies.useEffect = {
        type: 'library',
        path: 'react',
        version: '',
        meta: { namedImport: true },
      }
    }

    if (!componentChunk.meta) {
      componentChunk.meta = {}
    }
    componentChunk.meta.isClientComponent = true

    // STEP 2: Generate state declarations for all usages
    const stateDeclarations: types.Statement[] = []
    const effectStatements: types.Statement[] = []

    registry.usages.forEach((usage) => {
      if (usage.category === 'plain') {
        return // Plain mappers don't need state
      }

      const vars = getStateVarsForUsage(usage)

      if (usage.category === 'paginated+search') {
        // Combined state object for pagination + search
        stateDeclarations.push(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.identifier(vars.skipDebounceRefVar),
              types.callExpression(types.identifier('useRef'), [types.booleanLiteral(true)])
            ),
          ])
        )

        // Only add skipCountFetchRef for pages (where we have server-side count)
        // For components, we need to fetch count on mount
        if (isPage) {
          stateDeclarations.push(
            types.variableDeclaration('const', [
              types.variableDeclarator(
                types.identifier(vars.skipCountFetchRefVar),
                types.callExpression(types.identifier('useRef'), [types.booleanLiteral(true)])
              ),
            ])
          )
        }

        // maxPages state
        const maxPagesInit = isPage
          ? types.logicalExpression(
              '||',
              types.optionalMemberExpression(
                types.identifier('props'),
                types.identifier(`${vars.propsPrefix}_maxPages`),
                false,
                true
              ),
              types.numericLiteral(0)
            )
          : types.numericLiteral(0)

        stateDeclarations.push(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.arrayPattern([
                types.identifier(vars.maxPagesStateVar),
                types.identifier(vars.setMaxPagesStateVar),
              ]),
              types.callExpression(types.identifier('useState'), [maxPagesInit])
            ),
          ])
        )

        // Combined state { page, debouncedQuery }
        stateDeclarations.push(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.arrayPattern([
                types.identifier(vars.combinedStateVar),
                types.identifier(vars.setCombinedStateVar),
              ]),
              types.callExpression(types.identifier('useState'), [
                types.objectExpression([
                  types.objectProperty(types.identifier('page'), types.numericLiteral(1)),
                  types.objectProperty(types.identifier('debouncedQuery'), types.stringLiteral('')),
                ]),
              ])
            ),
          ])
        )

        // Immediate search query state
        stateDeclarations.push(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.arrayPattern([
                types.identifier(vars.searchQueryVar),
                types.identifier(vars.setSearchQueryVar),
              ]),
              types.callExpression(types.identifier('useState'), [types.stringLiteral('')])
            ),
          ])
        )

        // Debounce effect
        effectStatements.push(
          types.expressionStatement(
            types.callExpression(types.identifier('useEffect'), [
              types.arrowFunctionExpression(
                [],
                types.blockStatement([
                  types.ifStatement(
                    types.memberExpression(
                      types.identifier(vars.skipDebounceRefVar),
                      types.identifier('current')
                    ),
                    types.blockStatement([
                      types.expressionStatement(
                        types.assignmentExpression(
                          '=',
                          types.memberExpression(
                            types.identifier(vars.skipDebounceRefVar),
                            types.identifier('current')
                          ),
                          types.booleanLiteral(false)
                        )
                      ),
                      types.returnStatement(),
                    ])
                  ),
                  types.variableDeclaration('const', [
                    types.variableDeclarator(
                      types.identifier('timer'),
                      types.callExpression(types.identifier('setTimeout'), [
                        types.arrowFunctionExpression(
                          [],
                          types.blockStatement([
                            types.expressionStatement(
                              types.callExpression(types.identifier(vars.setCombinedStateVar), [
                                types.objectExpression([
                                  types.objectProperty(
                                    types.identifier('page'),
                                    types.numericLiteral(1)
                                  ),
                                  types.objectProperty(
                                    types.identifier('debouncedQuery'),
                                    types.identifier(vars.searchQueryVar)
                                  ),
                                ]),
                              ])
                            ),
                          ])
                        ),
                        types.numericLiteral(usage.searchDebounce),
                      ])
                    ),
                  ]),
                  types.returnStatement(
                    types.arrowFunctionExpression(
                      [],
                      types.callExpression(types.identifier('clearTimeout'), [
                        types.identifier('timer'),
                      ])
                    )
                  ),
                ])
              ),
              types.arrayExpression([types.identifier(vars.searchQueryVar)]),
            ])
          )
        )

        // Count refetch effect
        const fileName = generateSafeFileName(
          usage.resourceDefinition.dataSourceType,
          usage.resourceDefinition.tableName,
          usage.resourceDefinition.dataSourceId
        )
        const urlParams: types.ObjectProperty[] = [
          types.objectProperty(
            types.identifier('query'),
            types.memberExpression(
              types.identifier(vars.combinedStateVar),
              types.identifier('debouncedQuery')
            )
          ),
        ]
        if (usage.queryColumns.length > 0) {
          urlParams.push(
            types.objectProperty(
              types.identifier('queryColumns'),
              types.callExpression(
                types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
                [types.arrayExpression(usage.queryColumns.map((c) => types.stringLiteral(c)))]
              )
            )
          )
        }
        // Add sorts to count fetch params if present
        if (usage.sorts && usage.sorts.length > 0) {
          urlParams.push(
            types.objectProperty(
              types.identifier('sorts'),
              types.callExpression(
                types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
                [
                  types.arrayExpression(
                    usage.sorts.map((sort: any) =>
                      types.objectExpression([
                        types.objectProperty(
                          types.identifier('field'),
                          types.stringLiteral(sort.field || '')
                        ),
                        types.objectProperty(
                          types.identifier('order'),
                          types.stringLiteral(sort.order || '')
                        ),
                      ])
                    )
                  ),
                ]
              )
            )
          )
        }
        // Add filters to count fetch params if present
        if (usage.filters && usage.filters.length > 0) {
          urlParams.push(
            types.objectProperty(
              types.identifier('filters'),
              types.callExpression(
                types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
                [
                  types.arrayExpression(
                    usage.filters.map((filter: any) =>
                      types.objectExpression([
                        types.objectProperty(
                          types.identifier('source'),
                          types.stringLiteral(filter.source || '')
                        ),
                        types.objectProperty(
                          types.identifier('destination'),
                          types.stringLiteral(filter.destination || '')
                        ),
                        types.objectProperty(
                          types.identifier('operand'),
                          types.stringLiteral(filter.operand || '')
                        ),
                      ])
                    )
                  ),
                ]
              )
            )
          )
        }

        // Build the count fetch effect body
        const countFetchEffectBody: types.Statement[] = []

        // Only add skip-on-mount check for pages (where we have server-side count)
        if (isPage) {
          countFetchEffectBody.push(
            types.ifStatement(
              types.memberExpression(
                types.identifier(vars.skipCountFetchRefVar),
                types.identifier('current')
              ),
              types.blockStatement([
                types.expressionStatement(
                  types.assignmentExpression(
                    '=',
                    types.memberExpression(
                      types.identifier(vars.skipCountFetchRefVar),
                      types.identifier('current')
                    ),
                    types.booleanLiteral(false)
                  )
                ),
                types.returnStatement(),
              ])
            )
          )
        }

        // Add the fetch call
        countFetchEffectBody.push(
          types.expressionStatement(
            types.callExpression(
              types.memberExpression(
                types.callExpression(
                  types.memberExpression(
                    types.callExpression(types.identifier('fetch'), [
                      types.templateLiteral(
                        [
                          types.templateElement({
                            raw: `/api/${fileName}-count?`,
                            cooked: `/api/${fileName}-count?`,
                          }),
                          types.templateElement({ raw: '', cooked: '' }),
                        ],
                        [
                          types.newExpression(types.identifier('URLSearchParams'), [
                            types.objectExpression(urlParams),
                          ]),
                        ]
                      ),
                    ]),
                    types.identifier('then')
                  ),
                  [
                    types.arrowFunctionExpression(
                      [types.identifier('res')],
                      types.callExpression(
                        types.memberExpression(types.identifier('res'), types.identifier('json')),
                        []
                      )
                    ),
                  ]
                ),
                types.identifier('then')
              ),
              [
                types.arrowFunctionExpression(
                  [types.identifier('data')],
                  types.blockStatement([
                    types.ifStatement(
                      types.logicalExpression(
                        '&&',
                        types.identifier('data'),
                        types.binaryExpression(
                          'in',
                          types.stringLiteral('count'),
                          types.identifier('data')
                        )
                      ),
                      types.blockStatement([
                        types.expressionStatement(
                          types.callExpression(types.identifier(vars.setMaxPagesStateVar), [
                            types.conditionalExpression(
                              types.binaryExpression(
                                '===',
                                types.memberExpression(
                                  types.identifier('data'),
                                  types.identifier('count')
                                ),
                                types.numericLiteral(0)
                              ),
                              types.numericLiteral(0),
                              types.callExpression(
                                types.memberExpression(
                                  types.identifier('Math'),
                                  types.identifier('ceil')
                                ),
                                [
                                  types.binaryExpression(
                                    '/',
                                    types.memberExpression(
                                      types.identifier('data'),
                                      types.identifier('count')
                                    ),
                                    types.numericLiteral(usage.perPage)
                                  ),
                                ]
                              )
                            ),
                          ])
                        ),
                      ])
                    ),
                  ])
                ),
              ]
            )
          )
        )

        effectStatements.push(
          types.expressionStatement(
            types.callExpression(types.identifier('useEffect'), [
              types.arrowFunctionExpression([], types.blockStatement(countFetchEffectBody)),
              types.arrayExpression([
                types.memberExpression(
                  types.identifier(vars.combinedStateVar),
                  types.identifier('debouncedQuery')
                ),
              ]),
            ])
          )
        )
      } else if (usage.category === 'paginated-only') {
        // Simple page state
        const maxPagesInit = isPage
          ? types.logicalExpression(
              '||',
              types.optionalMemberExpression(
                types.identifier('props'),
                types.identifier(`${vars.propsPrefix}_maxPages`),
                false,
                true
              ),
              types.numericLiteral(0)
            )
          : types.numericLiteral(0)

        stateDeclarations.push(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.arrayPattern([
                types.identifier(vars.maxPagesStateVar),
                types.identifier(vars.setMaxPagesStateVar),
              ]),
              types.callExpression(types.identifier('useState'), [maxPagesInit])
            ),
          ])
        )

        stateDeclarations.push(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.arrayPattern([
                types.identifier(vars.pageStateVar),
                types.identifier(vars.setPageStateVar),
              ]),
              types.callExpression(types.identifier('useState'), [types.numericLiteral(1)])
            ),
          ])
        )

        // For components (not pages), add a useEffect to fetch count on mount
        // Pages get count from getStaticProps, but components need to fetch it client-side
        if (!isPage) {
          const fileName = generateSafeFileName(
            usage.resourceDefinition.dataSourceType,
            usage.resourceDefinition.tableName,
            usage.resourceDefinition.dataSourceId
          )

          effectStatements.push(
            types.expressionStatement(
              types.callExpression(types.identifier('useEffect'), [
                types.arrowFunctionExpression(
                  [],
                  types.blockStatement([
                    types.expressionStatement(
                      types.callExpression(
                        types.memberExpression(
                          types.callExpression(
                            types.memberExpression(
                              types.callExpression(types.identifier('fetch'), [
                                types.stringLiteral(`/api/${fileName}-count`),
                              ]),
                              types.identifier('then')
                            ),
                            [
                              types.arrowFunctionExpression(
                                [types.identifier('res')],
                                types.callExpression(
                                  types.memberExpression(
                                    types.identifier('res'),
                                    types.identifier('json')
                                  ),
                                  []
                                )
                              ),
                            ]
                          ),
                          types.identifier('then')
                        ),
                        [
                          types.arrowFunctionExpression(
                            [types.identifier('data')],
                            types.blockStatement([
                              types.ifStatement(
                                types.logicalExpression(
                                  '&&',
                                  types.identifier('data'),
                                  types.binaryExpression(
                                    'in',
                                    types.stringLiteral('count'),
                                    types.identifier('data')
                                  )
                                ),
                                types.blockStatement([
                                  types.expressionStatement(
                                    types.callExpression(
                                      types.identifier(vars.setMaxPagesStateVar),
                                      [
                                        types.conditionalExpression(
                                          types.binaryExpression(
                                            '===',
                                            types.memberExpression(
                                              types.identifier('data'),
                                              types.identifier('count')
                                            ),
                                            types.numericLiteral(0)
                                          ),
                                          types.numericLiteral(0),
                                          types.callExpression(
                                            types.memberExpression(
                                              types.identifier('Math'),
                                              types.identifier('ceil')
                                            ),
                                            [
                                              types.binaryExpression(
                                                '/',
                                                types.memberExpression(
                                                  types.identifier('data'),
                                                  types.identifier('count')
                                                ),
                                                types.numericLiteral(usage.perPage)
                                              ),
                                            ]
                                          )
                                        ),
                                      ]
                                    )
                                  ),
                                ])
                              ),
                            ])
                          ),
                        ]
                      )
                    ),
                  ])
                ),
                types.arrayExpression([]), // Empty dependency array - fetch on mount only
              ])
            )
          )
        }
      } else if (usage.category === 'search-only') {
        // Search-only state
        stateDeclarations.push(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.identifier(vars.skipDebounceRefVar),
              types.callExpression(types.identifier('useRef'), [types.booleanLiteral(true)])
            ),
          ])
        )

        stateDeclarations.push(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.arrayPattern([
                types.identifier(vars.debouncedSearchQueryVar),
                types.identifier(vars.setDebouncedSearchQueryVar),
              ]),
              types.callExpression(types.identifier('useState'), [types.stringLiteral('')])
            ),
          ])
        )

        stateDeclarations.push(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.arrayPattern([
                types.identifier(vars.searchQueryVar),
                types.identifier(vars.setSearchQueryVar),
              ]),
              types.callExpression(types.identifier('useState'), [types.stringLiteral('')])
            ),
          ])
        )

        // Debounce effect
        effectStatements.push(
          types.expressionStatement(
            types.callExpression(types.identifier('useEffect'), [
              types.arrowFunctionExpression(
                [],
                types.blockStatement([
                  types.ifStatement(
                    types.memberExpression(
                      types.identifier(vars.skipDebounceRefVar),
                      types.identifier('current')
                    ),
                    types.blockStatement([
                      types.expressionStatement(
                        types.assignmentExpression(
                          '=',
                          types.memberExpression(
                            types.identifier(vars.skipDebounceRefVar),
                            types.identifier('current')
                          ),
                          types.booleanLiteral(false)
                        )
                      ),
                      types.returnStatement(),
                    ])
                  ),
                  types.variableDeclaration('const', [
                    types.variableDeclarator(
                      types.identifier('timer'),
                      types.callExpression(types.identifier('setTimeout'), [
                        types.arrowFunctionExpression(
                          [],
                          types.blockStatement([
                            types.expressionStatement(
                              types.callExpression(
                                types.identifier(vars.setDebouncedSearchQueryVar),
                                [types.identifier(vars.searchQueryVar)]
                              )
                            ),
                          ])
                        ),
                        types.numericLiteral(usage.searchDebounce),
                      ])
                    ),
                  ]),
                  types.returnStatement(
                    types.arrowFunctionExpression(
                      [],
                      types.callExpression(types.identifier('clearTimeout'), [
                        types.identifier('timer'),
                      ])
                    )
                  ),
                ])
              ),
              types.arrayExpression([types.identifier(vars.searchQueryVar)]),
            ])
          )
        )
      }
    })

    // Insert state declarations at the beginning
    stateDeclarations.reverse().forEach((s) => blockStatement.body.unshift(s))

    // Insert effects before return statement
    const returnIndex = blockStatement.body.findIndex((s: any) => s.type === 'ReturnStatement')
    const insertIndex = returnIndex !== -1 ? returnIndex : blockStatement.body.length
    effectStatements.reverse().forEach((e) => blockStatement.body.splice(insertIndex, 0, e))

    // STEP 3: Find all DataProviders in JSX that have Repeaters and wire them to correct states
    const dataProviders = findAllDataProvidersInJSX(blockStatement)

    // Filter to only DataProviders with Repeaters (array mappers)
    const dataProvidersWithRepeaters = dataProviders.filter((dp) => {
      const hasRepeater = findArrayMapperRenderPropInDataProvider(dp) !== undefined
      return hasRepeater
    })

    // Track which usage index we're on for each dataSourceIdentifier
    // We use pure order-based matching - the order of DataProviders in JSX should match UIDL order
    const usageIndexByDataSourceId = new Map<string, number>()

    dataProvidersWithRepeaters.forEach((dp) => {
      const nameAttr = dp.openingElement.attributes.find(
        (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'name'
      )
      if (!nameAttr?.value?.expression?.value) {
        return
      }

      const dataSourceIdentifier = nameAttr.value.expression.value

      // Use pure order-based matching within each dataSourceIdentifier
      const usages = registry.byDataSourceId.get(dataSourceIdentifier) || []
      const currentIndex = usageIndexByDataSourceId.get(dataSourceIdentifier) || 0

      if (currentIndex >= usages.length) {
        return
      }

      const usage = usages[currentIndex]
      usageIndexByDataSourceId.set(dataSourceIdentifier, currentIndex + 1)

      const vars = getStateVarsForUsage(usage)
      const fileName = generateSafeFileName(
        usage.resourceDefinition.dataSourceType,
        usage.resourceDefinition.tableName,
        usage.resourceDefinition.dataSourceId
      )

      // Update DataProvider based on category
      if (usage.category === 'paginated+search') {
        updateDataProviderForPaginatedSearch(dp, usage, vars, fileName)
      } else if (usage.category === 'paginated-only') {
        updateDataProviderForPaginationOnly(dp, usage, vars, fileName)
      } else if (usage.category === 'search-only') {
        updateDataProviderForSearchOnly(dp, usage, vars, fileName)
      } else if (usage.category === 'plain') {
        updateDataProviderForPlain(dp)
      }

      // Create API route if needed (not needed for 'plain' category)
      if (usage.category !== 'plain') {
        ensureAPIRouteExists(options.extractedResources, usage)
      }
    })

    // STEP 3.5: Handle DataProviders WITHOUT repeaters (data-source-item type)
    // These access single items like data[0].name and should not re-render on state changes
    // We wrap their params in useMemo to prevent reference changes from triggering re-renders
    const dataProvidersWithoutRepeaters = dataProviders.filter((dp) => {
      const hasRepeater = findArrayMapperRenderPropInDataProvider(dp) !== undefined
      return !hasRepeater
    })

    dataProvidersWithoutRepeaters.forEach((dp) => {
      stabilizeDataProviderWithoutRepeater(dp)
    })

    // STEP 4: Wire search inputs
    // Match search inputs to usages by order (within each dataSourceIdentifier that has search enabled)
    const searchInputs = findAllSearchInputsInJSX(blockStatement)

    // Get all search-enabled usages in order
    const searchEnabledUsages = registry.usages.filter((u) => u.searchEnabled)

    // Match by order - search input 0 -> searchEnabledUsages[0], etc.
    searchInputs.forEach((input, idx) => {
      if (idx >= searchEnabledUsages.length) {
        return
      }

      const usage = searchEnabledUsages[idx]
      const vars = getStateVarsForUsage(usage)
      wireSearchInput(input.node, vars)
    })

    // STEP 5: Wire pagination buttons
    // Match pagination nodes to usages by order (within paginated usages)
    const paginationNodes = findAllPaginationNodesInJSX(blockStatement)

    // Get all paginated usages in order
    const paginatedUsages = registry.usages.filter((u) => u.paginated)

    // Match by order - pagination node 0 -> paginatedUsages[0], etc.
    paginationNodes.forEach((paginationNode, idx) => {
      if (idx >= paginatedUsages.length) {
        return
      }

      const usage = paginatedUsages[idx]
      const vars = getStateVarsForUsage(usage)
      wirePaginationButtons(paginationNode.node, usage, vars)
    })

    // STEP 6: Update getStaticProps if this is a page
    if (isPage) {
      updateGetStaticProps(chunks, registry, dependencies)
    }

    return structure
  }

  return paginationPlugin
}

// ==================== HELPER FUNCTIONS ====================

function findAllDataProvidersInJSX(blockStatement: types.BlockStatement): any[] {
  const results: any[] = []

  const traverse = (node: any): void => {
    if (!node) {
      return
    }

    if (node.type === 'JSXElement' && node.openingElement?.name?.name === 'DataProvider') {
      results.push(node)
    }

    if (node.children && Array.isArray(node.children)) {
      node.children.forEach((c: any) => traverse(c))
    }

    if (node.body) {
      if (Array.isArray(node.body)) {
        node.body.forEach((s: any) => traverse(s))
      } else {
        traverse(node.body)
      }
    }

    if (node.consequent) {
      traverse(node.consequent)
    }

    if (node.alternate) {
      traverse(node.alternate)
    }

    if (node.expression) {
      traverse(node.expression)
    }

    if (node.argument) {
      traverse(node.argument)
    }

    if (node.arguments) {
      node.arguments.forEach((a: any) => traverse(a))
    }
  }

  traverse(blockStatement)
  return results
}

function findArrayMapperRenderPropInDataProvider(dataProvider: any): string | undefined {
  const renderSuccessAttr = dataProvider.openingElement.attributes.find(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'renderSuccess'
  )

  if (!renderSuccessAttr?.value?.expression) {
    return undefined
  }

  const findRepeater = (node: any): any => {
    if (!node) {
      return null
    }

    if (node.type === 'JSXElement' && node.openingElement?.name?.name === 'Repeater') {
      return node
    }

    if (node.body) {
      return findRepeater(node.body)
    }

    if (node.children && Array.isArray(node.children)) {
      for (const c of node.children) {
        const r = findRepeater(c)
        if (r) {
          return r
        }
      }
    }
    return null
  }

  const repeater = findRepeater(renderSuccessAttr.value.expression)
  if (!repeater) {
    return undefined
  }

  const renderItemAttr = repeater.openingElement.attributes.find(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'renderItem'
  )

  if (!renderItemAttr?.value?.expression?.params?.[0]?.name) {
    return undefined
  }

  return renderItemAttr.value.expression.params[0].name
}

function findAllSearchInputsInJSX(
  blockStatement: types.BlockStatement
): Array<{ node: any; className: string }> {
  const results: Array<{ node: any; className: string }> = []

  const traverse = (node: any): void => {
    if (!node) {
      return
    }

    if (node.type === 'JSXElement' && node.openingElement?.name?.name === 'input') {
      const classAttr = node.openingElement.attributes?.find(
        (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'className'
      )
      const className = classAttr?.value?.value || classAttr?.value?.expression?.value || ''
      if (className.includes('search-input')) {
        results.push({ node, className })
      }
    }

    if (node.children && Array.isArray(node.children)) {
      node.children.forEach((c: any) => traverse(c))
    }
    if (node.body) {
      if (Array.isArray(node.body)) {
        node.body.forEach((s: any) => traverse(s))
      } else {
        traverse(node.body)
      }
    }
    if (node.consequent) {
      traverse(node.consequent)
    }
    if (node.alternate) {
      traverse(node.alternate)
    }
    if (node.expression) {
      traverse(node.expression)
    }
    if (node.argument) {
      traverse(node.argument)
    }
  }

  traverse(blockStatement)
  return results
}

function findAllPaginationNodesInJSX(
  blockStatement: types.BlockStatement
): Array<{ node: any; className: string }> {
  const results: Array<{ node: any; className: string }> = []

  const traverse = (node: any): void => {
    if (!node) {
      return
    }

    if (node.type === 'JSXElement') {
      const classAttr = node.openingElement?.attributes?.find(
        (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'className'
      )
      const className = classAttr?.value?.value || classAttr?.value?.expression?.value || ''
      if (className.includes('cms-pagination-node')) {
        results.push({ node, className })
      }
    }

    if (node.children && Array.isArray(node.children)) {
      node.children.forEach((c: any) => traverse(c))
    }
    if (node.body) {
      if (Array.isArray(node.body)) {
        node.body.forEach((s: any) => traverse(s))
      } else {
        traverse(node.body)
      }
    }
    if (node.consequent) {
      traverse(node.consequent)
    }
    if (node.alternate) {
      traverse(node.alternate)
    }
    if (node.expression) {
      traverse(node.expression)
    }
    if (node.argument) {
      traverse(node.argument)
    }
  }

  traverse(blockStatement)
  return results
}

function updateDataProviderForPaginatedSearch(
  dp: any,
  usage: DataSourceUsage,
  vars: ReturnType<typeof getStateVarsForUsage>,
  fileName: string
): void {
  const attrs = dp.openingElement.attributes

  // Remove existing params, key, initialData, fetchData, persistDataDuringLoading
  dp.openingElement.attributes = attrs.filter(
    (attr: any) =>
      !['params', 'key', 'initialData', 'fetchData', 'persistDataDuringLoading'].includes(
        attr.name?.name
      )
  )

  // Add params with useMemo
  const paramsProps: types.ObjectProperty[] = [
    types.objectProperty(
      types.identifier('page'),
      types.memberExpression(types.identifier(vars.combinedStateVar), types.identifier('page'))
    ),
    types.objectProperty(types.identifier('perPage'), types.numericLiteral(usage.perPage)),
    types.objectProperty(
      types.identifier('query'),
      types.memberExpression(
        types.identifier(vars.combinedStateVar),
        types.identifier('debouncedQuery')
      )
    ),
  ]
  if (usage.queryColumns.length > 0) {
    paramsProps.push(
      types.objectProperty(
        types.identifier('queryColumns'),
        types.callExpression(
          types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
          [types.arrayExpression(usage.queryColumns.map((c) => types.stringLiteral(c)))]
        )
      )
    )
  }

  // Add sorts if present
  if (usage.sorts && usage.sorts.length > 0) {
    paramsProps.push(
      types.objectProperty(
        types.identifier('sorts'),
        types.callExpression(
          types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
          [
            types.arrayExpression(
              usage.sorts.map((sort: any) =>
                types.objectExpression([
                  types.objectProperty(
                    types.identifier('field'),
                    types.stringLiteral(sort.field || '')
                  ),
                  types.objectProperty(
                    types.identifier('order'),
                    types.stringLiteral(sort.order || '')
                  ),
                ])
              )
            ),
          ]
        )
      )
    )
  }

  // Add filters if present
  if (usage.filters && usage.filters.length > 0) {
    paramsProps.push(
      types.objectProperty(
        types.identifier('filters'),
        types.callExpression(
          types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
          [
            types.arrayExpression(
              usage.filters.map((filter: any) =>
                types.objectExpression([
                  types.objectProperty(
                    types.identifier('source'),
                    types.stringLiteral(filter.source || '')
                  ),
                  types.objectProperty(
                    types.identifier('destination'),
                    types.stringLiteral(filter.destination || '')
                  ),
                  types.objectProperty(
                    types.identifier('operand'),
                    types.stringLiteral(filter.operand || '')
                  ),
                ])
              )
            ),
          ]
        )
      )
    )
  }

  dp.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('params'),
      types.jsxExpressionContainer(
        types.callExpression(types.identifier('useMemo'), [
          types.arrowFunctionExpression([], types.objectExpression(paramsProps)),
          types.arrayExpression([types.identifier(vars.combinedStateVar)]),
        ])
      )
    )
  )

  // Add initialData
  const initialDataCondition = types.logicalExpression(
    '&&',
    types.binaryExpression(
      '===',
      types.memberExpression(types.identifier(vars.combinedStateVar), types.identifier('page')),
      types.numericLiteral(1)
    ),
    types.unaryExpression(
      '!',
      types.memberExpression(
        types.identifier(vars.combinedStateVar),
        types.identifier('debouncedQuery')
      ),
      true
    )
  )
  dp.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('initialData'),
      types.jsxExpressionContainer(
        types.conditionalExpression(
          initialDataCondition,
          types.optionalMemberExpression(
            types.identifier('props'),
            types.identifier(vars.propsPrefix),
            false,
            true
          ),
          types.identifier('undefined')
        )
      )
    )
  )

  // Add key
  dp.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('key'),
      types.jsxExpressionContainer(
        types.templateLiteral(
          [
            types.templateElement({
              raw: `${usage.dataSourceIdentifier}-`,
              cooked: `${usage.dataSourceIdentifier}-`,
            }),
            types.templateElement({ raw: '-', cooked: '-' }),
            types.templateElement({ raw: '', cooked: '' }),
          ],
          [
            types.memberExpression(
              types.identifier(vars.combinedStateVar),
              types.identifier('page')
            ),
            types.memberExpression(
              types.identifier(vars.combinedStateVar),
              types.identifier('debouncedQuery')
            ),
          ]
        )
      )
    )
  )

  // Add fetchData
  dp.openingElement.attributes.push(createFetchDataAttribute(fileName))

  // Add persistDataDuringLoading
  dp.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('persistDataDuringLoading'),
      types.jsxExpressionContainer(types.booleanLiteral(true))
    )
  )
}

function updateDataProviderForPaginationOnly(
  dp: any,
  usage: DataSourceUsage,
  vars: ReturnType<typeof getStateVarsForUsage>,
  fileName: string
): void {
  const attrs = dp.openingElement.attributes

  dp.openingElement.attributes = attrs.filter(
    (attr: any) =>
      !['params', 'key', 'initialData', 'fetchData', 'persistDataDuringLoading'].includes(
        attr.name?.name
      )
  )

  // Build params properties
  const paramsProps: types.ObjectProperty[] = [
    types.objectProperty(types.identifier('page'), types.identifier(vars.pageStateVar)),
    types.objectProperty(types.identifier('perPage'), types.numericLiteral(usage.perPage)),
  ]

  // Add sorts if present
  if (usage.sorts && usage.sorts.length > 0) {
    paramsProps.push(
      types.objectProperty(
        types.identifier('sorts'),
        types.callExpression(
          types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
          [
            types.arrayExpression(
              usage.sorts.map((sort: any) =>
                types.objectExpression([
                  types.objectProperty(
                    types.identifier('field'),
                    types.stringLiteral(sort.field || '')
                  ),
                  types.objectProperty(
                    types.identifier('order'),
                    types.stringLiteral(sort.order || '')
                  ),
                ])
              )
            ),
          ]
        )
      )
    )
  }

  // Add filters if present
  if (usage.filters && usage.filters.length > 0) {
    paramsProps.push(
      types.objectProperty(
        types.identifier('filters'),
        types.callExpression(
          types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
          [
            types.arrayExpression(
              usage.filters.map((filter: any) =>
                types.objectExpression([
                  types.objectProperty(
                    types.identifier('source'),
                    types.stringLiteral(filter.source || '')
                  ),
                  types.objectProperty(
                    types.identifier('destination'),
                    types.stringLiteral(filter.destination || '')
                  ),
                  types.objectProperty(
                    types.identifier('operand'),
                    types.stringLiteral(filter.operand || '')
                  ),
                ])
              )
            ),
          ]
        )
      )
    )
  }

  // Add params
  dp.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('params'),
      types.jsxExpressionContainer(
        types.callExpression(types.identifier('useMemo'), [
          types.arrowFunctionExpression([], types.objectExpression(paramsProps)),
          types.arrayExpression([types.identifier(vars.pageStateVar)]),
        ])
      )
    )
  )

  // Add initialData
  dp.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('initialData'),
      types.jsxExpressionContainer(
        types.conditionalExpression(
          types.binaryExpression(
            '===',
            types.identifier(vars.pageStateVar),
            types.numericLiteral(1)
          ),
          types.optionalMemberExpression(
            types.identifier('props'),
            types.identifier(vars.propsPrefix),
            false,
            true
          ),
          types.identifier('undefined')
        )
      )
    )
  )

  // Add key
  dp.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('key'),
      types.jsxExpressionContainer(
        types.templateLiteral(
          [
            types.templateElement({
              raw: `${usage.dataSourceIdentifier}-page-`,
              cooked: `${usage.dataSourceIdentifier}-page-`,
            }),
            types.templateElement({ raw: '', cooked: '' }),
          ],
          [types.identifier(vars.pageStateVar)]
        )
      )
    )
  )

  // Add fetchData
  dp.openingElement.attributes.push(createFetchDataAttribute(fileName))

  dp.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('persistDataDuringLoading'),
      types.jsxExpressionContainer(types.booleanLiteral(true))
    )
  )
}

function updateDataProviderForSearchOnly(
  dp: any,
  usage: DataSourceUsage,
  vars: ReturnType<typeof getStateVarsForUsage>,
  fileName: string
): void {
  const attrs = dp.openingElement.attributes

  dp.openingElement.attributes = attrs.filter(
    (attr: any) =>
      !['params', 'key', 'initialData', 'fetchData', 'persistDataDuringLoading'].includes(
        attr.name?.name
      )
  )

  // Add params
  const paramsProps: types.ObjectProperty[] = [
    types.objectProperty(types.identifier('query'), types.identifier(vars.debouncedSearchQueryVar)),
  ]
  if (usage.queryColumns.length > 0) {
    paramsProps.push(
      types.objectProperty(
        types.identifier('queryColumns'),
        types.callExpression(
          types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
          [types.arrayExpression(usage.queryColumns.map((c) => types.stringLiteral(c)))]
        )
      )
    )
  }

  // Add sorts if present
  if (usage.sorts && usage.sorts.length > 0) {
    paramsProps.push(
      types.objectProperty(
        types.identifier('sorts'),
        types.callExpression(
          types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
          [
            types.arrayExpression(
              usage.sorts.map((sort: any) =>
                types.objectExpression([
                  types.objectProperty(
                    types.identifier('field'),
                    types.stringLiteral(sort.field || '')
                  ),
                  types.objectProperty(
                    types.identifier('order'),
                    types.stringLiteral(sort.order || '')
                  ),
                ])
              )
            ),
          ]
        )
      )
    )
  }

  // Add filters if present
  if (usage.filters && usage.filters.length > 0) {
    paramsProps.push(
      types.objectProperty(
        types.identifier('filters'),
        types.callExpression(
          types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
          [
            types.arrayExpression(
              usage.filters.map((filter: any) =>
                types.objectExpression([
                  types.objectProperty(
                    types.identifier('source'),
                    types.stringLiteral(filter.source || '')
                  ),
                  types.objectProperty(
                    types.identifier('destination'),
                    types.stringLiteral(filter.destination || '')
                  ),
                  types.objectProperty(
                    types.identifier('operand'),
                    types.stringLiteral(filter.operand || '')
                  ),
                ])
              )
            ),
          ]
        )
      )
    )
  }

  dp.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('params'),
      types.jsxExpressionContainer(
        types.callExpression(types.identifier('useMemo'), [
          types.arrowFunctionExpression([], types.objectExpression(paramsProps)),
          types.arrayExpression([types.identifier(vars.debouncedSearchQueryVar)]),
        ])
      )
    )
  )

  // Add initialData
  dp.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('initialData'),
      types.jsxExpressionContainer(
        types.conditionalExpression(
          types.unaryExpression('!', types.identifier(vars.debouncedSearchQueryVar), true),
          types.optionalMemberExpression(
            types.identifier('props'),
            types.identifier(vars.propsPrefix),
            false,
            true
          ),
          types.identifier('undefined')
        )
      )
    )
  )

  // Add key
  dp.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('key'),
      types.jsxExpressionContainer(
        types.templateLiteral(
          [
            types.templateElement({ raw: 'search-', cooked: 'search-' }),
            types.templateElement({ raw: '', cooked: '' }),
          ],
          [types.identifier(vars.debouncedSearchQueryVar)]
        )
      )
    )
  )

  // Add fetchData
  dp.openingElement.attributes.push(createFetchDataAttribute(fileName))

  dp.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('persistDataDuringLoading'),
      types.jsxExpressionContainer(types.booleanLiteral(true))
    )
  )
}

function updateDataProviderForPlain(dp: any): void {
  const attrs = dp.openingElement.attributes

  // Find the params attribute
  const paramsAttrIndex = attrs.findIndex(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'params'
  )

  if (paramsAttrIndex === -1) {
    return
  }

  const paramsAttr = attrs[paramsAttrIndex] as types.JSXAttribute

  // Check if params is already wrapped in useMemo
  if (
    paramsAttr.value?.type === 'JSXExpressionContainer' &&
    paramsAttr.value.expression.type === 'CallExpression' &&
    (paramsAttr.value.expression.callee as types.Identifier)?.name === 'useMemo'
  ) {
    return
  }

  // Get the current params value expression
  let paramsExpression: types.Expression | null = null

  if (paramsAttr.value?.type === 'JSXExpressionContainer') {
    paramsExpression = paramsAttr.value.expression as types.Expression
  }

  if (!paramsExpression) {
    return
  }

  // Wrap params in useMemo with empty dependencies array
  const memoizedParams = types.callExpression(types.identifier('useMemo'), [
    types.arrowFunctionExpression([], paramsExpression),
    types.arrayExpression([]),
  ])

  // Replace the params attribute
  attrs[paramsAttrIndex] = types.jsxAttribute(
    types.jsxIdentifier('params'),
    types.jsxExpressionContainer(memoizedParams)
  )
}

function stabilizeDataProviderWithoutRepeater(dp: any): void {
  const attrs = dp.openingElement.attributes

  // Find the params attribute
  const paramsAttrIndex = attrs.findIndex(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'params'
  )

  if (paramsAttrIndex === -1) {
    return
  }

  const paramsAttr = attrs[paramsAttrIndex] as types.JSXAttribute

  // Check if params is already wrapped in useMemo
  if (
    paramsAttr.value?.type === 'JSXExpressionContainer' &&
    paramsAttr.value.expression.type === 'CallExpression' &&
    (paramsAttr.value.expression.callee as types.Identifier)?.name === 'useMemo'
  ) {
    return
  }

  // Get the current params value expression
  let paramsExpression: types.Expression | null = null

  if (paramsAttr.value?.type === 'JSXExpressionContainer') {
    paramsExpression = paramsAttr.value.expression as types.Expression
  }

  if (!paramsExpression) {
    return
  }

  // Wrap params in useMemo with empty dependencies array
  // This ensures the object reference stays stable across re-renders
  const memoizedParams = types.callExpression(types.identifier('useMemo'), [
    types.arrowFunctionExpression([], paramsExpression),
    types.arrayExpression([]),
  ])

  // Replace the params attribute
  attrs[paramsAttrIndex] = types.jsxAttribute(
    types.jsxIdentifier('params'),
    types.jsxExpressionContainer(memoizedParams)
  )
}

function createFetchDataAttribute(fileName: string): types.JSXAttribute {
  return types.jsxAttribute(
    types.jsxIdentifier('fetchData'),
    types.jsxExpressionContainer(
      types.callExpression(types.identifier('useCallback'), [
        types.arrowFunctionExpression(
          [types.identifier('params')],
          types.callExpression(
            types.memberExpression(
              types.callExpression(
                types.memberExpression(
                  types.callExpression(types.identifier('fetch'), [
                    types.templateLiteral(
                      [
                        types.templateElement({
                          raw: `/api/${fileName}?`,
                          cooked: `/api/${fileName}?`,
                        }),
                        types.templateElement({ raw: '', cooked: '' }),
                      ],
                      [
                        types.newExpression(types.identifier('URLSearchParams'), [
                          types.identifier('params'),
                        ]),
                      ]
                    ),
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
                      types.memberExpression(types.identifier('res'), types.identifier('json')),
                      []
                    )
                  ),
                ]
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
        types.arrayExpression([]),
      ])
    )
  )
}

function wireSearchInput(inputNode: any, vars: ReturnType<typeof getStateVarsForUsage>): void {
  // Remove existing onChange and value
  inputNode.openingElement.attributes = inputNode.openingElement.attributes.filter(
    (attr: any) => !['onChange', 'value'].includes(attr.name?.name)
  )

  // Add onChange
  inputNode.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('onChange'),
      types.jsxExpressionContainer(
        types.arrowFunctionExpression(
          [types.identifier('e')],
          types.callExpression(types.identifier(vars.setSearchQueryVar), [
            types.memberExpression(
              types.memberExpression(types.identifier('e'), types.identifier('target')),
              types.identifier('value')
            ),
          ])
        )
      )
    )
  )

  // Add value
  inputNode.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('value'),
      types.jsxExpressionContainer(types.identifier(vars.searchQueryVar))
    )
  )
}

function wirePaginationButtons(
  paginationNode: any,
  usage: DataSourceUsage,
  vars: ReturnType<typeof getStateVarsForUsage>
): void {
  // Find prev and next buttons
  const findButton = (node: any, direction: 'previous' | 'next'): any => {
    if (!node) {
      return null
    }

    if (node.type === 'JSXElement') {
      const classAttr = node.openingElement?.attributes?.find(
        (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'className'
      )
      const className = classAttr?.value?.value || classAttr?.value?.expression?.value || ''
      if (className.includes(direction)) {
        return node
      }
    }

    if (node.children && Array.isArray(node.children)) {
      for (const c of node.children) {
        const found = findButton(c, direction)
        if (found) {
          return found
        }
      }
    }
    return null
  }

  const prevButton = findButton(paginationNode, 'previous')
  const nextButton = findButton(paginationNode, 'next')

  const isCombinedState = usage.category === 'paginated+search'

  if (prevButton) {
    // Change to button element
    prevButton.openingElement.name.name = 'button'
    if (prevButton.closingElement) {
      prevButton.closingElement.name.name = 'button'
    }

    // Add type="button"
    const hasType = prevButton.openingElement.attributes.some((a: any) => a.name?.name === 'type')
    if (!hasType) {
      prevButton.openingElement.attributes.push(
        types.jsxAttribute(types.jsxIdentifier('type'), types.stringLiteral('button'))
      )
    }

    // Add onClick
    prevButton.openingElement.attributes = prevButton.openingElement.attributes.filter(
      (a: any) => a.name?.name !== 'onClick'
    )

    if (isCombinedState) {
      prevButton.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('onClick'),
          types.jsxExpressionContainer(
            types.arrowFunctionExpression(
              [],
              types.callExpression(types.identifier(vars.setCombinedStateVar), [
                types.arrowFunctionExpression(
                  [types.identifier('state')],
                  types.objectExpression([
                    types.spreadElement(types.identifier('state')),
                    types.objectProperty(
                      types.identifier('page'),
                      types.callExpression(
                        types.memberExpression(types.identifier('Math'), types.identifier('max')),
                        [
                          types.numericLiteral(1),
                          types.binaryExpression(
                            '-',
                            types.memberExpression(
                              types.identifier('state'),
                              types.identifier('page')
                            ),
                            types.numericLiteral(1)
                          ),
                        ]
                      )
                    ),
                  ])
                ),
              ])
            )
          )
        )
      )

      // Add disabled
      prevButton.openingElement.attributes = prevButton.openingElement.attributes.filter(
        (a: any) => a.name?.name !== 'disabled'
      )
      prevButton.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('disabled'),
          types.jsxExpressionContainer(
            types.binaryExpression(
              '<=',
              types.memberExpression(
                types.identifier(vars.combinedStateVar),
                types.identifier('page')
              ),
              types.numericLiteral(1)
            )
          )
        )
      )
    } else {
      prevButton.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('onClick'),
          types.jsxExpressionContainer(
            types.arrowFunctionExpression(
              [],
              types.callExpression(types.identifier(vars.setPageStateVar), [
                types.arrowFunctionExpression(
                  [types.identifier('page')],
                  types.callExpression(
                    types.memberExpression(types.identifier('Math'), types.identifier('max')),
                    [
                      types.numericLiteral(1),
                      types.binaryExpression(
                        '-',
                        types.identifier('page'),
                        types.numericLiteral(1)
                      ),
                    ]
                  )
                ),
              ])
            )
          )
        )
      )

      prevButton.openingElement.attributes = prevButton.openingElement.attributes.filter(
        (a: any) => a.name?.name !== 'disabled'
      )
      prevButton.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('disabled'),
          types.jsxExpressionContainer(
            types.binaryExpression(
              '<=',
              types.identifier(vars.pageStateVar),
              types.numericLiteral(1)
            )
          )
        )
      )
    }
  }

  if (nextButton) {
    nextButton.openingElement.name.name = 'button'
    if (nextButton.closingElement) {
      nextButton.closingElement.name.name = 'button'
    }

    const hasType = nextButton.openingElement.attributes.some((a: any) => a.name?.name === 'type')
    if (!hasType) {
      nextButton.openingElement.attributes.push(
        types.jsxAttribute(types.jsxIdentifier('type'), types.stringLiteral('button'))
      )
    }

    nextButton.openingElement.attributes = nextButton.openingElement.attributes.filter(
      (a: any) => a.name?.name !== 'onClick'
    )

    if (isCombinedState) {
      nextButton.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('onClick'),
          types.jsxExpressionContainer(
            types.arrowFunctionExpression(
              [],
              types.callExpression(types.identifier(vars.setCombinedStateVar), [
                types.arrowFunctionExpression(
                  [types.identifier('state')],
                  types.objectExpression([
                    types.spreadElement(types.identifier('state')),
                    types.objectProperty(
                      types.identifier('page'),
                      types.binaryExpression(
                        '+',
                        types.memberExpression(types.identifier('state'), types.identifier('page')),
                        types.numericLiteral(1)
                      )
                    ),
                  ])
                ),
              ])
            )
          )
        )
      )

      nextButton.openingElement.attributes = nextButton.openingElement.attributes.filter(
        (a: any) => a.name?.name !== 'disabled'
      )
      nextButton.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('disabled'),
          types.jsxExpressionContainer(
            types.binaryExpression(
              '>=',
              types.memberExpression(
                types.identifier(vars.combinedStateVar),
                types.identifier('page')
              ),
              types.identifier(vars.maxPagesStateVar)
            )
          )
        )
      )
    } else {
      nextButton.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('onClick'),
          types.jsxExpressionContainer(
            types.arrowFunctionExpression(
              [],
              types.callExpression(types.identifier(vars.setPageStateVar), [
                types.arrowFunctionExpression(
                  [types.identifier('page')],
                  types.binaryExpression('+', types.identifier('page'), types.numericLiteral(1))
                ),
              ])
            )
          )
        )
      )

      nextButton.openingElement.attributes = nextButton.openingElement.attributes.filter(
        (a: any) => a.name?.name !== 'disabled'
      )
      nextButton.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('disabled'),
          types.jsxExpressionContainer(
            types.binaryExpression(
              '>=',
              types.identifier(vars.pageStateVar),
              types.identifier(vars.maxPagesStateVar)
            )
          )
        )
      )
    }
  }
}

function ensureAPIRouteExists(extractedResources: any, usage: DataSourceUsage): void {
  // Generate file name for the API route
  const fileName = generateSafeFileName(
    usage.resourceDefinition.dataSourceType,
    usage.resourceDefinition.tableName,
    usage.resourceDefinition.dataSourceId
  )

  // Check if the utils data source file exists - if so, create API routes that re-export from it
  if (extractedResources[`utils/${fileName}`]) {
    // Create main data API route if not exists
    if (!extractedResources[`api/${fileName}`]) {
      const apiRouteCode = `import dataSourceModule from '../../utils/data-sources/${fileName}'

export default dataSourceModule.handler
`
      extractedResources[`api/${fileName}`] = {
        fileName,
        fileType: FileType.JS,
        path: ['pages', 'api'],
        content: apiRouteCode,
      }
    }

    // Create count API route if not exists (needed for paginated+search cases)
    const countFileName = `${fileName}-count`
    if (!extractedResources[`api/${countFileName}`]) {
      const countApiRouteCode = `import dataSourceModule from '../../utils/data-sources/${fileName}'

export default dataSourceModule.getCount
`
      extractedResources[`api/${countFileName}`] = {
        fileName: countFileName,
        fileType: FileType.JS,
        path: ['pages', 'api'],
        content: countApiRouteCode,
      }
    }
  }
}

function updateGetStaticProps(
  chunks: any[],
  registry: StateRegistry,
  dependencies: Record<string, any>
): void {
  const getStaticPropsChunk = chunks.find((c) => c.name === 'getStaticProps')
  if (!getStaticPropsChunk || getStaticPropsChunk.type !== ChunkType.AST) {
    return
  }

  const content = getStaticPropsChunk.content as types.ExportNamedDeclaration
  if (!content.declaration || content.declaration.type !== 'FunctionDeclaration') {
    return
  }

  const funcBody = content.declaration.body
  const tryStmt = funcBody.body.find((s: any) => s.type === 'TryStatement') as
    | types.TryStatement
    | undefined
  if (!tryStmt) {
    return
  }

  const tryBlock = tryStmt.block

  // Find existing Promise.all
  const promiseAllDecl = tryBlock.body.find(
    (s: any) =>
      s.type === 'VariableDeclaration' &&
      s.declarations?.[0]?.init?.type === 'AwaitExpression' &&
      s.declarations?.[0]?.init?.argument?.type === 'CallExpression' &&
      s.declarations?.[0]?.init?.argument?.callee?.type === 'MemberExpression' &&
      s.declarations?.[0]?.init?.argument?.callee?.object?.name === 'Promise'
  ) as types.VariableDeclaration | undefined

  if (!promiseAllDecl) {
    return
  }

  const declarator = promiseAllDecl.declarations[0] as types.VariableDeclarator
  const awaitExpr = declarator.init as types.AwaitExpression
  const promiseAllCall = awaitExpr.argument as types.CallExpression
  const fetchesArray = promiseAllCall.arguments[0] as types.ArrayExpression

  // Find return statement
  const returnStmt = tryBlock.body.find((s: any) => s.type === 'ReturnStatement') as
    | types.ReturnStatement
    | undefined
  if (!returnStmt || returnStmt.argument?.type !== 'ObjectExpression') {
    return
  }

  const returnObj = returnStmt.argument as types.ObjectExpression
  const propsProperty = returnObj.properties.find(
    (p: any) => p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === 'props'
  ) as types.ObjectProperty | undefined

  if (!propsProperty || propsProperty.value.type !== 'ObjectExpression') {
    return
  }

  const propsObj = propsProperty.value as types.ObjectExpression
  const arrayPattern = declarator.id as types.ArrayPattern

  // Track unique data sources for count fetching
  const dataSourcesNeedingCount = new Set<string>()

  // Only process usages that need pagination or search functionality
  // Non-paginated, non-search usages are handled by the main plugin
  registry.usages
    .filter((u) => u.paginated || u.searchEnabled)
    .forEach((usage) => {
      const vars = getStateVarsForUsage(usage)
      const fileName = generateSafeFileName(
        usage.resourceDefinition.dataSourceType,
        usage.resourceDefinition.tableName,
        usage.resourceDefinition.dataSourceId
      )
      // Use consistent import name generation (matches extractDataSourceIntoGetStaticProps)
      const fetcherImportName = StringUtils.dashCaseToCamelCase(fileName)

      // Add fetch call
      const fetchParams: types.ObjectProperty[] = []

      if (usage.paginated) {
        // For paginated array mappers, add page and perPage
        fetchParams.push(types.objectProperty(types.identifier('page'), types.numericLiteral(1)))
        fetchParams.push(
          types.objectProperty(types.identifier('perPage'), types.numericLiteral(usage.perPage))
        )
      } else if (usage.perPage > 0) {
        // For non-paginated array mappers with a limit, add the limit as perPage
        // This ensures the initial data fetch respects the limit from the UIDL
        fetchParams.push(
          types.objectProperty(types.identifier('perPage'), types.numericLiteral(usage.perPage))
        )
      }
      if (usage.queryColumns.length > 0) {
        fetchParams.push(
          types.objectProperty(
            types.identifier('queryColumns'),
            types.callExpression(
              types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
              [types.arrayExpression(usage.queryColumns.map((c) => types.stringLiteral(c)))]
            )
          )
        )
      }

      // Add sorts if present
      if (usage.sorts && usage.sorts.length > 0) {
        fetchParams.push(
          types.objectProperty(
            types.identifier('sorts'),
            types.callExpression(
              types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
              [
                types.arrayExpression(
                  usage.sorts.map((sort: any) =>
                    types.objectExpression([
                      types.objectProperty(
                        types.identifier('field'),
                        types.stringLiteral(sort.field || '')
                      ),
                      types.objectProperty(
                        types.identifier('order'),
                        types.stringLiteral(sort.order || '')
                      ),
                    ])
                  )
                ),
              ]
            )
          )
        )
      }

      // Add filters if present
      if (usage.filters && usage.filters.length > 0) {
        fetchParams.push(
          types.objectProperty(
            types.identifier('filters'),
            types.callExpression(
              types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
              [
                types.arrayExpression(
                  usage.filters.map((filter: any) =>
                    types.objectExpression([
                      types.objectProperty(
                        types.identifier('source'),
                        types.stringLiteral(filter.source || '')
                      ),
                      types.objectProperty(
                        types.identifier('destination'),
                        types.stringLiteral(filter.destination || '')
                      ),
                      types.objectProperty(
                        types.identifier('operand'),
                        types.stringLiteral(filter.operand || '')
                      ),
                    ])
                  )
                ),
              ]
            )
          )
        )
      }

      // Check if this fetch already exists
      const existingFetchIndex = arrayPattern.elements.findIndex(
        (el: any) => el?.type === 'Identifier' && el.name === vars.propsPrefix
      )

      if (existingFetchIndex === -1) {
        arrayPattern.elements.push(types.identifier(vars.propsPrefix))

        fetchesArray.elements.push(
          types.callExpression(
            types.memberExpression(
              types.callExpression(
                types.memberExpression(
                  types.identifier(fetcherImportName),
                  types.identifier('fetchData')
                ),
                [types.objectExpression(fetchParams)]
              ),
              types.identifier('catch')
            ),
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
                        types.stringLiteral(`Error fetching ${vars.propsPrefix}:`),
                        types.identifier('error'),
                      ]
                    )
                  ),
                  types.returnStatement(types.arrayExpression([])),
                ])
              ),
            ]
          )
        )

        // Add import dependency for the fetcher
        if (!dependencies[fetcherImportName]) {
          dependencies[fetcherImportName] = {
            type: 'local',
            path: `../utils/data-sources/${fileName}`,
          }
        }

        // Add to props
        propsObj.properties.push(
          types.objectProperty(
            types.identifier(vars.propsPrefix),
            types.identifier(vars.propsPrefix)
          )
        )
      }

      // Track for count fetching
      if (usage.paginated) {
        dataSourcesNeedingCount.add(
          `${usage.resourceDefinition.dataSourceType}:${usage.resourceDefinition.tableName}:${usage.resourceDefinition.dataSourceId}`
        )
      }

      // Add maxPages calculation for paginated
      if (usage.paginated) {
        const maxPagesPropName = `${vars.propsPrefix}_maxPages`
        // Use filter-specific count variable if usage has filters
        const hasFilters = usage.filters && usage.filters.length > 0
        const countVarName = hasFilters
          ? `${usage.dataSourceIdentifier}_ds_${usage.index}_count`
          : `${usage.dataSourceIdentifier}_count`

        // Check if maxPages calculation already exists
        const existingMaxPages = tryBlock.body.find(
          (s: any) =>
            s.type === 'VariableDeclaration' && s.declarations?.[0]?.id?.name === maxPagesPropName
        )

        if (!existingMaxPages) {
          // Insert maxPages calculation before return
          const returnIndex = tryBlock.body.indexOf(returnStmt)
          tryBlock.body.splice(
            returnIndex,
            0,
            types.variableDeclaration('const', [
              types.variableDeclarator(
                types.identifier(maxPagesPropName),
                types.callExpression(
                  types.memberExpression(types.identifier('Math'), types.identifier('ceil')),
                  [
                    types.binaryExpression(
                      '/',
                      types.logicalExpression(
                        '||',
                        types.identifier(countVarName),
                        types.numericLiteral(0)
                      ),
                      types.numericLiteral(usage.perPage)
                    ),
                  ]
                )
              ),
            ])
          )

          // Add maxPages to props
          propsObj.properties.push(
            types.objectProperty(
              types.identifier(maxPagesPropName),
              types.identifier(maxPagesPropName)
            )
          )
        }
      }
    })

  // Add count fetches for unique data sources
  // Group usages by filters to determine which need separate count fetches
  const processedCountKeys = new Set<string>()

  dataSourcesNeedingCount.forEach((key) => {
    const [dataSourceType, tableName, dataSourceId] = key.split(':')
    const fileName = generateSafeFileName(dataSourceType, tableName, dataSourceId)
    const fetcherImportName = StringUtils.dashCaseToCamelCase(fileName)

    // Find all paginated usages for this data source
    const usagesForDataSource = registry.usages.filter(
      (u) =>
        u.resourceDefinition.dataSourceId === dataSourceId &&
        u.resourceDefinition.tableName === tableName &&
        u.paginated
    )

    if (usagesForDataSource.length === 0) {
      return
    }

    // Group usages by their filters (stringify for comparison)
    const usagesByFilters = new Map<string, DataSourceUsage[]>()
    for (const usage of usagesForDataSource) {
      const filtersKey = JSON.stringify(usage.filters || [])
      const existing = usagesByFilters.get(filtersKey) || []
      existing.push(usage)
      usagesByFilters.set(filtersKey, existing)
    }

    // Generate count fetches for each unique filter configuration
    usagesByFilters.forEach((usages, filtersKey) => {
      const firstUsage = usages[0]
      const hasFilters = firstUsage.filters && firstUsage.filters.length > 0

      // Create unique count variable name based on filters
      const countVarName = hasFilters
        ? `${firstUsage.dataSourceIdentifier}_ds_${firstUsage.index}_count`
        : `${firstUsage.dataSourceIdentifier}_count`

      // Check if this count was already processed
      const countKey = `${key}:${filtersKey}`
      if (processedCountKeys.has(countKey)) {
        return
      }
      processedCountKeys.add(countKey)

      // Check if count fetch already exists
      const existingCount = arrayPattern.elements.findIndex(
        (el: any) => el?.type === 'Identifier' && el.name === countVarName
      )

      if (existingCount === -1) {
        arrayPattern.elements.push(types.identifier(countVarName))

        // Build count params if filters exist
        const countParams: types.ObjectProperty[] = []
        if (hasFilters) {
          countParams.push(
            types.objectProperty(
              types.identifier('filters'),
              types.callExpression(
                types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
                [
                  types.arrayExpression(
                    firstUsage.filters.map((f: any) =>
                      types.objectExpression([
                        types.objectProperty(
                          types.identifier('source'),
                          types.stringLiteral(f.source)
                        ),
                        types.objectProperty(
                          types.identifier('destination'),
                          types.stringLiteral(f.destination)
                        ),
                        types.objectProperty(
                          types.identifier('operand'),
                          types.stringLiteral(f.operand)
                        ),
                      ])
                    )
                  ),
                ]
              )
            )
          )
        }

        fetchesArray.elements.push(
          types.callExpression(
            types.memberExpression(
              types.identifier(fetcherImportName),
              types.identifier('fetchCount')
            ),
            countParams.length > 0 ? [types.objectExpression(countParams)] : []
          )
        )

        // Store which usages use this count variable for maxPages calculation
        for (const usage of usages) {
          // tslint:disable-next-line:no-any
          ;(usage as any).countVarName = countVarName
        }

        // Add import dependency for the fetcher
        if (!dependencies[fetcherImportName]) {
          dependencies[fetcherImportName] = {
            type: 'local',
            path: `../utils/data-sources/${fileName}`,
          }
        }
      }
    })
  })
}
