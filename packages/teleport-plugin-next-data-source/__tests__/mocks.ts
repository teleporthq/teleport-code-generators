import * as types from '@babel/types'
import {
  ComponentStructure,
  UIDLDataSourceItemNode,
  UIDLDataSourceListNode,
  UIDLDataSource,
  ChunkDefinition,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { component, elementNode } from '@teleporthq/teleport-uidl-builders'

export const createDataSourceNode = (
  dataSourceId: string,
  tableName: string,
  dataSourceType: string,
  hasDynamicParams: boolean = false
): UIDLDataSourceItemNode => {
  const params = hasDynamicParams
    ? {
        limit: { type: 'dynamic' as const, content: { referenceType: 'prop', id: 'limit' } },
      }
    : {}

  return {
    type: 'data-source-item',
    content: {
      name: 'data',
      renderPropIdentifier: 'data',
      elementType: 'data-provider',
      dependency: {
        type: 'package',
        path: '@teleporthq/teleport-custom-components',
        version: '1.0.0',
        meta: {
          namedImport: true,
        },
      },
      resourceDefinition: {
        type: 'external-data-source',
        dataSourceId,
        tableName,
        dataSourceType: dataSourceType as any,
      },
      resource: {
        method: 'get',
        params,
      } as any,
      children: [elementNode('div', {}, [])],
    },
  }
}

export const createDataSourceListNode = (
  dataSourceId: string,
  tableName: string,
  dataSourceType: string
): UIDLDataSourceListNode => {
  return {
    type: 'data-source-list',
    content: {
      name: 'items',
      renderPropIdentifier: 'items',
      elementType: 'data-provider',
      dependency: {
        type: 'package',
        path: '@teleporthq/teleport-custom-components',
        version: '1.0.0',
        meta: {
          namedImport: true,
        },
      },
      resourceDefinition: {
        type: 'external-data-source',
        dataSourceId,
        tableName,
        dataSourceType: dataSourceType as any,
      },
      resource: {
        method: 'get',
        params: {},
      } as any,
      children: [elementNode('div', {}, [])],
    },
  }
}

export const createPostgreSQLDataSource = (id: string): UIDLDataSource => ({
  id,
  name: 'PostgreSQL Database',
  type: 'postgresql',
  config: {
    host: 'localhost',
    port: 5432,
    user: 'testuser',
    password: 'testpass',
    database: 'testdb',
    ssl: false,
  },
})

export const createMySQLDataSource = (id: string): UIDLDataSource => ({
  id,
  name: 'MySQL Database',
  type: 'mysql',
  config: {
    host: 'localhost',
    port: 3306,
    user: 'testuser',
    password: 'testpass',
    database: 'testdb',
  },
})

export const createMongoDBDataSource = (id: string): UIDLDataSource => ({
  id,
  name: 'MongoDB Database',
  type: 'mongodb',
  config: {
    connectionString: 'mongodb://localhost:27017/testdb',
    database: 'testdb',
  },
})

export const createRESTAPIDataSource = (id: string): UIDLDataSource => ({
  id,
  name: 'REST API',
  type: 'rest-api',
  config: {
    url: 'https://api.example.com/data',
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  },
})

export const createJavaScriptDataSource = (id: string): UIDLDataSource => ({
  id,
  name: 'JavaScript Data',
  type: 'javascript',
  config: {
    code: '[{id: 1, name: "Item 1"}, {id: 2, name: "Item 2"}]',
  },
})

export const createStaticCollectionDataSource = (id: string): UIDLDataSource => ({
  id,
  name: 'Static Collection',
  type: 'static-collection',
  config: {
    data: [
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
    ],
  },
})

export const createRedisDataSource = (id: string): UIDLDataSource => ({
  id,
  name: 'Redis',
  type: 'redis',
  config: {
    host: 'localhost',
    port: 6379,
    database: 0,
  },
})

export const createComponentChunk = (): ChunkDefinition => {
  const jsxElement = types.jsxElement(
    types.jsxOpeningElement(types.jsxIdentifier('div'), [], false),
    types.jsxClosingElement(types.jsxIdentifier('div')),
    [],
    false
  )

  return {
    name: 'jsx-component',
    type: ChunkType.AST,
    fileType: FileType.JS,
    linkAfter: [],
    content: jsxElement,
    meta: {
      nodesLookup: {},
    },
  }
}

export const createComponentStructure = (
  dataSources: Record<string, UIDLDataSource>,
  node?: UIDLDataSourceItemNode | UIDLDataSourceListNode
): ComponentStructure => {
  const uidl = component('TestComponent', node ? (node as any) : elementNode('div', {}, []))

  return {
    uidl,
    chunks: [createComponentChunk()],
    dependencies: {},
    options: {
      dataSources,
      extractedResources: {},
    },
  }
}

export const createMockJSXElementWithResourceDef = (
  dataSourceId: string,
  tableName: string
): types.JSXElement => {
  const jsxElement = types.jsxElement(
    types.jsxOpeningElement(types.jsxIdentifier('DataProvider'), [], false),
    types.jsxClosingElement(types.jsxIdentifier('DataProvider')),
    [],
    false
  )

  jsxElement.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('resourceDefinition'),
      types.jsxExpressionContainer(
        types.objectExpression([
          types.objectProperty(
            types.stringLiteral('dataSourceId'),
            types.stringLiteral(dataSourceId)
          ),
          types.objectProperty(types.stringLiteral('tableName'), types.stringLiteral(tableName)),
        ])
      )
    )
  )

  return jsxElement
}
