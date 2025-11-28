import {
  UIDLDataSourceItemNode,
  UIDLDataSourceListNode,
  ChunkDefinition,
  GeneratorOptions,
  FileType,
  UIDLDataSource,
  DataSourceType,
  ChunkType,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { StringUtils } from '@teleporthq/teleport-shared'
import { generateDataSourceFetcherWithCore } from './data-source-fetchers'

const VALID_DATA_SOURCE_TYPES: DataSourceType[] = [
  'rest-api',
  'postgresql',
  'mysql',
  'mariadb',
  'amazon-redshift',
  'mongodb',
  'cockroachdb',
  'tidb',
  'redis',
  'firestore',
  'clickhouse',
  'airtable',
  'supabase',
  'turso',
  'javascript',
  'google-sheets',
  'csv-file',
  'static-collection',
]

export const sanitizeFileName = (input: string): string => {
  if (!input || typeof input !== 'string') {
    return 'unknown'
  }

  return (
    input
      // Remove path traversal attempts
      .replace(/\.\./g, '')
      .replace(/[\/\\]/g, '-')
      // Remove invalid filename characters
      .replace(/[<>:"|?*\x00-\x1F]/g, '')
      // Replace spaces with dashes
      .replace(/\s+/g, '-')
      // Remove leading/trailing dashes and dots
      .replace(/^[-_.]+|[-_.]+$/g, '')
      // Limit length to prevent filesystem issues
      .substring(0, 200) || 'unknown'
  )
}

export const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.trim().length > 0
}

export const hoistLoadingFromRepeater = (dataSourceNode: any): void => {
  if (!dataSourceNode || !dataSourceNode.content) {
    return
  }

  const children = dataSourceNode.children || []

  for (const child of children) {
    if (child.type === 'cms-list-repeater' && child.content?.nodes?.loading) {
      if (!dataSourceNode.content.nodes) {
        dataSourceNode.content.nodes = {}
      }

      if (
        !dataSourceNode.content.nodes.loading &&
        child.content.nodes.loading.content?.children?.length > 0
      ) {
        dataSourceNode.content.nodes.loading = child.content.nodes.loading
      }

      break
    }
  }

  if (dataSourceNode.content.nodes?.success?.content?.children) {
    for (const child of dataSourceNode.content.nodes.success.content.children) {
      if (child.type === 'cms-list-repeater' && child.content?.nodes?.loading) {
        if (
          !dataSourceNode.content.nodes.loading &&
          child.content.nodes.loading.content?.children?.length > 0
        ) {
          dataSourceNode.content.nodes.loading = child.content.nodes.loading
        }

        break
      }
    }
  }
}

// tslint:disable-next-line:no-any
export const validateResourceDefinition = (
  resourceDefinition: any
): {
  isValid: boolean
  error?: string
} => {
  if (!resourceDefinition || typeof resourceDefinition !== 'object') {
    return { isValid: false, error: 'Resource definition is missing or invalid' }
  }

  const { dataSourceId, tableName, dataSourceType } = resourceDefinition

  if (!isNonEmptyString(dataSourceId)) {
    return { isValid: false, error: 'Data source ID is missing or invalid' }
  }

  if (!isNonEmptyString(dataSourceType)) {
    return { isValid: false, error: 'Data source type is missing or invalid' }
  }

  if (!VALID_DATA_SOURCE_TYPES.includes(dataSourceType as DataSourceType)) {
    return { isValid: false, error: `Invalid data source type: ${dataSourceType}` }
  }

  // tableName is optional for some data sources (like REST API, JavaScript, etc.)
  if (tableName !== undefined && !isNonEmptyString(tableName)) {
    return { isValid: false, error: 'Table name must be a non-empty string when provided' }
  }

  return { isValid: true }
}

// tslint:disable-next-line:no-any
export const validateNodeContent = (content: any): { isValid: boolean; error?: string } => {
  if (!content || typeof content !== 'object') {
    return { isValid: false, error: 'Node content is missing or invalid' }
  }

  if (!content.resourceDefinition) {
    return { isValid: false, error: 'Resource definition is missing from node content' }
  }

  // key is optional - we can generate one from the resource definition if missing

  return { isValid: true }
}

export const validateDataSourceConfig = (
  dataSource: UIDLDataSource
): { isValid: boolean; error?: string } => {
  if (!dataSource || typeof dataSource !== 'object') {
    return { isValid: false, error: 'Data source is missing or invalid' }
  }

  if (!isNonEmptyString(dataSource.id)) {
    return { isValid: false, error: 'Data source ID is missing' }
  }

  if (!isNonEmptyString(dataSource.type)) {
    return { isValid: false, error: 'Data source type is missing' }
  }

  if (!dataSource.config || typeof dataSource.config !== 'object') {
    return { isValid: false, error: 'Data source config is missing or invalid' }
  }

  return { isValid: true }
}

export const generateSafeFileName = (
  dataSourceType: string,
  tableName: string,
  dataSourceId: string
): string => {
  const sanitizedType = sanitizeFileName(dataSourceType)
  const sanitizedTable = sanitizeFileName(tableName || 'data')
  const sanitizedId = sanitizeFileName(dataSourceId)

  // Create a unique identifier using parts of the dataSourceId
  const shortId = sanitizedId.substring(0, 8)

  const baseName = `${sanitizedType}-${sanitizedTable}-${shortId}`
  return StringUtils.camelCaseToDashCase(baseName)
}

export const extractDataSourceIntoNextAPIFolder = (
  node: UIDLDataSourceItemNode | UIDLDataSourceListNode,
  dataSources: Record<string, UIDLDataSource>,
  componentChunk: ChunkDefinition,
  extractedResources: GeneratorOptions['extractedResources']
) => {
  try {
    // Validate node content structure
    const contentValidation = validateNodeContent(node.content)
    if (!contentValidation.isValid) {
      return
    }

    const { resourceDefinition } = node.content

    // Validate resource definition
    const resourceValidation = validateResourceDefinition(resourceDefinition)
    if (!resourceValidation.isValid) {
      return
    }

    const { dataSourceId, tableName, dataSourceType } = resourceDefinition

    // Check if dataSources object exists
    if (!dataSources || typeof dataSources !== 'object') {
      return
    }

    // Check if data source exists
    const dataSource = dataSources[dataSourceId]
    if (!dataSource) {
      return
    }

    // Validate data source configuration
    const configValidation = validateDataSourceConfig(dataSource)
    if (!configValidation.isValid) {
      return
    }

    // Check if component chunk has meta and nodesLookup
    if (!componentChunk.meta || !componentChunk.meta.nodesLookup) {
      return
    }

    // Generate safe file name
    const fileName = generateSafeFileName(dataSourceType, tableName || 'data', dataSourceId)

    // Check if file name is valid
    if (!fileName || fileName === 'unknown') {
      return
    }

    // Find JSX node by searching through nodesLookup
    // The JSX generator creates keys like: ds-{dataSourceId}-{timestamp}
    // We need to find the node that matches our resourceDefinition
    // IMPORTANT: Match by both dataSourceId AND renderPropIdentifier to handle multiple DataProviders with same data source
    let jsxNode: types.JSXElement | null = null
    const targetRenderProp = node.content?.renderPropIdentifier

    // tslint:disable-next-line:no-any
    for (const jsxElement of Object.values(componentChunk.meta.nodesLookup)) {
      // tslint:disable-next-line:no-any
      if ((jsxElement as any).type === 'JSXElement') {
        const attrs = (jsxElement as types.JSXElement).openingElement.attributes

        // Look for resourceDefinition attribute
        // tslint:disable-next-line:no-any
        const resourceDefAttr = attrs.find(
          (attr) =>
            (attr as any).type === 'JSXAttribute' &&
            (attr as types.JSXAttribute).name.name === 'resourceDefinition'
        ) as types.JSXAttribute | undefined

        // Look for name attribute to match with renderPropIdentifier
        // tslint:disable-next-line:no-any
        const nameAttr = attrs.find(
          (attr) =>
            (attr as any).type === 'JSXAttribute' &&
            (attr as types.JSXAttribute).name.name === 'name'
        ) as types.JSXAttribute | undefined

        if (
          resourceDefAttr &&
          resourceDefAttr.value &&
          resourceDefAttr.value.type === 'JSXExpressionContainer'
        ) {
          const expr = resourceDefAttr.value.expression
          if (expr.type === 'ObjectExpression') {
            // Check if this matches our resourceDefinition
            const props = expr.properties as types.ObjectProperty[]
            // tslint:disable-next-line:no-any
            const idProp = props.find((p: any) => p.key?.value === 'dataSourceId')
            // tslint:disable-next-line:no-any
            const idValue = (idProp as any)?.value?.value

            // Match by dataSourceId
            const dataSourceMatches = idValue === dataSourceId

            // Also check name prop matches renderPropIdentifier
            let renderPropMatches = !targetRenderProp // If no targetRenderProp, don't check it

            if (targetRenderProp && nameAttr && nameAttr.value) {
              // The name attribute value is usually a StringLiteral or JSXExpressionContainer
              if (nameAttr.value.type === 'StringLiteral') {
                if (nameAttr.value.value === targetRenderProp) {
                  renderPropMatches = true
                }
              } else if (nameAttr.value.type === 'JSXExpressionContainer') {
                const nameExpr = nameAttr.value.expression
                if (nameExpr.type === 'StringLiteral' && nameExpr.value === targetRenderProp) {
                  renderPropMatches = true
                }
              }
            }

            // Before matching, check if this node already has fetchData - if so, skip it
            // This is crucial for handling multiple DataProviders with same dataSourceId and name
            const alreadyHasFetchData = attrs.some(
              (attr) => (attr as types.JSXAttribute).name?.name === 'fetchData'
            )

            if (dataSourceMatches && renderPropMatches && !alreadyHasFetchData) {
              jsxNode = jsxElement as types.JSXElement
              break
            } else if (dataSourceMatches && renderPropMatches && alreadyHasFetchData) {
              // Continue searching for the next matching node without fetchData
            }
          }
        }
      }
    }

    if (!jsxNode || jsxNode.type !== 'JSXElement') {
      return
    }

    // Ensure opening element and attributes exist
    if (!jsxNode.openingElement || !Array.isArray(jsxNode.openingElement.attributes)) {
      return
    }

    // Check if this node has already been processed (has fetchData attribute)
    const existingFetchData = jsxNode.openingElement.attributes.find(
      (attr) => (attr as types.JSXAttribute).name?.name === 'fetchData'
    )

    if (existingFetchData) {
      return
    }

    // Check if there are resource params
    const resourceParams = node.content.resource?.params || {}
    const hasParams = Object.keys(resourceParams).length > 0

    // Build resource path - use template literal if params exist
    let resourcePath: types.StringLiteral | types.TemplateLiteral
    if (hasParams) {
      resourcePath = types.templateLiteral(
        [
          types.templateElement({ raw: `/api/${fileName}?`, cooked: `/api/${fileName}?` }),
          types.templateElement({ raw: '', cooked: '' }),
        ],
        [types.newExpression(types.identifier('URLSearchParams'), [types.identifier('params')])]
      )
    } else {
      resourcePath = types.stringLiteral(`/api/${fileName}`)
    }

    const fetchAST = types.callExpression(
      types.memberExpression(
        types.callExpression(types.identifier('fetch'), [
          resourcePath,
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
    )

    const dataExpression = ASTUtils.generateMemberExpressionASTFromPath([
      'response',
      'data',
    ]) as types.OptionalMemberExpression

    // If there are params, the arrow function should accept params
    const resourceAST = types.arrowFunctionExpression(
      hasParams ? [types.identifier('params')] : [],
      types.callExpression(types.memberExpression(fetchAST, types.identifier('then'), false), [
        types.arrowFunctionExpression([types.identifier('response')], dataExpression),
      ])
    )

    jsxNode.openingElement.attributes.unshift(
      types.jSXAttribute(
        types.jsxIdentifier('fetchData'),
        types.jsxExpressionContainer(resourceAST)
      )
    )

    const hasPersistDataAttr = jsxNode.openingElement.attributes.some(
      (attr) =>
        attr.type === 'JSXAttribute' &&
        (attr as types.JSXAttribute).name?.name === 'persistDataDuringLoading'
    )

    if (!hasPersistDataAttr) {
      jsxNode.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('persistDataDuringLoading'),
          types.jsxExpressionContainer(types.booleanLiteral(true))
        )
      )
    }

    // Ensure extracted resources object exists
    if (!extractedResources || typeof extractedResources !== 'object') {
      return
    }

    // Check if a utils file already exists for this data source (from getStaticProps)
    // If so, create an API route that re-exports handler from it to avoid code duplication
    if (extractedResources[`utils/${fileName}`]) {
      const apiRouteCode = `import dataSourceModule from '../../utils/data-sources/${fileName}'

export default dataSourceModule.handler
`

      extractedResources[`api/${fileName}`] = {
        fileName,
        fileType: FileType.JS,
        path: ['pages', 'api'],
        content: apiRouteCode,
      }
      return
    }

    // Generate fetcher code with BOTH fetchData and handler
    let fetcherCode: string
    try {
      fetcherCode = generateDataSourceFetcherWithCore(dataSource, tableName || '')
    } catch (error) {
      return
    }

    extractedResources[`api/${fileName}`] = {
      fileName,
      fileType: FileType.JS,
      path: ['pages', 'api'],
      content: fetcherCode,
    }
  } catch (error) {
    // Catch any unexpected errors to prevent plugin from crashing
  }
}

export const isEmbeddedDataSource = (dataSourceType: string): boolean => {
  return ['javascript', 'csv-file', 'static-collection'].includes(dataSourceType)
}

export const replaceSecretReference = (
  value: unknown,
  options: { templateLiteral?: boolean } = {}
): string => {
  const { templateLiteral = false } = options
  // Handle null and undefined
  if (value === null) {
    return 'null'
  }

  if (value === undefined) {
    return 'undefined'
  }

  // Handle non-string values
  if (typeof value !== 'string') {
    try {
      return JSON.stringify(value)
    } catch (error) {
      // Handle circular references or non-serializable values
      return 'null'
    }
  }

  // Check if it's a secret reference
  if (value.startsWith('teleporthq.secrets.')) {
    const envVar = value.replace('teleporthq.secrets.', '')

    // Validate environment variable name
    // Must be alphanumeric, underscores, and start with letter or underscore
    if (/^[A-Z_][A-Z0-9_]*$/i.test(envVar)) {
      return templateLiteral ? `\${process.env.${envVar}}` : `process.env.${envVar}`
    } else {
      // Invalid env var name, use as regular string
      return JSON.stringify(value)
    }
  }

  // Regular string value
  try {
    return JSON.stringify(value)
  } catch (error) {
    // Fallback for any serialization issues
    return '""'
  }
}

export const sanitizeNumericParam = (value: unknown, defaultValue: number = 0): number => {
  if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
    return Math.max(0, Math.floor(value))
  }

  if (typeof value === 'string') {
    const parsed = parseInt(value, 10)
    if (!isNaN(parsed) && isFinite(parsed)) {
      return Math.max(0, parsed)
    }
  }

  return defaultValue
}

export const sanitizePort = (port: unknown, defaultPort: number): number => {
  const sanitized = sanitizeNumericParam(port, defaultPort)
  // Ensure port is in valid range (1-65535)
  if (sanitized < 1 || sanitized > 65535) {
    return defaultPort
  }
  return sanitized
}

export const isValidUrl = (url: unknown): boolean => {
  if (typeof url !== 'string' || !url) {
    return false
  }

  try {
    const parsed = new URL(url)
    // Check for valid protocols
    return ['http:', 'https:', 'mongodb:', 'redis:', 'postgresql:', 'mysql:'].includes(
      parsed.protocol
    )
  } catch {
    return false
  }
}

export const sanitizeIdentifier = (identifier: unknown): string => {
  if (typeof identifier !== 'string' || !identifier) {
    return ''
  }

  // Remove dangerous characters, only allow safe ones
  return identifier.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 64)
}

// tslint:disable-next-line:no-any
export const extractDataSourceIntoGetStaticProps = (
  node: UIDLDataSourceItemNode | UIDLDataSourceListNode,
  dataSources: Record<string, UIDLDataSource>,
  componentChunk: ChunkDefinition,
  getStaticPropsChunk: any,
  chunks: any[],
  extractedResources: GeneratorOptions['extractedResources'],
  dependencies: Record<string, any>
): { success: boolean; chunk?: any } => {
  try {
    // Validate node content
    const contentValidation = validateNodeContent(node.content)
    if (!contentValidation.isValid) {
      return { success: false }
    }

    const { resourceDefinition } = node.content
    const resourceValidation = validateResourceDefinition(resourceDefinition)
    if (!resourceValidation.isValid) {
      return { success: false }
    }

    const { dataSourceId, tableName, dataSourceType } = resourceDefinition

    if (!dataSources || typeof dataSources !== 'object') {
      return { success: false }
    }

    const dataSource = dataSources[dataSourceId]
    if (!dataSource) {
      return { success: false }
    }

    const configValidation = validateDataSourceConfig(dataSource)
    if (!configValidation.isValid) {
      return { success: false }
    }

    if (!componentChunk.meta || !componentChunk.meta.nodesLookup) {
      return { success: false }
    }

    // Generate prop key first
    const sanitizedDsName = StringUtils.dashCaseToCamelCase(
      sanitizeFileName(dataSource.name || dataSourceId)
    )
    const sanitizedTableName = StringUtils.dashCaseToCamelCase(
      sanitizeFileName(tableName || 'data')
    )
    const propKey = `${sanitizedDsName}_${sanitizedTableName}_data`

    // Find ALL JSX nodes matching this dataSourceId AND tableName and add initialData to ALL of them
    const matchingJsxNodes: types.JSXElement[] = []

    // Helper function to recursively traverse the AST and find all matching JSXElements
    const traverseAST = (astNode: any) => {
      if (!astNode || typeof astNode !== 'object') {
        return
      }

      if (astNode.type === 'JSXElement') {
        const jsxElement = astNode as types.JSXElement
        const attrs = jsxElement.openingElement.attributes

        const resourceDefAttr = attrs.find(
          (attr) =>
            (attr as any).type === 'JSXAttribute' &&
            (attr as types.JSXAttribute).name.name === 'resourceDefinition'
        ) as types.JSXAttribute | undefined

        if (
          resourceDefAttr &&
          resourceDefAttr.value &&
          resourceDefAttr.value.type === 'JSXExpressionContainer'
        ) {
          const expr = resourceDefAttr.value.expression
          if (expr.type === 'ObjectExpression') {
            const props = expr.properties as types.ObjectProperty[]
            // tslint:disable-next-line:no-any
            const idProp = props.find((p: any) => p.key?.value === 'dataSourceId')
            // tslint:disable-next-line:no-any
            const idValue = (idProp as any)?.value?.value

            // Also check tableName to ensure we're matching the right data source
            // tslint:disable-next-line:no-any
            const tableNameProp = props.find((p: any) => p.key?.value === 'tableName')
            // tslint:disable-next-line:no-any
            const tableNameValue = (tableNameProp as any)?.value?.value

            if (idValue === dataSourceId && tableNameValue === tableName) {
              matchingJsxNodes.push(jsxElement)
            }
          }
        }
      }

      // Recursively traverse all properties
      for (const key in astNode) {
        if (astNode.hasOwnProperty(key)) {
          const value = astNode[key]
          if (Array.isArray(value)) {
            value.forEach((item) => traverseAST(item))
          } else if (typeof value === 'object') {
            traverseAST(value)
          }
        }
      }
    }

    // Traverse the entire component AST content
    traverseAST(componentChunk.content)

    if (matchingJsxNodes.length === 0) {
      return { success: false }
    }

    // Update ALL matching JSX nodes with initialData
    for (const jsxNode of matchingJsxNodes) {
      // For SSR/SSG with initialData, rename 'children' to 'renderSuccess'
      const childrenAttrIndex = jsxNode.openingElement.attributes.findIndex(
        (attr) => (attr as types.JSXAttribute).name?.name === 'children'
      )

      if (childrenAttrIndex !== -1) {
        const childrenAttr = jsxNode.openingElement.attributes[
          childrenAttrIndex
        ] as types.JSXAttribute
        const renderSuccessAttr = types.jsxAttribute(
          types.jsxIdentifier('renderSuccess'),
          childrenAttr.value
        )
        jsxNode.openingElement.attributes[childrenAttrIndex] = renderSuccessAttr
      }

      // Remove existing initialData and persistDataDuringLoading attributes to avoid duplicates
      jsxNode.openingElement.attributes = jsxNode.openingElement.attributes.filter(
        (attr) =>
          (attr as types.JSXAttribute).name?.name !== 'initialData' &&
          (attr as types.JSXAttribute).name?.name !== 'persistDataDuringLoading'
      )

      // Add initialData attribute
      const initialDataAttr = types.jsxAttribute(
        types.jsxIdentifier('initialData'),
        types.jsxExpressionContainer(
          types.memberExpression(types.identifier('props'), types.identifier(propKey))
        )
      )
      jsxNode.openingElement.attributes.push(initialDataAttr)

      // Add persistDataDuringLoading={true}
      const persistDataAttr = types.jsxAttribute(
        types.jsxIdentifier('persistDataDuringLoading'),
        types.jsxExpressionContainer(types.booleanLiteral(true))
      )
      jsxNode.openingElement.attributes.push(persistDataAttr)
    }

    // Generate safe file name for the fetcher
    const fileName = generateSafeFileName(dataSourceType, tableName || 'data', dataSourceId)

    if (!fileName || fileName === 'unknown') {
      return { success: false }
    }

    // Generate fetcher code with core function
    let fetcherCode: string
    try {
      fetcherCode = generateDataSourceFetcherWithCore(dataSource, tableName || '')
    } catch (error) {
      // tslint:disable-next-line:no-console
      console.error(`Failed to generate fetcher for ${dataSourceType} (${dataSourceId}):`, error)
      return { success: false }
    }

    // Ensure extracted resources object exists
    if (!extractedResources || typeof extractedResources !== 'object') {
      return { success: false }
    }

    // Add the fetcher to utils folder (for server-side use)
    // Use a unique key to avoid conflicts with API routes
    extractedResources[`utils/${fileName}`] = {
      fileName,
      fileType: FileType.JS,
      path: ['utils', 'data-sources'],
      content: fetcherCode,
    }

    // Add dependency for the fetcher
    const fetcherImportName = StringUtils.dashCaseToCamelCase(fileName)
    dependencies[fetcherImportName] = {
      type: 'local',
      path: `../utils/data-sources/${fileName}`,
    }

    // Build params object from resource params
    // tslint:disable-next-line:no-any
    const resourceParams = (node.content as any).resource?.params || {}
    const paramsProperties: types.ObjectProperty[] = []

    // tslint:disable-next-line:no-any
    Object.entries(resourceParams).forEach(([key, value]: [string, any]) => {
      if (value.type === 'static') {
        let astValue: any

        if (value.content === null || value.content === undefined) {
          astValue = types.nullLiteral()
        } else if (Array.isArray(value.content)) {
          // Handle array values (like queryColumns)
          astValue = types.arrayExpression(
            value.content.map((item: any) => {
              if (typeof item === 'string') {
                return types.stringLiteral(item)
              }
              if (typeof item === 'number') {
                return types.numericLiteral(item)
              }
              if (typeof item === 'boolean') {
                return types.booleanLiteral(item)
              }
              return types.nullLiteral()
            })
          )
        } else if (typeof value.content === 'string') {
          astValue = types.stringLiteral(value.content)
        } else if (typeof value.content === 'number') {
          astValue = types.numericLiteral(value.content)
        } else if (typeof value.content === 'boolean') {
          astValue = types.booleanLiteral(value.content)
        } else {
          astValue = types.nullLiteral()
        }

        paramsProperties.push(types.objectProperty(types.stringLiteral(key), astValue))
      }
      // Note: We don't handle 'expr' or 'dynamic' params in getStaticProps
      // as those should be detected by hasResourceDynamicParams check earlier
    })

    const fetchCallExpression = types.callExpression(
      types.memberExpression(types.identifier(fetcherImportName), types.identifier('fetchData')),
      [types.objectExpression(paramsProperties)]
    )

    const safeFetchExpression = createSafeFetchExpression(fetchCallExpression, propKey)

    // Get response value path (if specified)
    const responseMemberAST = node.content.valuePath
      ? ASTUtils.generateMemberExpressionASTFromPath([
          propKey,
          ...ASTUtils.parseValuePath(node.content.valuePath),
        ])
      : types.identifier(propKey)

    // Create or update getStaticProps chunk
    let tryBlock: types.TryStatement | null = null

    if (!getStaticPropsChunk) {
      tryBlock = types.tryStatement(
        types.blockStatement([
          types.returnStatement(
            types.objectExpression([
              types.objectProperty(
                types.identifier('props'),
                types.objectExpression([
                  types.objectProperty(types.identifier(propKey), responseMemberAST, false, false),
                ])
              ),
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

      getStaticPropsChunk = {
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

      chunks.push(getStaticPropsChunk)
    } else {
      // Update existing getStaticProps
      const functionDeclaration = (getStaticPropsChunk.content as types.ExportNamedDeclaration)
        .declaration as types.FunctionDeclaration
      const functionBody = functionDeclaration.body.body
      tryBlock = functionBody.find(
        (subNode) => subNode.type === 'TryStatement'
      ) as types.TryStatement

      if (!tryBlock) {
        return { success: false }
      }
    }

    if (!tryBlock) {
      return { success: false }
    }

    // Ensure props include current data source
    const returnStatement: types.ReturnStatement = tryBlock.block.body.find(
      (subNode) => subNode.type === 'ReturnStatement'
    ) as types.ReturnStatement

    if (!returnStatement) {
      return { success: false }
    }

    const propsObject = (returnStatement.argument as types.ObjectExpression).properties.find(
      (property) => ((property as types.ObjectProperty).key as types.Identifier).name === 'props'
    ) as types.ObjectProperty

    const propsValue = propsObject.value as types.ObjectExpression

    // Check if propKey already exists in the parallel fetch metadata
    const parallelFetchMeta = getStaticPropsChunk.meta?.parallelFetch as
      | ParallelFetchMeta
      | undefined
    const existingInFetchMeta = parallelFetchMeta?.names.includes(propKey)

    // Always ensure both the fetch and the prop are in sync
    if (!existingInFetchMeta) {
      // Add to parallel fetch metadata
      registerParallelFetch(getStaticPropsChunk, tryBlock, propKey, safeFetchExpression)

      // Check if prop exists in return object
      const existingProp = propsValue.properties.find(
        (prop) =>
          prop.type === 'ObjectProperty' &&
          prop.key.type === 'Identifier' &&
          (prop.key as types.Identifier).name === propKey
      )

      // Add prop if it doesn't exist
      if (!existingProp) {
        propsValue.properties.unshift(
          types.objectProperty(types.identifier(propKey), responseMemberAST, false, false)
        )
      }
    }

    return { success: true, chunk: getStaticPropsChunk }
  } catch (error) {
    return { success: false }
  }
}

interface ParallelFetchMeta {
  names: string[]
  expressions: types.Expression[]
  declaration?: types.VariableDeclaration
}

const createSafeFetchExpression = (
  fetchCallExpression: types.CallExpression,
  label: string
): types.Expression => {
  const errorIdentifier = types.identifier('error')

  const catchHandler = types.arrowFunctionExpression(
    [errorIdentifier],
    types.blockStatement([
      types.expressionStatement(
        types.callExpression(
          types.memberExpression(types.identifier('console'), types.identifier('error')),
          [types.stringLiteral(`Error fetching ${label}:`), errorIdentifier]
        )
      ),
      types.returnStatement(types.arrayExpression([])),
    ])
  )

  return types.callExpression(
    types.memberExpression(fetchCallExpression, types.identifier('catch')),
    [catchHandler]
  )
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
