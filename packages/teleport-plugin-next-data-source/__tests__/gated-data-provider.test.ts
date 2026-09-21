import * as types from '@babel/types'
import generator from '@babel/generator'
import { parse } from '@babel/parser'
import {
  ChunkType,
  FileType,
  ComponentStructure,
  ChunkDefinition,
} from '@teleporthq/teleport-types'
import { createNextArrayMapperPaginationPlugin } from '../src/pagination-plugin'

/**
 * A paginated list under a tab panel — `{activeTabIndex === 0 && (…)}` — is a
 * DataProvider on the RIGHT of a logical expression. The plugin's JSX walkers
 * visited children, bodies, arguments and ternary branches, never `left` /
 * `right`, so the provider was never wired: no page params, no fetcher, and a
 * shop whose grid sat under its first tab rendered nothing.
 */
const makeComponentChunk = (): ChunkDefinition => {
  const program = parse(
    `const TestComponent = (props) => {
      return (
        <div>
          {activeTabIndex === 0 && (
            <div className="panel">
              <DataProvider name={'items'} renderSuccess={(items) => (
                <Repeater items={items || []} renderItem={(product) => <div>{product.name}</div>} />
              )} />
            </div>
          )}
        </div>
      )
    }`,
    { sourceType: 'module', plugins: ['jsx'] }
  )
  return {
    name: 'jsx-component',
    type: ChunkType.AST,
    fileType: FileType.JS,
    linkAfter: [],
    content: program.program.body[0] as types.VariableDeclaration,
    meta: {},
  }
}

// tslint:disable-next-line:no-any
const makeUidlNode = (): any => ({
  type: 'data-source-list',
  content: {
    renderPropIdentifier: 'items',
    resourceDefinition: {
      dataSourceId: 'ds1',
      tableName: 'products',
      dataSourceType: 'postgresql',
    },
    resource: { params: { queryColumns: { content: ['name'] } } },
    nodes: {
      success: {
        type: 'cms-list-repeater',
        content: {
          renderPropIdentifier: 'product',
          paginated: true,
          perPage: 20,
          searchEnabled: false,
          nodes: { list: { type: 'element', content: { elementType: 'div' } } },
        },
      },
    },
  },
})

describe('pagination plugin — a provider gated by a logical expression', () => {
  it('wires the page params and the fetcher onto a DataProvider under `cond && (…)`', async () => {
    const chunk = makeComponentChunk()
    const structure: ComponentStructure = {
      uidl: { name: 'TestComponent', node: makeUidlNode() },
      chunks: [chunk],
      dependencies: {},
      options: { dataSources: {}, extractedResources: {} },
    } as never
    await createNextArrayMapperPaginationPlugin()(structure)
    const code = generator(chunk.content as types.Node).code.replace(/\s+/g, ' ')

    expect(code).toContain('page: ds_0_page')
    expect(code).toContain('perPage: 20')
    expect(code).toContain('fetchData={')
  })
})
