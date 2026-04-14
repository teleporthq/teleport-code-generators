import * as types from '@babel/types'
import { createNextPagesDataSourcePlugin, createNextComponentDataSourcePlugin } from '../src/index'
import { FileType } from '@teleporthq/teleport-types'
import {
  createComponentStructure,
  createDataSourceNode,
  createDataSourceListNode,
  createPostgreSQLDataSource,
  createRESTAPIDataSource,
  createJavaScriptDataSource,
  createComponentChunk,
  createMockJSXElementWithResourceDef,
} from './mocks'
import { component, elementNode } from '@teleporthq/teleport-uidl-builders'

describe('createNextComponentDataSourcePlugin', () => {
  const plugin = createNextComponentDataSourcePlugin()

  it('returns structure unchanged if no data sources', async () => {
    const structure = createComponentStructure({}, undefined)
    const result = await plugin(structure)

    expect(result).toBe(structure)
    expect(Object.keys(result.options.extractedResources || {})).toHaveLength(0)
  })

  it('returns structure unchanged if no options', async () => {
    const structure: any = {
      uidl: component('Test', elementNode('div')),
      chunks: [createComponentChunk()],
      dependencies: {},
      options: {},
    }
    const result = await plugin(structure)

    expect(result).toBe(structure)
  })

  it('returns structure unchanged if no jsx-component chunk', async () => {
    const structure: any = {
      uidl: component('Test', elementNode('div')),
      chunks: [],
      dependencies: {},
      options: {
        dataSources: {},
        extractedResources: {},
      },
    }
    const result = await plugin(structure)

    expect(result).toBe(structure)
  })

  it('extracts API route for data-source-item node', async () => {
    const dataSource = createPostgreSQLDataSource('ds-1')
    const node = createDataSourceNode('ds-1', 'users', 'postgresql')

    const jsxElement = createMockJSXElementWithResourceDef('ds-1', 'users')
    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = {
      'ds-1': jsxElement,
    }
    componentChunk.content = jsxElement

    const rootNode = elementNode('div', {}, [node as any])
    const uidl = component('Test', rootNode)

    const structure = {
      uidl,
      chunks: [componentChunk],
      dependencies: {},
      options: {
        dataSources: { 'ds-1': dataSource },
        extractedResources: {},
      },
    }

    const result = await plugin(structure)
    const apiFiles = Object.keys(result.options.extractedResources || {}).filter((key) =>
      key.startsWith('api/')
    )

    expect(apiFiles.length).toBeGreaterThan(0)
  })

  it('extracts API route for data-source-list node', async () => {
    const dataSource = createRESTAPIDataSource('ds-2')
    const node = createDataSourceListNode('ds-2', 'data', 'rest-api')

    const jsxElement = createMockJSXElementWithResourceDef('ds-2', 'data', 'rest-api', 'items')
    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = {
      'ds-2': jsxElement,
    }
    componentChunk.content = jsxElement

    const rootNode = elementNode('div', {}, [node as any])
    const uidl = component('Test', rootNode)

    const structure = {
      uidl,
      chunks: [componentChunk],
      dependencies: {},
      options: {
        dataSources: { 'ds-2': dataSource },
        extractedResources: {},
      },
    }

    const result = await plugin(structure)
    const apiFiles = Object.keys(result.options.extractedResources || {})

    expect(apiFiles.length).toBeGreaterThan(0)
  })

  it('generates correct file name and path', async () => {
    const dataSource = createPostgreSQLDataSource('ds-unique-123')
    const node = createDataSourceNode('ds-unique-123', 'users', 'postgresql')

    const jsxElement = createMockJSXElementWithResourceDef('ds-unique-123', 'users')
    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = {
      'ds-unique-123': jsxElement,
    }
    componentChunk.content = jsxElement

    const rootNode = elementNode('div', {}, [node as any])
    const uidl = component('Test', rootNode)

    const structure = {
      uidl,
      chunks: [componentChunk],
      dependencies: {},
      options: {
        dataSources: { 'ds-unique-123': dataSource },
        extractedResources: {},
      },
    }

    const result = await plugin(structure)
    const extractedKeys = Object.keys(result.options.extractedResources || {})

    expect(extractedKeys.some((key) => key.includes('postgresql'))).toBe(true)
    expect(extractedKeys.some((key) => key.includes('users'))).toBe(true)

    const apiFile = extractedKeys.find((key) => key.startsWith('api/'))
    if (apiFile) {
      const resource = result.options.extractedResources![apiFile]
      expect(resource.path).toContain('pages')
      expect(resource.path).toContain('api')
      expect(resource.fileType).toBe(FileType.JS)
    }
  })

  it('handles multiple data sources', async () => {
    const ds1 = createPostgreSQLDataSource('ds-1')
    const ds2 = createRESTAPIDataSource('ds-2')

    const node1 = createDataSourceNode('ds-1', 'users', 'postgresql')
    const node2 = createDataSourceNode('ds-2', '', 'rest-api')

    const jsxElement1 = createMockJSXElementWithResourceDef('ds-1', 'users', 'postgresql')
    const jsxElement2 = createMockJSXElementWithResourceDef('ds-2', '', 'rest-api')

    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = {
      'ds-1': jsxElement1,
      'ds-2': jsxElement2,
    }
    componentChunk.content = types.jsxFragment(
      types.jsxOpeningFragment(),
      types.jsxClosingFragment(),
      [jsxElement1, jsxElement2]
    )

    const uidl = component('Test', elementNode('div'))
    uidl.node = {
      type: 'element',
      content: {
        elementType: 'div',
        children: [node1 as any, node2 as any],
      },
    }

    const structure = {
      uidl,
      chunks: [componentChunk],
      dependencies: {},
      options: {
        dataSources: { 'ds-1': ds1, 'ds-2': ds2 },
        extractedResources: {},
      },
    }

    const result = await plugin(structure)
    const apiFiles = Object.keys(result.options.extractedResources || {}).filter((key) =>
      key.startsWith('api/')
    )

    expect(apiFiles.length).toBeGreaterThan(0)
  })
})

describe('createNextPagesDataSourcePlugin', () => {
  const plugin = createNextPagesDataSourcePlugin()

  it('returns structure unchanged if no data sources', async () => {
    const structure = createComponentStructure({}, undefined)
    const result = await plugin(structure)

    expect(result).toBe(structure)
  })

  it('extracts to getStaticProps for static data', async () => {
    const dataSource = createJavaScriptDataSource('ds-js')
    const node = createDataSourceNode('ds-js', 'data', 'javascript', false)

    const jsxElement = createMockJSXElementWithResourceDef('ds-js', 'data', 'javascript')
    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = {
      'ds-js': jsxElement,
    }
    componentChunk.content = types.arrowFunctionExpression(
      [],
      types.blockStatement([types.returnStatement(jsxElement)])
    )

    const rootNode = elementNode('div', {}, [node as any])
    const uidl = component('Test', rootNode)

    const structure = {
      uidl,
      chunks: [componentChunk],
      dependencies: {},
      options: {
        dataSources: { 'ds-js': dataSource },
        extractedResources: {},
      },
    }

    const result = await plugin(structure)

    const getStaticPropsChunk = result.chunks.find((chunk) => chunk.name === 'getStaticProps')
    expect(getStaticPropsChunk).toBeDefined()
  })

  it('extracts to API route for dynamic params', async () => {
    const dataSource = createPostgreSQLDataSource('ds-pg')
    const node = createDataSourceNode('ds-pg', 'users', 'postgresql', true)

    const jsxElement = createMockJSXElementWithResourceDef('ds-pg', 'users')
    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = {
      'ds-pg': jsxElement,
    }
    componentChunk.content = jsxElement

    const rootNode = elementNode('div', {}, [node as any])
    const uidl = component('Test', rootNode)

    const structure = {
      uidl,
      chunks: [componentChunk],
      dependencies: {},
      options: {
        dataSources: { 'ds-pg': dataSource },
        extractedResources: {},
      },
    }

    const result = await plugin(structure)

    const apiFiles = Object.keys(result.options.extractedResources || {}).filter((key) =>
      key.startsWith('api/')
    )
    expect(apiFiles.length).toBeGreaterThan(0)
  })

  it('creates utils file for getStaticProps data sources', async () => {
    const dataSource = createJavaScriptDataSource('ds-js')
    const node = createDataSourceNode('ds-js', 'data', 'javascript', false)

    const jsxElement = createMockJSXElementWithResourceDef('ds-js', 'data', 'javascript')
    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = {
      'ds-js': jsxElement,
    }
    componentChunk.content = types.arrowFunctionExpression(
      [],
      types.blockStatement([types.returnStatement(jsxElement)])
    )

    const rootNode = elementNode('div', {}, [node as any])
    const uidl = component('Test', rootNode)

    const structure = {
      uidl,
      chunks: [componentChunk],
      dependencies: {},
      options: {
        dataSources: { 'ds-js': dataSource },
        extractedResources: {},
      },
    }

    const result = await plugin(structure)

    const utilsFiles = Object.keys(result.options.extractedResources || {}).filter((key) =>
      key.startsWith('utils/')
    )
    expect(utilsFiles.length).toBeGreaterThan(0)
  })

  it('adds dependencies for fetcher imports', async () => {
    const dataSource = createJavaScriptDataSource('ds-js')
    const node = createDataSourceNode('ds-js', 'data', 'javascript', false)

    const jsxElement = createMockJSXElementWithResourceDef('ds-js', 'data', 'javascript')
    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = {
      'ds-js': jsxElement,
    }
    componentChunk.content = types.arrowFunctionExpression(
      [],
      types.blockStatement([types.returnStatement(jsxElement)])
    )

    const rootNode = elementNode('div', {}, [node as any])
    const uidl = component('Test', rootNode)

    const structure = {
      uidl,
      chunks: [componentChunk],
      dependencies: {},
      options: {
        dataSources: { 'ds-js': dataSource },
        extractedResources: {},
      },
    }

    const result = await plugin(structure)

    expect(Object.keys(result.dependencies).length).toBeGreaterThan(0)
  })

  it('does not duplicate data sources with same ID and table', async () => {
    const dataSource = createPostgreSQLDataSource('ds-same')
    const node1 = createDataSourceNode('ds-same', 'users', 'postgresql', false)
    const node2 = createDataSourceNode('ds-same', 'users', 'postgresql', false)

    const jsxElement1 = createMockJSXElementWithResourceDef('ds-same', 'users')
    const jsxElement2 = createMockJSXElementWithResourceDef('ds-same', 'users')

    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = {
      'ds-same-1': jsxElement1,
      'ds-same-2': jsxElement2,
    }
    componentChunk.content = types.jsxFragment(
      types.jsxOpeningFragment(),
      types.jsxClosingFragment(),
      [jsxElement1, jsxElement2]
    )

    const uidl = component('Test', elementNode('div'))
    uidl.node = {
      type: 'element',
      content: {
        elementType: 'div',
        children: [node1 as any, node2 as any],
      },
    }

    const structure = {
      uidl,
      chunks: [componentChunk],
      dependencies: {},
      options: {
        dataSources: { 'ds-same': dataSource },
        extractedResources: {},
      },
    }

    const result = await plugin(structure)

    const utilsFiles = Object.keys(result.options.extractedResources || {}).filter((key) =>
      key.startsWith('utils/')
    )

    expect(utilsFiles.length).toBe(1)
  })

  it('creates getStaticProps chunk with correct structure', async () => {
    const dataSource = createJavaScriptDataSource('ds-js')
    const node = createDataSourceNode('ds-js', 'data', 'javascript', false)

    const jsxElement = createMockJSXElementWithResourceDef('ds-js', 'data', 'javascript')
    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = {
      'ds-js': jsxElement,
    }
    componentChunk.content = types.arrowFunctionExpression(
      [],
      types.blockStatement([types.returnStatement(jsxElement)])
    )

    const rootNode = elementNode('div', {}, [node as any])
    const uidl = component('Test', rootNode)

    const structure = {
      uidl,
      chunks: [componentChunk],
      dependencies: {},
      options: {
        dataSources: { 'ds-js': dataSource },
        extractedResources: {},
      },
    }

    const result = await plugin(structure)

    const getStaticPropsChunk = result.chunks.find((chunk) => chunk.name === 'getStaticProps')

    expect(getStaticPropsChunk).toBeDefined()
    expect(getStaticPropsChunk!.type).toBe('ast')
    expect(getStaticPropsChunk!.fileType).toBe(FileType.JS)
    expect(getStaticPropsChunk!.linkAfter).toContain('jsx-component')

    const declaration = (getStaticPropsChunk!.content as types.ExportNamedDeclaration)
      .declaration as types.FunctionDeclaration
    expect(declaration.id?.name).toBe('getStaticProps')
    expect(declaration.async).toBe(true)
  })

  it('adds initialData attribute to JSX elements', async () => {
    const dataSource = createJavaScriptDataSource('ds-js')
    const node = createDataSourceNode('ds-js', 'data', 'javascript', false)

    const jsxElement = createMockJSXElementWithResourceDef('ds-js', 'data', 'javascript')
    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = {
      'ds-js': jsxElement,
    }
    // Wrap in a return statement inside an arrow function (simulating component structure)
    componentChunk.content = types.arrowFunctionExpression(
      [],
      types.blockStatement([types.returnStatement(jsxElement)])
    )

    const rootNode = elementNode('div', {}, [node as any])
    const uidl = component('Test', rootNode)

    const structure = {
      uidl,
      chunks: [componentChunk],
      dependencies: {},
      options: {
        dataSources: { 'ds-js': dataSource },
        extractedResources: {},
      },
    }

    await plugin(structure)

    const hasInitialData = jsxElement.openingElement.attributes.some(
      (attr) => (attr as types.JSXAttribute).name?.name === 'initialData'
    )

    expect(hasInitialData).toBe(true)
  })

  it('adds persistDataDuringLoading attribute', async () => {
    const dataSource = createJavaScriptDataSource('ds-js')
    const node = createDataSourceNode('ds-js', 'data', 'javascript', false)

    const jsxElement = createMockJSXElementWithResourceDef('ds-js', 'data', 'javascript')
    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = {
      'ds-js': jsxElement,
    }
    // Wrap in a return statement inside an arrow function (simulating component structure)
    componentChunk.content = types.arrowFunctionExpression(
      [],
      types.blockStatement([types.returnStatement(jsxElement)])
    )

    const rootNode = elementNode('div', {}, [node as any])
    const uidl = component('Test', rootNode)

    const structure = {
      uidl,
      chunks: [componentChunk],
      dependencies: {},
      options: {
        dataSources: { 'ds-js': dataSource },
        extractedResources: {},
      },
    }

    await plugin(structure)

    const persistDataAttr = jsxElement.openingElement.attributes.find(
      (attr) => (attr as types.JSXAttribute).name?.name === 'persistDataDuringLoading'
    ) as types.JSXAttribute

    expect(persistDataAttr).toBeDefined()
    expect((persistDataAttr.value as types.JSXExpressionContainer).expression).toMatchObject({
      type: 'BooleanLiteral',
      value: true,
    })
  })

  it('skips nodes with existing initialData', async () => {
    const dataSource = createJavaScriptDataSource('ds-js')
    const node = createDataSourceNode('ds-js', '', 'javascript', false)
    ;(node.content as any).initialData = []

    const structure = createComponentStructure({ 'ds-js': dataSource }, node)
    const initialChunkCount = structure.chunks.length

    const result = await plugin(structure)

    expect(result.chunks.length).toBe(initialChunkCount)
  })

  it('adds initialData to ALL DataProvider nodes that share the same resource ID', async () => {
    // Regression test: multiple UIDL data-source nodes sharing the same resource.id
    // should all receive initialData/persistDataDuringLoading, not just the first one.
    const dataSource = createJavaScriptDataSource('ds-js')

    const sharedResourceId = 'TQ_shared123'

    const makeNode = () => {
      const n = createDataSourceNode('ds-js', 'data', 'javascript', false)
      ;(n.content.resource as any).id = sharedResourceId
      return n
    }

    const node1 = makeNode()
    const node2 = makeNode()
    const node3 = makeNode()

    const jsxElement1 = createMockJSXElementWithResourceDef('ds-js', 'data', 'javascript', 'data')
    const jsxElement2 = createMockJSXElementWithResourceDef('ds-js', 'data', 'javascript', 'data')
    const jsxElement3 = createMockJSXElementWithResourceDef('ds-js', 'data', 'javascript', 'data')

    const componentChunk = createComponentChunk()
    componentChunk.meta!.nodesLookup = {}
    componentChunk.content = types.arrowFunctionExpression(
      [],
      types.blockStatement([
        types.returnStatement(
          types.jsxElement(
            types.jsxOpeningElement(types.jsxIdentifier('div'), [], false),
            types.jsxClosingElement(types.jsxIdentifier('div')),
            [jsxElement1, jsxElement2, jsxElement3],
            false
          )
        ),
      ])
    )

    const rootNode = elementNode('div', {}, [node1 as any, node2 as any, node3 as any])
    const uidl = component('Test', rootNode)

    const structure = {
      uidl,
      chunks: [componentChunk],
      dependencies: {},
      options: {
        dataSources: { 'ds-js': dataSource },
        extractedResources: {},
        isPage: true,
      },
    }

    await plugin(structure)

    const hasInitialData = (el: types.JSXElement) =>
      el.openingElement.attributes.some(
        (attr) => (attr as types.JSXAttribute).name?.name === 'initialData'
      )

    expect(hasInitialData(jsxElement1)).toBe(true)
    expect(hasInitialData(jsxElement2)).toBe(true)
    expect(hasInitialData(jsxElement3)).toBe(true)

    // getStaticProps should only fetch the data once (not three times)
    const getStaticPropsChunk = structure.chunks.find((c) => c.name === 'getStaticProps')
    expect(getStaticPropsChunk).toBeDefined()
    const meta = getStaticPropsChunk!.meta?.parallelFetchData as any
    const names: string[] = meta?.names ?? []
    // All three providers share one prop key — only one fetch should be registered
    expect(names.length).toBe(1)
  })

  it('skips nodes without resource', async () => {
    const dataSource = createJavaScriptDataSource('ds-js')
    const node = createDataSourceNode('ds-js', '', 'javascript', false)
    delete (node.content as any).resource

    const structure = createComponentStructure({ 'ds-js': dataSource }, node)
    const initialChunkCount = structure.chunks.length

    const result = await plugin(structure)

    expect(result.chunks.length).toBe(initialChunkCount)
  })
})

describe('plugin error handling', () => {
  it('handles missing resourceDefinition gracefully', async () => {
    const plugin = createNextComponentDataSourcePlugin()
    const node = createDataSourceNode('ds-1', 'users', 'postgresql')
    delete (node.content as any).resourceDefinition

    const structure = createComponentStructure({}, node)

    expect(async () => {
      await plugin(structure)
    }).not.toThrow()
  })

  it('handles invalid data source ID gracefully', async () => {
    const plugin = createNextComponentDataSourcePlugin()
    const dataSource = createPostgreSQLDataSource('ds-1')
    const node = createDataSourceNode('ds-invalid', 'users', 'postgresql')

    const structure = createComponentStructure({ 'ds-1': dataSource }, node)

    expect(async () => {
      await plugin(structure)
    }).not.toThrow()
  })

  it('handles missing nodesLookup gracefully', async () => {
    const plugin = createNextComponentDataSourcePlugin()
    const dataSource = createPostgreSQLDataSource('ds-1')
    const node = createDataSourceNode('ds-1', 'users', 'postgresql')

    const structure = createComponentStructure({ 'ds-1': dataSource }, node)
    structure.chunks[0].meta = {}

    expect(async () => {
      await plugin(structure)
    }).not.toThrow()
  })
})
