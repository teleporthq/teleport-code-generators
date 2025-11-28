import {
  extractDataSourceIntoNextAPIFolder,
  extractDataSourceIntoGetStaticProps,
} from '../src/utils'
import * as types from '@babel/types'
import { FileType } from '@teleporthq/teleport-types'
import {
  createPostgreSQLDataSource,
  createJavaScriptDataSource,
  createDataSourceNode,
  createComponentChunk,
  createMockJSXElementWithResourceDef,
} from './mocks'

describe('extractDataSourceIntoNextAPIFolder', () => {
  it('creates API route file with correct structure', () => {
    const dataSource = createPostgreSQLDataSource('ds-test')
    const node = createDataSourceNode('ds-test', 'users', 'postgresql')

    const jsxElement = createMockJSXElementWithResourceDef('ds-test', 'users')
    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = { 'ds-test': jsxElement }
    componentChunk.content = jsxElement

    const extractedResources: Record<string, any> = {}

    extractDataSourceIntoNextAPIFolder(
      node,
      { 'ds-test': dataSource },
      componentChunk,
      extractedResources
    )

    const apiFiles = Object.keys(extractedResources).filter((key) => key.startsWith('api/'))
    expect(apiFiles.length).toBeGreaterThan(0)

    const apiFile = extractedResources[apiFiles[0]]
    expect(apiFile.fileType).toBe(FileType.JS)
    expect(apiFile.path).toContain('api')
    expect(apiFile.content).toContain('export default')
  })

  it('adds fetchData attribute to JSX element', () => {
    const dataSource = createPostgreSQLDataSource('ds-test')
    const node = createDataSourceNode('ds-test', 'users', 'postgresql')

    const jsxElement = createMockJSXElementWithResourceDef('ds-test', 'users')
    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = { 'ds-test': jsxElement }
    componentChunk.content = jsxElement

    const extractedResources: Record<string, any> = {}

    extractDataSourceIntoNextAPIFolder(
      node,
      { 'ds-test': dataSource },
      componentChunk,
      extractedResources
    )

    const fetchDataAttr = jsxElement.openingElement.attributes.find(
      (attr) => (attr as types.JSXAttribute).name?.name === 'fetchData'
    )

    expect(fetchDataAttr).toBeDefined()
  })

  it('handles resource params in fetch URL', () => {
    const dataSource = createPostgreSQLDataSource('ds-test')
    const node = createDataSourceNode('ds-test', 'users', 'postgresql', true)

    const jsxElement = createMockJSXElementWithResourceDef('ds-test', 'users')
    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = { 'ds-test': jsxElement }
    componentChunk.content = jsxElement

    const extractedResources: Record<string, any> = {}

    extractDataSourceIntoNextAPIFolder(
      node,
      { 'ds-test': dataSource },
      componentChunk,
      extractedResources
    )

    const fetchDataAttr = jsxElement.openingElement.attributes.find(
      (attr) => (attr as types.JSXAttribute).name?.name === 'fetchData'
    ) as types.JSXAttribute

    expect(fetchDataAttr).toBeDefined()
    const arrowFunc = (fetchDataAttr.value as types.JSXExpressionContainer)
      .expression as types.ArrowFunctionExpression
    expect(arrowFunc.params.length).toBeGreaterThan(0)
  })

  it('re-uses existing utils file for API route', () => {
    const dataSource = createPostgreSQLDataSource('ds-test')
    const node = createDataSourceNode('ds-test', 'users', 'postgresql')

    const jsxElement = createMockJSXElementWithResourceDef('ds-test', 'users')
    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = { 'ds-test': jsxElement }
    componentChunk.content = jsxElement

    const extractedResources = {
      'utils/postgresql-users-ds-test': {
        fileName: 'postgresql-users-ds-test',
        fileType: FileType.JS,
        path: ['utils', 'data-sources'],
        content: 'existing content',
      },
    }

    extractDataSourceIntoNextAPIFolder(
      node,
      { 'ds-test': dataSource },
      componentChunk,
      extractedResources
    )

    const apiFile = Object.values(extractedResources).find((file: any) =>
      file.path?.includes('api')
    ) as any

    expect(apiFile).toBeDefined()
    expect(apiFile.content).toContain('import dataSourceModule')
  })

  it('handles invalid node content gracefully', () => {
    const dataSource = createPostgreSQLDataSource('ds-test')
    const node = createDataSourceNode('ds-test', 'users', 'postgresql')
    delete (node.content as any).resourceDefinition

    const componentChunk = createComponentChunk()
    const extractedResources: Record<string, any> = {}

    expect(() => {
      extractDataSourceIntoNextAPIFolder(
        node,
        { 'ds-test': dataSource },
        componentChunk,
        extractedResources
      )
    }).not.toThrow()

    expect(Object.keys(extractedResources)).toHaveLength(0)
  })

  it('handles missing data source gracefully', () => {
    const node = createDataSourceNode('ds-missing', 'users', 'postgresql')

    const jsxElement = createMockJSXElementWithResourceDef('ds-missing', 'users')
    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = { 'ds-missing': jsxElement }
    componentChunk.content = jsxElement

    const extractedResources: Record<string, any> = {}

    expect(() => {
      extractDataSourceIntoNextAPIFolder(node, {}, componentChunk, extractedResources)
    }).not.toThrow()

    expect(Object.keys(extractedResources)).toHaveLength(0)
  })

  it('handles JSX element not found gracefully', () => {
    const dataSource = createPostgreSQLDataSource('ds-test')
    const node = createDataSourceNode('ds-test', 'users', 'postgresql')

    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = {}

    const extractedResources: Record<string, any> = {}

    expect(() => {
      extractDataSourceIntoNextAPIFolder(
        node,
        { 'ds-test': dataSource },
        componentChunk,
        extractedResources
      )
    }).not.toThrow()
  })

  it('skips nodes that already have fetchData attribute', () => {
    const dataSource = createPostgreSQLDataSource('ds-test')
    const node = createDataSourceNode('ds-test', 'users', 'postgresql')

    const jsxElement = createMockJSXElementWithResourceDef('ds-test', 'users')
    jsxElement.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('fetchData'),
        types.jsxExpressionContainer(types.arrowFunctionExpression([], types.blockStatement([])))
      )
    )

    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = { 'ds-test': jsxElement }
    componentChunk.content = jsxElement

    const extractedResources: Record<string, any> = {}
    const initialAttrCount = jsxElement.openingElement.attributes.length

    extractDataSourceIntoNextAPIFolder(
      node,
      { 'ds-test': dataSource },
      componentChunk,
      extractedResources
    )

    expect(jsxElement.openingElement.attributes.length).toBe(initialAttrCount)
    expect(Object.keys(extractedResources)).toHaveLength(0)
  })
})

describe('extractDataSourceIntoGetStaticProps', () => {
  it('creates utils file and getStaticProps chunk', () => {
    const dataSource = createJavaScriptDataSource('ds-js')
    const node = createDataSourceNode('ds-js', 'data', 'javascript', false)

    const jsxElement = createMockJSXElementWithResourceDef('ds-js', 'data', 'javascript')
    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = { 'ds-js': jsxElement }
    // Wrap in AST structure so traverseAST can find it
    componentChunk.content = types.arrowFunctionExpression(
      [],
      types.blockStatement([types.returnStatement(jsxElement)])
    )

    const extractedResources: Record<string, any> = {}
    const chunks: any[] = []
    const dependencies: Record<string, any> = {}

    const result = extractDataSourceIntoGetStaticProps(
      node,
      { 'ds-js': dataSource },
      componentChunk,
      null,
      chunks,
      extractedResources,
      dependencies
    )

    expect(result.success).toBe(true)
    expect(result.chunk).toBeDefined()

    const utilsFiles = Object.keys(extractedResources).filter((key) => key.startsWith('utils/'))
    expect(utilsFiles.length).toBeGreaterThan(0)

    expect(Object.keys(dependencies).length).toBeGreaterThan(0)
  })

  it('adds initialData to all matching JSX elements', () => {
    const dataSource = createJavaScriptDataSource('ds-js')
    const node = createDataSourceNode('ds-js', 'data', 'javascript', false)

    const jsxElement1 = createMockJSXElementWithResourceDef('ds-js', 'data', 'javascript')
    const jsxElement2 = createMockJSXElementWithResourceDef('ds-js', 'data', 'javascript')

    const componentChunk = createComponentChunk()
    componentChunk.content = types.jsxFragment(
      types.jsxOpeningFragment(),
      types.jsxClosingFragment(),
      [jsxElement1, jsxElement2]
    )

    const extractedResources: Record<string, any> = {}
    const chunks: any[] = []
    const dependencies: Record<string, any> = {}

    extractDataSourceIntoGetStaticProps(
      node,
      { 'ds-js': dataSource },
      componentChunk,
      null,
      chunks,
      extractedResources,
      dependencies
    )

    const hasInitialData1 = jsxElement1.openingElement.attributes.some(
      (attr) => (attr as types.JSXAttribute).name?.name === 'initialData'
    )
    const hasInitialData2 = jsxElement2.openingElement.attributes.some(
      (attr) => (attr as types.JSXAttribute).name?.name === 'initialData'
    )

    expect(hasInitialData1).toBe(true)
    expect(hasInitialData2).toBe(true)
  })

  it('updates existing getStaticProps chunk', () => {
    const dataSource = createJavaScriptDataSource('ds-js')
    const node = createDataSourceNode('ds-js', 'data', 'javascript', false)

    const jsxElement = createMockJSXElementWithResourceDef('ds-js', 'data', 'javascript')
    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = { 'ds-js': jsxElement }
    // Wrap in AST structure so traverseAST can find it
    componentChunk.content = types.arrowFunctionExpression(
      [],
      types.blockStatement([types.returnStatement(jsxElement)])
    )

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
          types.returnStatement(
            types.objectExpression([
              types.objectProperty(types.identifier('props'), types.objectExpression([])),
            ])
          ),
        ])
      )
    )

    const existingChunk = {
      name: 'getStaticProps',
      type: 'ast' as const,
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
      meta: {},
    }

    const extractedResources: Record<string, any> = {}
    const chunks: any[] = []
    const dependencies: Record<string, any> = {}

    const result = extractDataSourceIntoGetStaticProps(
      node,
      { 'ds-js': dataSource },
      componentChunk,
      existingChunk,
      chunks,
      extractedResources,
      dependencies
    )

    expect(result.success).toBe(true)
    expect(result.chunk).toBe(existingChunk)
  })

  it('handles parallel fetch with multiple data sources', () => {
    const dataSource1 = createJavaScriptDataSource('ds-js-1')
    const dataSource2 = createJavaScriptDataSource('ds-js-2')

    const node1 = createDataSourceNode('ds-js-1', 'data1', 'javascript', false)
    const node2 = createDataSourceNode('ds-js-2', 'data2', 'javascript', false)

    const jsxElement1 = createMockJSXElementWithResourceDef('ds-js-1', 'data1', 'javascript')
    const jsxElement2 = createMockJSXElementWithResourceDef('ds-js-2', 'data2', 'javascript')

    const componentChunk = createComponentChunk()
    componentChunk.content = types.jsxFragment(
      types.jsxOpeningFragment(),
      types.jsxClosingFragment(),
      [jsxElement1, jsxElement2]
    )

    const extractedResources: Record<string, any> = {}
    const chunks: any[] = []
    const dependencies: Record<string, any> = {}

    extractDataSourceIntoGetStaticProps(
      node1,
      { 'ds-js-1': dataSource1, 'ds-js-2': dataSource2 },
      componentChunk,
      null,
      chunks,
      extractedResources,
      dependencies
    )

    const getStaticPropsChunk = chunks.find((c) => c.name === 'getStaticProps')

    extractDataSourceIntoGetStaticProps(
      node2,
      { 'ds-js-1': dataSource1, 'ds-js-2': dataSource2 },
      componentChunk,
      getStaticPropsChunk,
      chunks,
      extractedResources,
      dependencies
    )

    expect(getStaticPropsChunk.meta.parallelFetchData).toBeDefined()
    expect(getStaticPropsChunk.meta.parallelFetchData.names.length).toBeGreaterThanOrEqual(2)
  })

  it('renames children to renderSuccess for SSR', () => {
    const dataSource = createJavaScriptDataSource('ds-js')
    const node = createDataSourceNode('ds-js', 'data', 'javascript', false)

    const jsxElement = createMockJSXElementWithResourceDef('ds-js', 'data', 'javascript')
    const initialAttrCount = jsxElement.openingElement.attributes.length
    jsxElement.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('children'),
        types.jsxExpressionContainer(types.arrowFunctionExpression([], types.blockStatement([])))
      )
    )

    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = { 'ds-js': jsxElement }
    // Wrap in AST structure so traverseAST can find it
    componentChunk.content = types.arrowFunctionExpression(
      [],
      types.blockStatement([types.returnStatement(jsxElement)])
    )

    const extractedResources: Record<string, any> = {}
    const chunks: any[] = []
    const dependencies: Record<string, any> = {}

    extractDataSourceIntoGetStaticProps(
      node,
      { 'ds-js': dataSource },
      componentChunk,
      null,
      chunks,
      extractedResources,
      dependencies
    )

    const hasChildren = jsxElement.openingElement.attributes.some(
      (attr) => (attr as types.JSXAttribute).name?.name === 'children'
    )
    const hasRenderSuccess = jsxElement.openingElement.attributes.some(
      (attr) => (attr as types.JSXAttribute).name?.name === 'renderSuccess'
    )

    // Should have renamed children to renderSuccess
    expect(hasChildren).toBe(false)
    expect(hasRenderSuccess).toBe(true)
    // Should have added initialData and persistDataDuringLoading
    expect(jsxElement.openingElement.attributes.length).toBeGreaterThan(initialAttrCount)
  })

  it('handles invalid resource definition gracefully', () => {
    const dataSource = createJavaScriptDataSource('ds-js')
    const node = createDataSourceNode('ds-js', '', 'javascript', false)
    delete (node.content as any).resourceDefinition

    const componentChunk = createComponentChunk()
    const extractedResources: Record<string, any> = {}
    const chunks: any[] = []
    const dependencies: Record<string, any> = {}

    const result = extractDataSourceIntoGetStaticProps(
      node,
      { 'ds-js': dataSource },
      componentChunk,
      null,
      chunks,
      extractedResources,
      dependencies
    )

    expect(result.success).toBe(false)
  })

  it('handles missing data source gracefully', () => {
    const node = createDataSourceNode('ds-missing', '', 'javascript', false)

    const jsxElement = createMockJSXElementWithResourceDef('ds-missing', '', 'javascript')
    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = { 'ds-missing': jsxElement }
    componentChunk.content = jsxElement

    const extractedResources: Record<string, any> = {}
    const chunks: any[] = []
    const dependencies: Record<string, any> = {}

    const result = extractDataSourceIntoGetStaticProps(
      node,
      {},
      componentChunk,
      null,
      chunks,
      extractedResources,
      dependencies
    )

    expect(result.success).toBe(false)
  })

  it('does not duplicate prop in return object', () => {
    const dataSource = createJavaScriptDataSource('ds-js')
    const node = createDataSourceNode('ds-js', 'data', 'javascript', false)

    const jsxElement = createMockJSXElementWithResourceDef('ds-js', 'data', 'javascript')
    const componentChunk = createComponentChunk()
    componentChunk.content = jsxElement

    const extractedResources: Record<string, any> = {}
    const chunks: any[] = []
    const dependencies: Record<string, any> = {}

    extractDataSourceIntoGetStaticProps(
      node,
      { 'ds-js': dataSource },
      componentChunk,
      null,
      chunks,
      extractedResources,
      dependencies
    )

    const getStaticPropsChunk = chunks.find((c) => c.name === 'getStaticProps')

    extractDataSourceIntoGetStaticProps(
      node,
      { 'ds-js': dataSource },
      componentChunk,
      getStaticPropsChunk,
      chunks,
      extractedResources,
      dependencies
    )

    const declaration = (getStaticPropsChunk.content as types.ExportNamedDeclaration)
      .declaration as types.FunctionDeclaration
    const tryBlock = declaration.body.body[0] as types.TryStatement
    const returnStmt = tryBlock.block.body.find(
      (stmt) => stmt.type === 'ReturnStatement'
    ) as types.ReturnStatement
    const returnObj = returnStmt.argument as types.ObjectExpression
    const propsObj = (
      returnObj.properties.find(
        (p) =>
          (p as types.ObjectProperty).key.type === 'Identifier' &&
          ((p as types.ObjectProperty).key as types.Identifier).name === 'props'
      ) as types.ObjectProperty
    ).value as types.ObjectExpression

    const propNames = propsObj.properties.map(
      (p) => ((p as types.ObjectProperty).key as types.Identifier).name
    )
    const uniquePropNames = new Set(propNames)

    expect(propNames.length).toBe(uniquePropNames.size)
  })
})
