import {
  ComponentPlugin,
  ComponentPluginFactory,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'
import { generatePaginationLogic, ArrayMapperPaginationInfo } from './array-mapper-pagination'
import { extractDataSourceIntoNextAPIFolder } from './utils'

interface DetectedPagination {
  paginationNodeClass: string
  prevButtonClass: string | null
  nextButtonClass: string | null
  dataSourceIdentifier: string
  dataProviderJSX: any
  arrayMapperRenderProp?: string
  searchInputClass?: string | null
  searchInputJSX?: any
}

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

    const { paginatedMappers, searchOnlyMappers, paginationOnlyMappers } =
      detectPaginationsAndSearchFromJSX(blockStatement, uidl.node)

    if (
      paginatedMappers.length === 0 &&
      searchOnlyMappers.length === 0 &&
      paginationOnlyMappers.length === 0
    ) {
      return structure
    }

    // Combine pagination+search and pagination-only into one array for processing
    const detectedPaginations = [...paginatedMappers, ...paginationOnlyMappers]
    const detectedSearchOnly = searchOnlyMappers

    if (!dependencies.useState) {
      dependencies.useState = {
        type: 'library',
        path: 'react',
        version: '',
        meta: {
          namedImport: true,
        },
      }
    }

    if (!dependencies.useMemo) {
      dependencies.useMemo = {
        type: 'library',
        path: 'react',
        version: '',
        meta: {
          namedImport: true,
        },
      }
    }

    if (!dependencies.useCallback) {
      dependencies.useCallback = {
        type: 'library',
        path: 'react',
        version: '',
        meta: {
          namedImport: true,
        },
      }
    }

    if (!dependencies.useRef) {
      dependencies.useRef = {
        type: 'library',
        path: 'react',
        version: '',
        meta: {
          namedImport: true,
        },
      }
    }

    if (!componentChunk.meta) {
      componentChunk.meta = {}
    }
    componentChunk.meta.isClientComponent = true

    const paginationInfos: ArrayMapperPaginationInfo[] = []

    // Check if this is a page (has getStaticProps) or a component
    const getStaticPropsChunk = chunks.find((chunk) => chunk.name === 'getStaticProps')
    const isPage = !!getStaticPropsChunk
    const isComponent = !isPage

    // Get pagination and search config from early extraction (done before transformations)
    const opts = options as any
    const perPageMap = opts.paginationConfig?.perPageMap || new Map<string, number>()
    const searchConfigMap = opts.paginationConfig?.searchConfigMap || new Map<string, any>()
    const queryColumnsMap = opts.paginationConfig?.queryColumnsMap || new Map<string, string[]>()

    const stateDeclarations: types.Statement[] = []

    detectedPaginations.forEach((detected, index) => {
      const paginationNodeId = `pg_${index}`
      // Use arrayMapperRenderProp if available, otherwise fall back to dataSourceIdentifier
      const lookupKey = detected.arrayMapperRenderProp || detected.dataSourceIdentifier
      const perPage = perPageMap.get(lookupKey) || 10
      const searchConfig = searchConfigMap.get(lookupKey)
      // queryColumns is keyed by dataSourceIdentifier, not array mapper render prop
      const queryColumns = queryColumnsMap.get(detected.dataSourceIdentifier)

      const info = generatePaginationLogic(
        paginationNodeId,
        detected.dataSourceIdentifier,
        perPage,
        searchConfig,
        queryColumns
      )
      paginationInfos.push(info)

      // Add refs to track first render for each useEffect (add first)
      if (info.searchEnabled) {
        const skipCountFetchOnMountRefVar = `skipCountFetchOnMount_pg_${index}`
        const skipCountFetchRefAST = types.variableDeclaration('const', [
          types.variableDeclarator(
            types.identifier(skipCountFetchOnMountRefVar),
            types.callExpression(types.identifier('useRef'), [types.booleanLiteral(true)])
          ),
        ])
        stateDeclarations.push(skipCountFetchRefAST)
        ;(info as any).skipCountFetchOnMountRefVar = skipCountFetchOnMountRefVar

        const skipDebounceOnMountRefVar = `skipDebounceOnMount_pg_${index}`
        const skipDebounceRefAST = types.variableDeclaration('const', [
          types.variableDeclarator(
            types.identifier(skipDebounceOnMountRefVar),
            types.callExpression(types.identifier('useRef'), [types.booleanLiteral(true)])
          ),
        ])
        stateDeclarations.push(skipDebounceRefAST)
        ;(info as any).skipDebounceOnMountRefVar = skipDebounceOnMountRefVar
      }

      // Add maxPages state
      const maxPagesStateVar = `${info.pageStateVar.replace('_page', '')}_maxPages`
      const setMaxPagesStateVar = `set${
        maxPagesStateVar.charAt(0).toUpperCase() + maxPagesStateVar.slice(1)
      }`

      // For pages: initialize from props (with pagination-specific prop name), for components: initialize to 0
      const maxPagesInitValue = isPage
        ? types.logicalExpression(
            '||',
            types.optionalMemberExpression(
              types.identifier('props'),
              types.identifier(`${info.dataSourceIdentifier}_pg_${index}_maxPages`),
              false,
              true
            ),
            types.numericLiteral(0)
          )
        : types.numericLiteral(0)

      const maxPagesStateAST = types.variableDeclaration('const', [
        types.variableDeclarator(
          types.arrayPattern([
            types.identifier(maxPagesStateVar),
            types.identifier(setMaxPagesStateVar),
          ]),
          types.callExpression(types.identifier('useState'), [maxPagesInitValue])
        ),
      ])
      stateDeclarations.push(maxPagesStateAST)

      // Store these for later use
      ;(info as any).maxPagesStateVar = maxPagesStateVar
      ;(info as any).setMaxPagesStateVar = setMaxPagesStateVar

      // If both pagination and search are enabled, combine them into a single state object
      if (info.searchEnabled && info.searchQueryVar && info.setSearchQueryVar) {
        // Combined state: { page: 1, debouncedQuery: '' }
        const combinedStateVar = `paginationState_pg_${index}`
        const setCombinedStateVar = `setPaginationState_pg_${index}`

        const combinedStateAST = types.variableDeclaration('const', [
          types.variableDeclarator(
            types.arrayPattern([
              types.identifier(combinedStateVar),
              types.identifier(setCombinedStateVar),
            ]),
            types.callExpression(types.identifier('useState'), [
              types.objectExpression([
                types.objectProperty(types.identifier('page'), types.numericLiteral(1)),
                types.objectProperty(types.identifier('debouncedQuery'), types.stringLiteral('')),
              ]),
            ])
          ),
        ])
        stateDeclarations.push(combinedStateAST)

        // Still need the immediate search query state for the input
        const searchStateAST = types.variableDeclaration('const', [
          types.variableDeclarator(
            types.arrayPattern([
              types.identifier(info.searchQueryVar),
              types.identifier(info.setSearchQueryVar),
            ]),
            types.callExpression(types.identifier('useState'), [types.stringLiteral('')])
          ),
        ])
        stateDeclarations.push(searchStateAST)

        // Store the combined state var names
        ;(info as any).combinedStateVar = combinedStateVar
        ;(info as any).setCombinedStateVar = setCombinedStateVar
      } else {
        // If search is not enabled, just add regular page state
        const pageStateAST = types.variableDeclaration('const', [
          types.variableDeclarator(
            types.arrayPattern([
              types.identifier(info.pageStateVar),
              types.identifier(info.setPageStateVar),
            ]),
            types.callExpression(types.identifier('useState'), [types.numericLiteral(1)])
          ),
        ])
        stateDeclarations.push(pageStateAST)
      }
    })

    // Add all state declarations at once to the beginning in correct order
    stateDeclarations.reverse().forEach((stateDecl) => {
      blockStatement.body.unshift(stateDecl)
    })

    // Add useEffect dependency if any pagination has search enabled
    const hasSearchEnabled = paginationInfos.some((info) => info.searchEnabled)
    if (hasSearchEnabled && !dependencies.useEffect) {
      dependencies.useEffect = {
        type: 'library',
        path: 'react',
        version: '',
        meta: {
          namedImport: true,
        },
      }
    }

    // Add all useEffect hooks AFTER state declarations
    // Find the first return statement and insert effects before it
    const firstReturnIndex = blockStatement.body.findIndex(
      (stmt: any) => stmt.type === 'ReturnStatement'
    )
    const insertIndex = firstReturnIndex !== -1 ? firstReturnIndex : blockStatement.body.length

    // Add effects in reverse order so they appear in correct order
    paginationInfos.forEach((info) => {
      if (
        info.searchEnabled &&
        info.searchQueryVar &&
        info.debouncedSearchQueryVar &&
        info.setDebouncedSearchQueryVar
      ) {
        // Add effect that updates debounced search after delay
        const skipDebounceOnMountRefVar = (info as any).skipDebounceOnMountRefVar
        const setCombinedStateVar = (info as any).setCombinedStateVar

        const debounceEffect = types.expressionStatement(
          types.callExpression(types.identifier('useEffect'), [
            types.arrowFunctionExpression(
              [],
              types.blockStatement([
                types.ifStatement(
                  types.memberExpression(
                    types.identifier(skipDebounceOnMountRefVar),
                    types.identifier('current')
                  ),
                  types.blockStatement([
                    types.expressionStatement(
                      types.assignmentExpression(
                        '=',
                        types.memberExpression(
                          types.identifier(skipDebounceOnMountRefVar),
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
                            types.callExpression(types.identifier(setCombinedStateVar), [
                              types.objectExpression([
                                types.objectProperty(
                                  types.identifier('page'),
                                  types.numericLiteral(1)
                                ),
                                types.objectProperty(
                                  types.identifier('debouncedQuery'),
                                  types.identifier(info.searchQueryVar)
                                ),
                              ]),
                            ])
                          ),
                        ])
                      ),
                      types.numericLiteral(info.searchDebounce || 300),
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
            types.arrayExpression([types.identifier(info.searchQueryVar)]),
          ])
        )

        blockStatement.body.splice(insertIndex, 0, debounceEffect)

        // Add useEffect to refetch count when search changes (for both pages and components)
        const detected = detectedPaginations.find(
          (d) => d.dataSourceIdentifier === info.dataSourceIdentifier
        )
        if (!detected) {
          return
        }

        const resourceDefAttr = detected.dataProviderJSX.openingElement.attributes.find(
          (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'resourceDefinition'
        )

        if (
          resourceDefAttr &&
          resourceDefAttr.value &&
          resourceDefAttr.value.type === 'JSXExpressionContainer'
        ) {
          const resourceDef = resourceDefAttr.value.expression
          if (resourceDef.type === 'ObjectExpression') {
            const dataSourceIdProp = (resourceDef.properties as any[]).find(
              (p: any) => p.type === 'ObjectProperty' && p.key.value === 'dataSourceId'
            )
            const tableNameProp = (resourceDef.properties as any[]).find(
              (p: any) => p.type === 'ObjectProperty' && p.key.value === 'tableName'
            )
            const dataSourceTypeProp = (resourceDef.properties as any[]).find(
              (p: any) => p.type === 'ObjectProperty' && p.key.value === 'dataSourceType'
            )

            if (dataSourceIdProp && tableNameProp && dataSourceTypeProp) {
              const dataSourceId = dataSourceIdProp.value.value
              const tableName = tableNameProp.value.value
              const dataSourceType = dataSourceTypeProp.value.value
              const fileName = `${dataSourceType}-${tableName}-${dataSourceId.substring(0, 8)}`
              const setMaxPagesStateVar = (info as any).setMaxPagesStateVar

              // Create useEffect to refetch count when debounced search changes
              const skipCountFetchOnMountRefVar = (info as any).skipCountFetchOnMountRefVar
              const combinedStateVar = (info as any).combinedStateVar

              // Build URLSearchParams properties - query is always included, queryColumns is optional
              const urlSearchParamsProperties: any[] = [
                types.objectProperty(
                  types.identifier('query'),
                  types.memberExpression(
                    types.identifier(combinedStateVar),
                    types.identifier('debouncedQuery')
                  )
                ),
              ]

              // Add queryColumns only if they exist
              if (info.queryColumns && info.queryColumns.length > 0) {
                urlSearchParamsProperties.push(
                  types.objectProperty(
                    types.identifier('queryColumns'),
                    types.callExpression(
                      types.memberExpression(
                        types.identifier('JSON'),
                        types.identifier('stringify')
                      ),
                      [
                        types.arrayExpression(
                          info.queryColumns.map((col) => types.stringLiteral(col))
                        ),
                      ]
                    )
                  )
                )
              }

              const refetchCountEffect = types.expressionStatement(
                types.callExpression(types.identifier('useEffect'), [
                  types.arrowFunctionExpression(
                    [],
                    types.blockStatement([
                      types.ifStatement(
                        types.memberExpression(
                          types.identifier(skipCountFetchOnMountRefVar),
                          types.identifier('current')
                        ),
                        types.blockStatement([
                          types.expressionStatement(
                            types.assignmentExpression(
                              '=',
                              types.memberExpression(
                                types.identifier(skipCountFetchOnMountRefVar),
                                types.identifier('current')
                              ),
                              types.booleanLiteral(false)
                            )
                          ),
                          types.returnStatement(),
                        ])
                      ),
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
                                        types.objectExpression(urlSearchParamsProperties),
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
                                      types.callExpression(types.identifier(setMaxPagesStateVar), [
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
                                                types.numericLiteral(info.perPage)
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
                      ),
                    ])
                  ),
                  types.arrayExpression([
                    types.memberExpression(
                      types.identifier(combinedStateVar),
                      types.identifier('debouncedQuery')
                    ),
                  ]),
                ])
              )

              blockStatement.body.splice(insertIndex, 0, refetchCountEffect)
            }
          }
        }
      }
    })

    // For components, add useEffect to fetch count on mount
    if (isComponent) {
      if (!dependencies.useEffect) {
        dependencies.useEffect = {
          type: 'library',
          path: 'react',
          version: '',
          meta: {
            namedImport: true,
          },
        }
      }

      // Group paginationInfos by data source identifier to avoid duplicate fetches
      const dataSourceToInfos = new Map<
        string,
        Array<{ info: ArrayMapperPaginationInfo; detected: any; fileName: string }>
      >()

      paginationInfos.forEach((info) => {
        const detected = detectedPaginations.find(
          (d) => d.dataSourceIdentifier === info.dataSourceIdentifier
        )
        if (!detected) {
          return
        }

        const resourceDefAttr = detected.dataProviderJSX.openingElement.attributes.find(
          (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'resourceDefinition'
        )

        if (
          !resourceDefAttr ||
          !resourceDefAttr.value ||
          resourceDefAttr.value.type !== 'JSXExpressionContainer'
        ) {
          return
        }

        const resourceDef = resourceDefAttr.value.expression
        if (resourceDef.type !== 'ObjectExpression') {
          return
        }

        const dataSourceIdProp = (resourceDef.properties as any[]).find(
          (p: any) => p.type === 'ObjectProperty' && p.key.value === 'dataSourceId'
        )
        const tableNameProp = (resourceDef.properties as any[]).find(
          (p: any) => p.type === 'ObjectProperty' && p.key.value === 'tableName'
        )
        const dataSourceTypeProp = (resourceDef.properties as any[]).find(
          (p: any) => p.type === 'ObjectProperty' && p.key.value === 'dataSourceType'
        )

        if (!dataSourceIdProp || !tableNameProp || !dataSourceTypeProp) {
          return
        }

        const dataSourceId = dataSourceIdProp.value.value
        const tableName = tableNameProp.value.value
        const dataSourceType = dataSourceTypeProp.value.value
        const fileName = `${dataSourceType}-${tableName}-${dataSourceId.substring(0, 8)}`

        // Group by data source identifier
        if (!dataSourceToInfos.has(info.dataSourceIdentifier)) {
          dataSourceToInfos.set(info.dataSourceIdentifier, [])
        }
        dataSourceToInfos.get(info.dataSourceIdentifier)!.push({ info, detected, fileName })
      })

      // Create ONE useEffect per unique data source
      // Collect all useEffect statements first
      const componentUseEffects: types.Statement[] = []

      dataSourceToInfos.forEach((infos) => {
        const { fileName } = infos[0]

        // Create array of setState calls - one for each pagination using this data source
        const setStateStatements = infos.map(({ info }) => {
          const setMaxPagesStateVar = (info as any).setMaxPagesStateVar
          return types.expressionStatement(
            types.callExpression(types.identifier(setMaxPagesStateVar), [
              types.callExpression(
                types.memberExpression(types.identifier('Math'), types.identifier('ceil')),
                [
                  types.binaryExpression(
                    '/',
                    types.memberExpression(types.identifier('data'), types.identifier('count')),
                    types.numericLiteral(info.perPage)
                  ),
                ]
              ),
            ])
          )
        })

        // Create useEffect to fetch count on mount - sets ALL maxPages for this data source
        const useEffectAST = types.expressionStatement(
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
                              types.memberExpression(
                                types.identifier('data'),
                                types.identifier('count')
                              )
                            ),
                            types.blockStatement(setStateStatements)
                          ),
                        ])
                      ),
                    ]
                  )
                ),
              ])
            ),
            types.arrayExpression([]),
          ])
        )

        componentUseEffects.push(useEffectAST)
      })

      // Insert all component useEffect hooks after state declarations but before return
      // Find the first return statement
      const componentReturnIndex = blockStatement.body.findIndex(
        (stmt: any) => stmt.type === 'ReturnStatement'
      )
      const componentEffectsInsertIndex =
        componentReturnIndex !== -1 ? componentReturnIndex : blockStatement.body.length

      // Insert in reverse order to maintain correct order
      componentUseEffects.reverse().forEach((effect) => {
        blockStatement.body.splice(componentEffectsInsertIndex, 0, effect)
      })
    }

    createAPIRoutesForPaginatedDataSources(
      uidl.node,
      options.dataSources,
      componentChunk,
      options.extractedResources,
      paginationInfos,
      isComponent
    )

    detectedPaginations.forEach((detected, index) => {
      addPaginationParamsToDataProvider(detected.dataProviderJSX, paginationInfos[index], index)
    })

    modifyPaginationButtons(blockStatement, detectedPaginations, paginationInfos)
    modifySearchInputs(blockStatement, detectedPaginations, paginationInfos)

    if (isPage) {
      modifyGetStaticPropsForPagination(chunks, paginationInfos)
    }

    // Handle search-only array mappers (no need to filter - they're already separate)
    // The detection function already separated them into different arrays
    const searchOnlyDataSources = detectedSearchOnly

    if (searchOnlyDataSources.length > 0) {
      handleSearchOnlyArrayMappers(
        blockStatement,
        searchOnlyDataSources,
        searchConfigMap,
        queryColumnsMap,
        dependencies
      )

      // Create API routes for search-only data sources
      createAPIRoutesForSearchOnlyDataSources(
        uidl.node,
        options.dataSources,
        componentChunk,
        options.extractedResources,
        searchOnlyDataSources
      )
    }

    return structure
  }

  return paginationPlugin
}

function findParentNode(root: any, target: any, currentParent: any = null): any | null {
  if (!root || !target) {
    return null
  }

  if (root === target) {
    return currentParent
  }

  if (root.type === 'JSXElement' || root.type === 'JSXFragment') {
    if (root.children && Array.isArray(root.children)) {
      for (const child of root.children) {
        const found = findParentNode(child, target, root)
        if (found !== null) {
          return found
        }
      }
    }
  } else if (root.type === 'JSXExpressionContainer') {
    if (root.expression) {
      const found = findParentNode(root.expression, target, root)
      if (found !== null) {
        return found
      }
    }
  } else if (root.type === 'BlockStatement') {
    if (root.body && Array.isArray(root.body)) {
      for (const stmt of root.body) {
        const found = findParentNode(stmt, target, root)
        if (found !== null) {
          return found
        }
      }
    }
  } else if (root.type === 'ReturnStatement') {
    if (root.argument) {
      const found = findParentNode(root.argument, target, root)
      if (found !== null) {
        return found
      }
    }
  } else if (root.type === 'ConditionalExpression') {
    const foundConsequent = findParentNode(root.consequent, target, root)
    if (foundConsequent !== null) {
      return foundConsequent
    }
    const foundAlternate = findParentNode(root.alternate, target, root)
    if (foundAlternate !== null) {
      return foundAlternate
    }
  }

  return null
}

function detectPaginationsAndSearchFromJSX(
  blockStatement: types.BlockStatement,
  uidlNode: any
): {
  paginatedMappers: DetectedPagination[]
  searchOnlyMappers: DetectedPagination[]
  paginationOnlyMappers: DetectedPagination[]
  plainMappers: DetectedPagination[]
} {
  interface DataProviderInfo {
    identifier: string
    dataProvider: any
    arrayMapperRenderProp?: string
    paginationNode?: { class: string; prevClass: string | null; nextClass: string | null }
    searchInput?: { class: string | null; jsx: any }
    hasPagination: boolean
    hasSearch: boolean
  }

  const dataProviderList: DataProviderInfo[] = []

  // First pass: collect array mapper info from UIDL, keyed by array mapper render prop (unique)
  interface ArrayMapperInfo {
    dataSourceIdentifier: string
    renderProp: string
    paginated: boolean
    searchEnabled: boolean
  }
  const arrayMapperInfoMap = new Map<string, ArrayMapperInfo>()

  if (uidlNode) {
    const collectArrayMapperInfo = (node: any): void => {
      if (!node) {
        return
      }
      if (node.type === 'data-source-list' && node.content?.renderPropIdentifier) {
        const dataSourceIdentifier = node.content.renderPropIdentifier
        if (node.content.nodes?.success?.content?.children) {
          node.content.nodes.success.content.children.forEach((child: any) => {
            if (child.type === 'cms-list-repeater' && child.content?.renderPropIdentifier) {
              const arrayMapperRenderProp = child.content.renderPropIdentifier
              // Key by array mapper render prop (unique), not data source identifier
              arrayMapperInfoMap.set(arrayMapperRenderProp, {
                dataSourceIdentifier,
                renderProp: arrayMapperRenderProp,
                paginated: child.content.paginated || false,
                searchEnabled: child.content.searchEnabled || false,
              })
            }
          })
        }
      }
      if (node.content?.children) {
        node.content.children.forEach((child: any) => collectArrayMapperInfo(child))
      }
      if (node.children && Array.isArray(node.children)) {
        node.children.forEach((child: any) => collectArrayMapperInfo(child))
      }
    }
    collectArrayMapperInfo(uidlNode)
  }

  // Second pass: find all DataProviders and their parent containers
  interface DataProviderWithParent {
    dataProvider: any
    parent: any
  }
  const dataProvidersWithParents: DataProviderWithParent[] = []

  const findDataProvidersAndParents = (node: any, parent: any = null): void => {
    if (!node) {
      return
    }

    // Check if this is a DataProvider
    if (node.type === 'JSXElement' && node.openingElement?.name?.name === 'DataProvider') {
      dataProvidersWithParents.push({
        dataProvider: node,
        parent,
      })
    }

    // Only recurse through JSX structure, not into embedded expressions or code
    if (node.type === 'ReturnStatement' && node.argument) {
      findDataProvidersAndParents(node.argument, parent)
    } else if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
      // Recurse through JSX children
      if (node.children && Array.isArray(node.children)) {
        node.children.forEach((child: any) => findDataProvidersAndParents(child, node))
      }
    } else if (node.type === 'JSXExpressionContainer') {
      // For expression containers, continue but don't go into the expression itself
      if (
        node.expression &&
        (node.expression.type === 'JSXElement' || node.expression.type === 'JSXFragment')
      ) {
        findDataProvidersAndParents(node.expression, parent)
      }
    } else if (node.type === 'BlockStatement') {
      // For block statements (function bodies), look through body array
      if (node.body && Array.isArray(node.body)) {
        node.body.forEach((stmt: any) => findDataProvidersAndParents(stmt, node))
      }
    } else if (node.type === 'ConditionalExpression') {
      // Check both branches of conditional
      findDataProvidersAndParents(node.consequent, parent)
      findDataProvidersAndParents(node.alternate, parent)
    }
  }

  findDataProvidersAndParents(blockStatement)

  // Now process each DataProvider and find its siblings
  dataProvidersWithParents.forEach(({ dataProvider, parent }) => {
    const nameAttr = dataProvider.openingElement.attributes.find(
      (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'name'
    )

    // Find the array mapper render prop by looking inside renderSuccess -> Repeater -> renderItem param
    const renderSuccessAttr = dataProvider.openingElement.attributes.find(
      (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'renderSuccess'
    )

    let arrayMapperRenderProp: string | undefined
    if (renderSuccessAttr && renderSuccessAttr.value?.type === 'JSXExpressionContainer') {
      const renderFunc = renderSuccessAttr.value.expression
      if (renderFunc.type === 'ArrowFunctionExpression') {
        // Look for Repeater inside the render function
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
            for (const child of node.children) {
              const result = findRepeater(child)
              if (result) {
                return result
              }
            }
          }
          if (node.type === 'JSXFragment' || node.type === 'JSXElement') {
            if (node.children && Array.isArray(node.children)) {
              for (const child of node.children) {
                const result = findRepeater(child)
                if (result) {
                  return result
                }
              }
            }
          }
          if (node.type === 'JSXExpressionContainer') {
            return findRepeater(node.expression)
          }
          if (node.expression) {
            return findRepeater(node.expression)
          }
          if (node.consequent) {
            const result = findRepeater(node.consequent)
            if (result) {
              return result
            }
          }
          if (node.alternate) {
            return findRepeater(node.alternate)
          }
          return null
        }

        const repeater = findRepeater(renderFunc)
        if (repeater) {
          // Find renderItem attribute on Repeater
          const renderItemAttr = repeater.openingElement.attributes.find(
            (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'renderItem'
          )
          if (renderItemAttr && renderItemAttr.value?.type === 'JSXExpressionContainer') {
            const renderItemFunc = renderItemAttr.value.expression
            if (
              renderItemFunc.type === 'ArrowFunctionExpression' &&
              renderItemFunc.params &&
              renderItemFunc.params.length > 0
            ) {
              const param = renderItemFunc.params[0]
              if (param.type === 'Identifier') {
                arrayMapperRenderProp = param.name
              }
            }
          }
        }
      }
    }

    if (
      !nameAttr ||
      !nameAttr.value ||
      nameAttr.value.type !== 'JSXExpressionContainer' ||
      !arrayMapperRenderProp
    ) {
      return
    }

    const dataProviderIdentifier = nameAttr.value.expression.value
    let paginationNodeInfo: {
      class: string
      prevClass: string | null
      nextClass: string | null
    } | null = null
    let searchInputInfo: { class: string | null; jsx: any } | null = null

    const findSearchAndPaginationInScope = (scopeNode: any, skipNode: any = null): boolean => {
      if (!scopeNode || !scopeNode.children || !Array.isArray(scopeNode.children)) {
        return false
      }

      let foundSomething = false

      for (const child of scopeNode.children) {
        if (child === skipNode) {
          continue
        }

        if (child.type === 'JSXElement') {
          const childClassName = getClassName(child.openingElement?.attributes || [])
          const childElementName = child.openingElement?.name?.name

          // Found pagination node
          if (childClassName && childClassName.includes('cms-pagination-node')) {
            const prevClass = findChildWithClass(child, 'previous')
            const nextClass = findChildWithClass(child, 'next')
            if (prevClass || nextClass) {
              paginationNodeInfo = {
                class: childClassName,
                prevClass,
                nextClass,
              }
              foundSomething = true
            }
          }

          // Found search container - search for input inside it
          if (childClassName && childClassName.includes('data-source-search-node')) {
            if (child.children && Array.isArray(child.children)) {
              for (const searchChild of child.children) {
                if (searchChild.type === 'JSXElement') {
                  const searchChildElementName = searchChild.openingElement?.name?.name
                  const searchChildClassName = getClassName(
                    searchChild.openingElement?.attributes || []
                  )
                  if (
                    searchChildClassName &&
                    searchChildClassName.includes('search-input') &&
                    searchChildElementName === 'input'
                  ) {
                    searchInputInfo = {
                      class: searchChildClassName,
                      jsx: searchChild,
                    }
                    foundSomething = true
                  }
                }
              }
            }
          }

          // Also check if search input is a direct child
          if (
            childClassName &&
            childClassName.includes('search-input') &&
            childElementName === 'input'
          ) {
            searchInputInfo = {
              class: childClassName,
              jsx: child,
            }
            foundSomething = true
          }

          // Stop searching if we found both or if we found what we're looking for
          if (foundSomething && (searchInputInfo || paginationNodeInfo)) {
            return true
          }

          // Only recurse if we haven't found what we're looking for yet
          if (!searchInputInfo || !paginationNodeInfo) {
            if (findSearchAndPaginationInScope(child, skipNode)) {
              return true
            }
          }
        }
      }

      return foundSomething
    }

    let currentScope = parent
    let depth = 0
    const maxDepth = 5

    while (currentScope && (!searchInputInfo || !paginationNodeInfo) && depth < maxDepth) {
      const found = findSearchAndPaginationInScope(currentScope, depth === 0 ? dataProvider : null)
      // Stop searching up the tree if we found a pagination node at this level
      if (found && paginationNodeInfo) {
        break
      }
      currentScope = findParentNode(blockStatement, currentScope)
      depth++
    }

    // Record the DataProvider with its pagination/search info
    // Use array instead of Map to handle multiple DataProviders with same name
    dataProviderList.push({
      identifier: dataProviderIdentifier,
      dataProvider,
      arrayMapperRenderProp,
      paginationNode: paginationNodeInfo || undefined,
      searchInput: searchInputInfo || undefined,
      hasPagination: !!paginationNodeInfo,
      hasSearch: !!searchInputInfo,
    })
  })

  // Categorize data providers
  const paginatedMappers: DetectedPagination[] = []
  const searchOnlyMappers: DetectedPagination[] = []
  const paginationOnlyMappers: DetectedPagination[] = []
  const plainMappers: DetectedPagination[] = []

  dataProviderList.forEach((info) => {
    // Check UIDL flags for this array mapper
    const uidlInfo = info.arrayMapperRenderProp
      ? arrayMapperInfoMap.get(info.arrayMapperRenderProp)
      : null

    // Only process pagination/search if UIDL explicitly enables it
    const shouldHavePagination = uidlInfo?.paginated && info.hasPagination
    const shouldHaveSearch = uidlInfo?.searchEnabled && info.hasSearch

    if (shouldHavePagination && shouldHaveSearch) {
      // Pagination + Search
      paginatedMappers.push({
        paginationNodeClass: info.paginationNode!.class,
        prevButtonClass: info.paginationNode!.prevClass,
        nextButtonClass: info.paginationNode!.nextClass,
        dataSourceIdentifier: info.identifier,
        dataProviderJSX: info.dataProvider,
        arrayMapperRenderProp: info.arrayMapperRenderProp,
        searchInputClass: info.searchInput?.class,
        searchInputJSX: info.searchInput?.jsx,
      })
    } else if (shouldHavePagination && !shouldHaveSearch) {
      // Pagination only
      paginationOnlyMappers.push({
        paginationNodeClass: info.paginationNode!.class,
        prevButtonClass: info.paginationNode!.prevClass,
        nextButtonClass: info.paginationNode!.nextClass,
        dataSourceIdentifier: info.identifier,
        dataProviderJSX: info.dataProvider,
        arrayMapperRenderProp: info.arrayMapperRenderProp,
        searchInputClass: undefined,
        searchInputJSX: undefined,
      })
    } else if (!shouldHavePagination && shouldHaveSearch) {
      // Search only
      searchOnlyMappers.push({
        paginationNodeClass: '',
        prevButtonClass: null,
        nextButtonClass: null,
        dataSourceIdentifier: info.identifier,
        dataProviderJSX: info.dataProvider,
        arrayMapperRenderProp: info.arrayMapperRenderProp,
        searchInputClass: info.searchInput?.class,
        searchInputJSX: info.searchInput?.jsx,
      })
    } else {
      // Plain (no pagination, no search) - UIDL doesn't enable it or no controls found
      plainMappers.push({
        paginationNodeClass: '',
        prevButtonClass: null,
        nextButtonClass: null,
        dataSourceIdentifier: info.identifier,
        dataProviderJSX: info.dataProvider,
        arrayMapperRenderProp: info.arrayMapperRenderProp,
        searchInputClass: undefined,
        searchInputJSX: undefined,
      })
    }
  })

  return { paginatedMappers, searchOnlyMappers, paginationOnlyMappers, plainMappers }
}

function handleSearchOnlyArrayMappers(
  blockStatement: types.BlockStatement,
  searchOnlyDataSources: DetectedPagination[],
  searchConfigMap: Map<string, any>,
  queryColumnsMap: Map<string, string[]>,
  dependencies: any
): void {
  const searchOnlyStates: types.Statement[] = []
  const searchOnlyEffects: types.Statement[] = []

  searchOnlyDataSources.forEach((detected, index) => {
    const searchId = `search_${index}`
    const searchQueryVar = `${searchId}_query`
    const setSearchQueryVar = `set${
      searchQueryVar.charAt(0).toUpperCase() + searchQueryVar.slice(1)
    }`
    const debouncedSearchQueryVar = `debounced${
      searchQueryVar.charAt(0).toUpperCase() + searchQueryVar.slice(1)
    }`
    const setDebouncedSearchQueryVar = `set${
      debouncedSearchQueryVar.charAt(0).toUpperCase() + debouncedSearchQueryVar.slice(1)
    }`
    const skipDebounceOnMountRefVar = `skipDebounceOnMount${searchId}`

    const searchConfig = searchConfigMap.get(detected.dataSourceIdentifier)
    const searchDebounce = searchConfig?.searchDebounce || 300
    const queryColumns = queryColumnsMap.get(detected.dataSourceIdentifier)

    // Add skip ref
    const skipRefAST = types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier(skipDebounceOnMountRefVar),
        types.callExpression(types.identifier('useRef'), [types.booleanLiteral(true)])
      ),
    ])
    searchOnlyStates.push(skipRefAST)

    // Add debounced search state
    const debouncedSearchStateAST = types.variableDeclaration('const', [
      types.variableDeclarator(
        types.arrayPattern([
          types.identifier(debouncedSearchQueryVar),
          types.identifier(setDebouncedSearchQueryVar),
        ]),
        types.callExpression(types.identifier('useState'), [types.stringLiteral('')])
      ),
    ])
    searchOnlyStates.push(debouncedSearchStateAST)

    // Add search query state
    const searchStateAST = types.variableDeclaration('const', [
      types.variableDeclarator(
        types.arrayPattern([types.identifier(searchQueryVar), types.identifier(setSearchQueryVar)]),
        types.callExpression(types.identifier('useState'), [types.stringLiteral('')])
      ),
    ])
    searchOnlyStates.push(searchStateAST)

    // Add useEffect for debouncing
    if (!dependencies.useEffect) {
      dependencies.useEffect = {
        type: 'library',
        path: 'react',
        version: '',
        meta: {
          namedImport: true,
        },
      }
    }

    const debounceEffect = types.expressionStatement(
      types.callExpression(types.identifier('useEffect'), [
        types.arrowFunctionExpression(
          [],
          types.blockStatement([
            types.ifStatement(
              types.memberExpression(
                types.identifier(skipDebounceOnMountRefVar),
                types.identifier('current')
              ),
              types.blockStatement([
                types.expressionStatement(
                  types.assignmentExpression(
                    '=',
                    types.memberExpression(
                      types.identifier(skipDebounceOnMountRefVar),
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
                        types.callExpression(types.identifier(setDebouncedSearchQueryVar), [
                          types.identifier(searchQueryVar),
                        ])
                      ),
                    ])
                  ),
                  types.numericLiteral(searchDebounce),
                ])
              ),
            ]),
            types.returnStatement(
              types.arrowFunctionExpression(
                [],
                types.callExpression(types.identifier('clearTimeout'), [types.identifier('timer')])
              )
            ),
          ])
        ),
        types.arrayExpression([types.identifier(searchQueryVar)]),
      ])
    )
    searchOnlyEffects.push(debounceEffect)

    // Modify DataProvider to include search params (even without queryColumns)
    if (detected.dataProviderJSX) {
      addSearchParamsToDataProvider(detected.dataProviderJSX, {
        debouncedSearchQueryVar,
        queryColumns: queryColumns || [],
      })
    }

    // Modify search input
    if (detected.searchInputJSX) {
      addSearchInputHandlers(detected.searchInputJSX, {
        searchQueryVar,
        setSearchQueryVar,
        searchEnabled: true,
      } as any)
    }
  })

  // Add all state declarations at the beginning in correct order
  searchOnlyStates.reverse().forEach((stateDecl) => {
    blockStatement.body.unshift(stateDecl)
  })

  // Recalculate insertIndex after adding states (since unshift shifted everything)
  const newInsertIndex = blockStatement.body.findIndex(
    (stmt: any) => stmt.type === 'ReturnStatement'
  )
  const finalInsertIndex = newInsertIndex !== -1 ? newInsertIndex : blockStatement.body.length

  // Add all useEffect hooks before the return statement
  searchOnlyEffects.reverse().forEach((effect) => {
    blockStatement.body.splice(finalInsertIndex, 0, effect)
  })
}

function addSearchParamsToDataProvider(
  dataProviderJSX: any,
  config: { debouncedSearchQueryVar: string; queryColumns: string[] }
): void {
  if (!dataProviderJSX || !dataProviderJSX.openingElement) {
    return
  }

  const { debouncedSearchQueryVar, queryColumns } = config

  // 1. Update params to be wrapped in useMemo
  const existingParamsAttr = dataProviderJSX.openingElement.attributes.find(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'params'
  )

  if (existingParamsAttr && existingParamsAttr.value?.type === 'JSXExpressionContainer') {
    const paramsObj = existingParamsAttr.value.expression

    if (paramsObj.type === 'ObjectExpression') {
      // Add query to existing params properties
      paramsObj.properties.push(
        types.objectProperty(types.identifier('query'), types.identifier(debouncedSearchQueryVar))
      )

      // Add queryColumns only if they exist
      if (queryColumns.length > 0) {
        paramsObj.properties.push(
          types.objectProperty(
            types.identifier('queryColumns'),
            types.callExpression(
              types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
              [types.arrayExpression(queryColumns.map((col) => types.stringLiteral(col)))]
            )
          )
        )
      }

      // Wrap in useMemo with debouncedSearchQueryVar as dependency
      const memoizedParamsValue = types.callExpression(types.identifier('useMemo'), [
        types.arrowFunctionExpression([], paramsObj),
        types.arrayExpression([types.identifier(debouncedSearchQueryVar)]),
      ])

      existingParamsAttr.value.expression = memoizedParamsValue
    }
  }

  // 2. Update initialData to be conditional on empty search
  const existingInitialDataAttr = dataProviderJSX.openingElement.attributes.find(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'initialData'
  )

  if (existingInitialDataAttr && existingInitialDataAttr.value?.type === 'JSXExpressionContainer') {
    const currentInitialData = existingInitialDataAttr.value.expression

    // Make it conditional: only use initialData if search is empty
    existingInitialDataAttr.value.expression = types.conditionalExpression(
      types.unaryExpression('!', types.identifier(debouncedSearchQueryVar), true),
      currentInitialData,
      types.identifier('undefined')
    )
  }

  // 3. Update key to include search query
  const existingKeyAttr = dataProviderJSX.openingElement.attributes.find(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'key'
  )

  const keyExpression = types.templateLiteral(
    [
      types.templateElement({ raw: 'search-', cooked: 'search-' }),
      types.templateElement({ raw: '', cooked: '' }),
    ],
    [types.identifier(debouncedSearchQueryVar)]
  )

  const keyAttr = types.jsxAttribute(
    types.jsxIdentifier('key'),
    types.jsxExpressionContainer(keyExpression)
  )

  if (existingKeyAttr) {
    const index = dataProviderJSX.openingElement.attributes.indexOf(existingKeyAttr)
    dataProviderJSX.openingElement.attributes[index] = keyAttr
  } else {
    dataProviderJSX.openingElement.attributes.push(keyAttr)
  }
}

function addPaginationParamsToDataProvider(
  dataProviderJSX: any,
  info: ArrayMapperPaginationInfo,
  paginationIndex: number
): void {
  if (!dataProviderJSX || !dataProviderJSX.openingElement) {
    return
  }

  const combinedStateVar = (info as any).combinedStateVar

  let paramsProperties: any[]
  let dependencies: any[]

  if (info.searchEnabled && combinedStateVar) {
    // Use combined state for both page and query
    paramsProperties = [
      types.objectProperty(
        types.identifier('page'),
        types.memberExpression(types.identifier(combinedStateVar), types.identifier('page'))
      ),
      types.objectProperty(types.identifier('perPage'), types.numericLiteral(info.perPage)),
      types.objectProperty(
        types.identifier('query'),
        types.memberExpression(
          types.identifier(combinedStateVar),
          types.identifier('debouncedQuery')
        )
      ),
    ]

    if (info.queryColumns && info.queryColumns.length > 0) {
      paramsProperties.push(
        types.objectProperty(
          types.identifier('queryColumns'),
          types.callExpression(
            types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
            [types.arrayExpression(info.queryColumns.map((col) => types.stringLiteral(col)))]
          )
        )
      )
    }

    // Single dependency: the combined state object
    dependencies = [types.identifier(combinedStateVar)]
  } else {
    // Pagination only (no search)
    paramsProperties = [
      types.objectProperty(types.identifier('page'), types.identifier(info.pageStateVar)),
      types.objectProperty(types.identifier('perPage'), types.numericLiteral(info.perPage)),
    ]

    dependencies = [types.identifier(info.pageStateVar)]
  }

  // Wrap params in useMemo to prevent unnecessary refetches
  const memoizedParamsValue = types.callExpression(types.identifier('useMemo'), [
    types.arrowFunctionExpression([], types.objectExpression(paramsProperties)),
    types.arrayExpression(dependencies),
  ])

  const paramsAttr = types.jsxAttribute(
    types.jsxIdentifier('params'),
    types.jsxExpressionContainer(memoizedParamsValue)
  )

  const existingParamsAttr = dataProviderJSX.openingElement.attributes.find(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'params'
  )

  if (existingParamsAttr) {
    const index = dataProviderJSX.openingElement.attributes.indexOf(existingParamsAttr)
    dataProviderJSX.openingElement.attributes[index] = paramsAttr
  } else {
    dataProviderJSX.openingElement.attributes.push(paramsAttr)
  }

  const existingInitialDataAttr = dataProviderJSX.openingElement.attributes.find(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'initialData'
  )

  if (existingInitialDataAttr && existingInitialDataAttr.value) {
    // Update initialData to use the paginated prop name
    const paginatedPropName = `${info.dataSourceIdentifier}_pg_${paginationIndex}`

    // If search is enabled, use combined state; otherwise use page state
    let condition: any

    if (info.searchEnabled && combinedStateVar) {
      condition = types.logicalExpression(
        '&&',
        types.binaryExpression(
          '===',
          types.memberExpression(types.identifier(combinedStateVar), types.identifier('page')),
          types.numericLiteral(1)
        ),
        types.unaryExpression(
          '!',
          types.memberExpression(
            types.identifier(combinedStateVar),
            types.identifier('debouncedQuery')
          ),
          true
        )
      )
    } else {
      condition = types.binaryExpression(
        '===',
        types.identifier(info.pageStateVar),
        types.numericLiteral(1)
      )
    }

    existingInitialDataAttr.value.expression = types.conditionalExpression(
      condition,
      types.optionalMemberExpression(
        types.identifier('props'),
        types.identifier(paginatedPropName),
        false,
        true
      ),
      types.identifier('undefined')
    )
  }

  const existingKeyAttr = dataProviderJSX.openingElement.attributes.find(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'key'
  )

  // Include page and search in key to trigger refetch when they change
  let keyExpression: any
  if (info.searchEnabled && combinedStateVar) {
    keyExpression = types.templateLiteral(
      [
        types.templateElement({
          raw: `${info.dataSourceIdentifier}-page-`,
          cooked: `${info.dataSourceIdentifier}-page-`,
        }),
        types.templateElement({ raw: '-search-', cooked: '-search-' }),
        types.templateElement({ raw: '', cooked: '' }),
      ],
      [
        types.memberExpression(types.identifier(combinedStateVar), types.identifier('page')),
        types.memberExpression(
          types.identifier(combinedStateVar),
          types.identifier('debouncedQuery')
        ),
      ]
    )
  } else {
    keyExpression = types.templateLiteral(
      [
        types.templateElement({
          raw: `${info.dataSourceIdentifier}-`,
          cooked: `${info.dataSourceIdentifier}-`,
        }),
        types.templateElement({ raw: '', cooked: '' }),
      ],
      [types.identifier(info.pageStateVar)]
    )
  }

  const keyAttr = types.jsxAttribute(
    types.jsxIdentifier('key'),
    types.jsxExpressionContainer(keyExpression)
  )

  if (existingKeyAttr) {
    const index = dataProviderJSX.openingElement.attributes.indexOf(existingKeyAttr)
    dataProviderJSX.openingElement.attributes[index] = keyAttr
  } else {
    dataProviderJSX.openingElement.attributes.push(keyAttr)
  }

  // For pagination, always create a fresh fetchData that calls the API route
  // Get the resource definition to build the API URL
  const resourceDefAttr = dataProviderJSX.openingElement.attributes.find(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'resourceDefinition'
  )

  if (resourceDefAttr && resourceDefAttr.value?.type === 'JSXExpressionContainer') {
    const resourceDef = resourceDefAttr.value.expression
    if (resourceDef.type === 'ObjectExpression') {
      const dataSourceIdProp = (resourceDef.properties as any[]).find(
        (p: any) => p.type === 'ObjectProperty' && p.key.value === 'dataSourceId'
      )
      const tableNameProp = (resourceDef.properties as any[]).find(
        (p: any) => p.type === 'ObjectProperty' && p.key.value === 'tableName'
      )
      const dataSourceTypeProp = (resourceDef.properties as any[]).find(
        (p: any) => p.type === 'ObjectProperty' && p.key.value === 'dataSourceType'
      )

      if (dataSourceIdProp && tableNameProp && dataSourceTypeProp) {
        const dataSourceId = dataSourceIdProp.value.value
        const tableName = tableNameProp.value.value
        const dataSourceType = dataSourceTypeProp.value.value
        const fileName = `${dataSourceType}-${tableName}-${dataSourceId.substring(0, 8)}`

        // Create fetchData attribute with proper fetch chain wrapped in useCallback
        const fetchDataValue = types.callExpression(types.identifier('useCallback'), [
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

        const newFetchDataAttr = types.jsxAttribute(
          types.jsxIdentifier('fetchData'),
          types.jsxExpressionContainer(fetchDataValue)
        )

        // Remove existing fetchData attribute if present
        const existingFetchDataIndex = dataProviderJSX.openingElement.attributes.findIndex(
          (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'fetchData'
        )

        if (existingFetchDataIndex !== -1) {
          dataProviderJSX.openingElement.attributes[existingFetchDataIndex] = newFetchDataAttr
        } else {
          dataProviderJSX.openingElement.attributes.push(newFetchDataAttr)
        }
      }
    }
  }
}

function findChildWithClass(node: any, classSubstring: string): string | null {
  if (!node) {
    return null
  }

  if (node.type === 'JSXElement') {
    const className = getClassName(node.openingElement?.attributes || [])
    if (className && className.includes(classSubstring)) {
      return className
    }
  }

  if (node.children) {
    for (const child of node.children) {
      const found = findChildWithClass(child, classSubstring)
      if (found) {
        return found
      }
    }
  }

  if (typeof node === 'object') {
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = findChildWithClass(item, classSubstring)
          if (found) {
            return found
          }
        }
      } else if (typeof value === 'object') {
        const found = findChildWithClass(value, classSubstring)
        if (found) {
          return found
        }
      }
    }
  }

  return null
}

function modifyPaginationButtons(
  blockStatement: types.BlockStatement,
  detectedPaginations: DetectedPagination[],
  paginationInfos: ArrayMapperPaginationInfo[]
): void {
  const modifiedButtons = new Set<any>()

  const modifyNode = (node: any): void => {
    if (!node) {
      return
    }

    if (node.type === 'JSXElement') {
      const openingElement = node.openingElement
      if (openingElement && openingElement.name && openingElement.name.type === 'JSXIdentifier') {
        const className = getClassName(openingElement.attributes)

        if (className && !modifiedButtons.has(node)) {
          for (let index = 0; index < detectedPaginations.length; index++) {
            const detected = detectedPaginations[index]
            const info = paginationInfos[index]

            if (!info) {
              continue
            }

            if (className === detected.prevButtonClass) {
              convertToButton(node, info, 'prev')
              modifiedButtons.add(node)
              break
            } else if (className === detected.nextButtonClass) {
              convertToButton(node, info, 'next')
              modifiedButtons.add(node)
              break
            }
          }
        }
      }
    }

    if (typeof node === 'object') {
      Object.values(node).forEach((value) => {
        if (Array.isArray(value)) {
          value.forEach((item) => modifyNode(item))
        } else if (typeof value === 'object') {
          modifyNode(value)
        }
      })
    }
  }

  modifyNode(blockStatement)
}

function modifySearchInputs(
  blockStatement: types.BlockStatement,
  detectedPaginations: DetectedPagination[],
  paginationInfos: ArrayMapperPaginationInfo[]
): void {
  const modifiedInputs = new Set<any>()

  const modifyNode = (node: any): void => {
    if (!node) {
      return
    }

    if (node.type === 'JSXElement') {
      const openingElement = node.openingElement
      if (openingElement && openingElement.name && openingElement.name.type === 'JSXIdentifier') {
        const className = getClassName(openingElement.attributes)

        if (className && !modifiedInputs.has(node)) {
          for (let index = 0; index < detectedPaginations.length; index++) {
            const detected = detectedPaginations[index]
            const info = paginationInfos[index]

            if (!info || !info.searchEnabled) {
              continue
            }

            if (className === detected.searchInputClass) {
              addSearchInputHandlers(node, info)
              modifiedInputs.add(node)
              break
            }
          }
        }
      }
    }

    if (typeof node === 'object') {
      Object.values(node).forEach((value) => {
        if (Array.isArray(value)) {
          value.forEach((item) => modifyNode(item))
        } else if (typeof value === 'object') {
          modifyNode(value)
        }
      })
    }
  }

  modifyNode(blockStatement)
}

function addSearchInputHandlers(jsxElement: any, info: ArrayMapperPaginationInfo): void {
  if (!info.searchQueryVar || !info.setSearchQueryVar) {
    return
  }

  const openingElement = jsxElement.openingElement

  removeAttribute(openingElement.attributes, 'onChange')
  removeAttribute(openingElement.attributes, 'value')

  const onChangeHandler = types.arrowFunctionExpression(
    [types.identifier('e')],
    types.callExpression(types.identifier(info.setSearchQueryVar!), [
      types.memberExpression(
        types.memberExpression(types.identifier('e'), types.identifier('target')),
        types.identifier('value')
      ),
    ])
  )

  openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('onChange'),
      types.jsxExpressionContainer(onChangeHandler)
    )
  )

  openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('value'),
      types.jsxExpressionContainer(types.identifier(info.searchQueryVar!))
    )
  )
}

function convertToButton(
  jsxElement: any,
  info: ArrayMapperPaginationInfo,
  buttonType: 'prev' | 'next'
): void {
  const openingElement = jsxElement.openingElement

  if (openingElement.name.type === 'JSXIdentifier') {
    openingElement.name.name = 'button'
  }
  if (jsxElement.closingElement && jsxElement.closingElement.name.type === 'JSXIdentifier') {
    jsxElement.closingElement.name.name = 'button'
  }

  removeAttribute(openingElement.attributes, 'onClick')
  removeAttribute(openingElement.attributes, 'disabled')
  removeAttribute(openingElement.attributes, 'type')

  const combinedStateVar = (info as any).combinedStateVar
  const setCombinedStateVar = (info as any).setCombinedStateVar

  let onClickHandler: any
  if (info.searchEnabled && combinedStateVar && setCombinedStateVar) {
    // Use combined state: update only the page property
    onClickHandler =
      buttonType === 'prev'
        ? types.arrowFunctionExpression(
            [],
            types.callExpression(types.identifier(setCombinedStateVar), [
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
        : types.arrowFunctionExpression(
            [],
            types.callExpression(types.identifier(setCombinedStateVar), [
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
  } else {
    // Regular pagination (no search)
    onClickHandler =
      buttonType === 'prev'
        ? types.arrowFunctionExpression(
            [],
            types.callExpression(types.identifier(info.setPageStateVar), [
              types.arrowFunctionExpression(
                [types.identifier('p')],
                types.callExpression(
                  types.memberExpression(types.identifier('Math'), types.identifier('max')),
                  [
                    types.numericLiteral(1),
                    types.binaryExpression('-', types.identifier('p'), types.numericLiteral(1)),
                  ]
                )
              ),
            ])
          )
        : types.arrowFunctionExpression(
            [],
            types.callExpression(types.identifier(info.setPageStateVar), [
              types.arrowFunctionExpression(
                [types.identifier('p')],
                types.binaryExpression('+', types.identifier('p'), types.numericLiteral(1))
              ),
            ])
          )
  }

  openingElement.attributes.push(
    types.jsxAttribute(types.jsxIdentifier('onClick'), types.jsxExpressionContainer(onClickHandler))
  )
  openingElement.attributes.push(
    types.jsxAttribute(types.jsxIdentifier('type'), types.stringLiteral('button'))
  )

  // Add disabled attribute with simple page number checks
  const maxPagesStateVar = (info as any).maxPagesStateVar
  let disabledExpr: any

  if (info.searchEnabled && combinedStateVar) {
    disabledExpr =
      buttonType === 'prev'
        ? types.binaryExpression(
            '<=',
            types.memberExpression(types.identifier(combinedStateVar), types.identifier('page')),
            types.numericLiteral(1)
          )
        : types.binaryExpression(
            '>=',
            types.memberExpression(types.identifier(combinedStateVar), types.identifier('page')),
            types.identifier(maxPagesStateVar)
          )
  } else {
    disabledExpr =
      buttonType === 'prev'
        ? types.binaryExpression('<=', types.identifier(info.pageStateVar), types.numericLiteral(1))
        : types.binaryExpression(
            '>=',
            types.identifier(info.pageStateVar),
            types.identifier(maxPagesStateVar)
          )
  }

  openingElement.attributes.push(
    types.jsxAttribute(types.jsxIdentifier('disabled'), types.jsxExpressionContainer(disabledExpr))
  )
}

function getClassName(attributes: any[]): string | null {
  const classNameAttr = attributes.find(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'className'
  )
  if (classNameAttr && classNameAttr.value && classNameAttr.value.type === 'StringLiteral') {
    return classNameAttr.value.value
  }
  return null
}

function removeAttribute(attrs: any[], attributeName: string): void {
  const index = attrs.findIndex(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === attributeName
  )
  if (index !== -1) {
    attrs.splice(index, 1)
  }
}

function modifyGetStaticPropsForPagination(
  chunks: any[],
  paginationInfos: ArrayMapperPaginationInfo[]
): void {
  const getStaticPropsChunk = chunks.find((chunk) => chunk.name === 'getStaticProps')
  if (!getStaticPropsChunk || getStaticPropsChunk.type !== 'ast') {
    return
  }

  const exportDeclaration = getStaticPropsChunk.content as types.ExportNamedDeclaration
  if (!exportDeclaration || exportDeclaration.type !== 'ExportNamedDeclaration') {
    return
  }

  const functionDeclaration = exportDeclaration.declaration as types.FunctionDeclaration
  if (!functionDeclaration || functionDeclaration.type !== 'FunctionDeclaration') {
    return
  }

  // Find Promise.all and add NEW fetchData calls for each paginated DataProvider
  const functionBody = functionDeclaration.body.body
  const tryBlock = functionBody.find((stmt: any) => stmt.type === 'TryStatement') as
    | types.TryStatement
    | undefined

  if (!tryBlock) {
    return
  }

  const tryBody = tryBlock.block.body

  // Find the Promise.all statement
  const promiseAllStmt = tryBody.find(
    (stmt: any) =>
      stmt.type === 'VariableDeclaration' &&
      stmt.declarations?.[0]?.init?.type === 'AwaitExpression' &&
      stmt.declarations?.[0]?.init?.argument?.type === 'CallExpression' &&
      stmt.declarations?.[0]?.init?.argument?.callee?.type === 'MemberExpression' &&
      stmt.declarations?.[0]?.init?.argument?.callee?.property?.name === 'all'
  ) as types.VariableDeclaration | undefined

  if (!promiseAllStmt) {
    return
  }

  const awaitExpr = promiseAllStmt.declarations[0].init as types.AwaitExpression
  const promiseAllCall = awaitExpr.argument as types.CallExpression
  const promiseArray = promiseAllCall.arguments[0] as types.ArrayExpression
  const destructuringPattern = promiseAllStmt.declarations[0].id as types.ArrayPattern

  // Map import names to data source identifiers from existing fetchData calls
  // Also track which indices to remove (non-paginated calls that will be replaced)
  const importToDataSource = new Map<string, string>()
  const indicesToRemove: number[] = []

  promiseArray.elements.forEach((element: any, index: number) => {
    if (element && element.type === 'CallExpression') {
      let fetchCallExpr = element

      // If wrapped in .catch(), unwrap it
      if (
        element.callee?.type === 'MemberExpression' &&
        element.callee?.property?.name === 'catch' &&
        element.callee?.object?.type === 'CallExpression'
      ) {
        fetchCallExpr = element.callee.object
      }

      // Now find the .fetchData() call
      if (
        fetchCallExpr.callee?.type === 'MemberExpression' &&
        fetchCallExpr.callee?.property?.name === 'fetchData' &&
        fetchCallExpr.callee?.object?.type === 'Identifier'
      ) {
        const importName = fetchCallExpr.callee.object.name
        const dataSourceVar = (destructuringPattern.elements[index] as types.Identifier).name

        // Check if this fetchData call has page/perPage params
        const params = fetchCallExpr.arguments[0]
        const hasPageParam =
          params &&
          params.type === 'ObjectExpression' &&
          params.properties.some(
            (prop: any) =>
              prop.type === 'ObjectProperty' &&
              (prop.key.name === 'page' || prop.key.name === 'perPage')
          )

        // If this is a data source that will be paginated but this call has NO pagination params,
        // mark it for removal
        if (
          !hasPageParam &&
          paginationInfos.some((info) => info.dataSourceIdentifier === dataSourceVar)
        ) {
          indicesToRemove.push(index)
        }

        importToDataSource.set(importName, dataSourceVar)
      }
    }
  })

  // Remove non-paginated fetchData calls in reverse order to preserve indices
  indicesToRemove.reverse().forEach((index) => {
    // Get the prop name BEFORE removing it
    const propToRemove = (destructuringPattern.elements[index] as types.Identifier)?.name

    promiseArray.elements.splice(index, 1)
    destructuringPattern.elements.splice(index, 1)

    // Also remove from props in return statement
    if (propToRemove) {
      const foundReturnStmt = tryBody.find((stmt: any) => stmt.type === 'ReturnStatement') as
        | types.ReturnStatement
        | undefined

      if (foundReturnStmt && foundReturnStmt.argument?.type === 'ObjectExpression') {
        const propsProperty = (foundReturnStmt.argument as types.ObjectExpression).properties.find(
          (prop: any) =>
            prop.type === 'ObjectProperty' && (prop.key as types.Identifier).name === 'props'
        ) as types.ObjectProperty | undefined

        if (propsProperty && propsProperty.value.type === 'ObjectExpression') {
          const propsObject = propsProperty.value as types.ObjectExpression

          const propIndex = propsObject.properties.findIndex(
            (prop: any) =>
              prop.type === 'ObjectProperty' && (prop.key as types.Identifier).name === propToRemove
          )
          if (propIndex !== -1) {
            propsObject.properties.splice(propIndex, 1)
          }
        }
      }
    }
  })

  // Add NEW fetchData calls for each paginated DataProvider
  paginationInfos.forEach((info, index) => {
    // Try exact match first, then case-insensitive match
    let importName = Array.from(importToDataSource.entries()).find(
      ([_, dataSourceVar]) => dataSourceVar === info.dataSourceIdentifier
    )?.[0]

    if (!importName) {
      // Try case-insensitive match
      const normalizedIdentifier = info.dataSourceIdentifier.toLowerCase().replace(/[_-]/g, '')
      importName = Array.from(importToDataSource.entries()).find(
        ([_, dataSourceVar]) =>
          dataSourceVar.toLowerCase().replace(/[_-]/g, '') === normalizedIdentifier
      )?.[0]
    }

    if (importName) {
      const paginatedVarName = `${info.dataSourceIdentifier}_pg_${index}`

      const fetchParams = [
        types.objectProperty(types.identifier('page'), types.numericLiteral(1)),
        types.objectProperty(types.identifier('perPage'), types.numericLiteral(info.perPage)),
      ]

      // Add queryColumns if they exist
      if (info.queryColumns && info.queryColumns.length > 0) {
        fetchParams.push(
          types.objectProperty(
            types.identifier('queryColumns'),
            types.arrayExpression(info.queryColumns.map((col) => types.stringLiteral(col)))
          )
        )
      }

      // Create new fetchData call with pagination params
      const newFetchDataCall = types.callExpression(
        types.memberExpression(
          types.callExpression(
            types.memberExpression(types.identifier(importName), types.identifier('fetchData')),
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
                  types.memberExpression(types.identifier('console'), types.identifier('error')),
                  [
                    types.stringLiteral(`Error fetching ${paginatedVarName}:`),
                    types.identifier('error'),
                  ]
                )
              ),
              types.returnStatement(types.arrayExpression([])),
            ])
          ),
        ]
      )

      promiseArray.elements.push(newFetchDataCall)
      destructuringPattern.elements.push(types.identifier(paginatedVarName))
    }
  })

  // Add fetchCount calls for paginated data sources (deduplicated by data source)

  // Deduplicate by data source identifier
  const uniqueDataSources = new Set(paginationInfos.map((info) => info.dataSourceIdentifier))
  const addedCountFetches = new Set<string>()

  uniqueDataSources.forEach((dataSourceId) => {
    let importName = Array.from(importToDataSource.entries()).find(
      ([_, dataSourceVar]) => dataSourceVar === dataSourceId
    )?.[0]

    if (!importName) {
      // Try case-insensitive match
      const normalizedIdentifier = dataSourceId.toLowerCase().replace(/[_-]/g, '')
      importName = Array.from(importToDataSource.entries()).find(
        ([_, dataSourceVar]) =>
          dataSourceVar.toLowerCase().replace(/[_-]/g, '') === normalizedIdentifier
      )?.[0]
    }

    if (importName && !addedCountFetches.has(dataSourceId)) {
      const fetchCountCall = types.callExpression(
        types.memberExpression(types.identifier(importName), types.identifier('fetchCount')),
        []
      )
      promiseArray.elements.push(fetchCountCall)
      destructuringPattern.elements.push(types.identifier(`${dataSourceId}_count`))
      addedCountFetches.add(dataSourceId)
    }
  })

  // Calculate and add maxPages before return
  const returnStmt = tryBody.find((stmt: any) => stmt.type === 'ReturnStatement') as
    | types.ReturnStatement
    | undefined

  if (returnStmt && returnStmt.argument?.type === 'ObjectExpression') {
    const propsProperty = (returnStmt.argument as types.ObjectExpression).properties.find(
      (prop: any) =>
        prop.type === 'ObjectProperty' && (prop.key as types.Identifier).name === 'props'
    ) as types.ObjectProperty | undefined

    if (propsProperty && propsProperty.value.type === 'ObjectExpression') {
      const propsObject = propsProperty.value as types.ObjectExpression
      const returnIndex = tryBody.indexOf(returnStmt)

      paginationInfos.forEach((info, index) => {
        const paginatedVarName = `${info.dataSourceIdentifier}_pg_${index}`
        const countVarName = `${info.dataSourceIdentifier}_count`
        const maxPagesVarName = `${info.dataSourceIdentifier}_pg_${index}_maxPages`

        const maxPagesCalc = types.variableDeclaration('const', [
          types.variableDeclarator(
            types.identifier(maxPagesVarName),
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
                  types.numericLiteral(info.perPage)
                ),
              ]
            )
          ),
        ])

        tryBody.splice(returnIndex, 0, maxPagesCalc)

        // Add both the paginated data and maxPages to props
        propsObject.properties.push(
          types.objectProperty(
            types.identifier(paginatedVarName),
            types.identifier(paginatedVarName)
          )
        )
        propsObject.properties.push(
          types.objectProperty(types.identifier(maxPagesVarName), types.identifier(maxPagesVarName))
        )
      })
    }
  }
}

function createAPIRoutesForPaginatedDataSources(
  uidlNode: any,
  dataSources: any,
  componentChunk: any,
  extractedResources: any,
  paginationInfos: ArrayMapperPaginationInfo[],
  isComponent: boolean
): void {
  const paginatedDataSourceIds = new Set(paginationInfos.map((info) => info.dataSourceIdentifier))

  const searchEnabledDataSources = new Set(
    paginationInfos.filter((info) => info.searchEnabled).map((info) => info.dataSourceIdentifier)
  )

  const createdCountRoutes = new Set<string>()

  const traverseForDataSources = (node: any): void => {
    if (!node) {
      return
    }

    if (node.type === 'data-source-list' || node.type === 'data-source-item') {
      const renderProp = node.content.renderPropIdentifier

      if (renderProp && paginatedDataSourceIds.has(renderProp)) {
        extractDataSourceIntoNextAPIFolder(node, dataSources, componentChunk, extractedResources)

        const hasSearch = searchEnabledDataSources.has(renderProp)
        const needsCountRoute = isComponent || hasSearch

        if (needsCountRoute) {
          const resourceDef = node.content.resourceDefinition
          if (resourceDef) {
            const dataSourceId = resourceDef.dataSourceId
            const tableName = resourceDef.tableName
            const dataSourceType = resourceDef.dataSourceType
            const fileName = `${dataSourceType}-${tableName}-${dataSourceId.substring(0, 8)}`
            const countFileName = `${fileName}-count`

            if (!createdCountRoutes.has(countFileName)) {
              extractedResources[`api/${countFileName}`] = {
                fileName: countFileName,
                fileType: FileType.JS,
                path: ['pages', 'api'],
                content: `import dataSource from '../../utils/data-sources/${fileName}'

export default dataSource.getCount
`,
              }
              createdCountRoutes.add(countFileName)
            }
          }
        }
      }
    }

    if (node.content?.children) {
      node.content.children.forEach((child: any) => traverseForDataSources(child))
    }
  }

  traverseForDataSources(uidlNode)
}

function createAPIRoutesForSearchOnlyDataSources(
  uidlNode: any,
  dataSources: any,
  componentChunk: any,
  extractedResources: any,
  searchOnlyDataSources: DetectedPagination[]
): void {
  const searchOnlyDataSourceIds = new Set(
    searchOnlyDataSources.map((info) => info.dataSourceIdentifier)
  )

  const traverseForDataSources = (node: any): void => {
    if (!node) {
      return
    }

    if (node.type === 'data-source-list' || node.type === 'data-source-item') {
      const renderProp = node.content.renderPropIdentifier

      if (renderProp && searchOnlyDataSourceIds.has(renderProp)) {
        extractDataSourceIntoNextAPIFolder(node, dataSources, componentChunk, extractedResources)
      }
    }

    if (node.content?.children) {
      node.content.children.forEach((child: any) => traverseForDataSources(child))
    }
  }

  traverseForDataSources(uidlNode)
}

export default createNextArrayMapperPaginationPlugin()
