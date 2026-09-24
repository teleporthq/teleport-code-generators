import * as types from '@babel/types'
import generator from '@babel/generator'
import {
  ChunkType,
  FileType,
  ComponentStructure,
  ChunkDefinition,
} from '@teleporthq/teleport-types'
import { createNextArrayMapperPaginationPlugin } from '../src/pagination-plugin'
import { SEARCH_CLEAR_ATTR } from '../src/search-clear'

// tslint:disable:no-any

const element = (
  tag: string,
  attrs: Array<[string, string]>,
  children: types.JSXElement['children'] = []
): types.JSXElement =>
  types.jsxElement(
    types.jsxOpeningElement(
      types.jsxIdentifier(tag),
      attrs.map(([name, value]) =>
        types.jsxAttribute(types.jsxIdentifier(name), types.stringLiteral(value))
      ),
      false
    ),
    types.jsxClosingElement(types.jsxIdentifier(tag)),
    children,
    false
  )

const searchInput = (): types.JSXElement => element('input', [['className', 'search-input']])
const clearButton = (): types.JSXElement =>
  element('button', [
    ['type', 'button'],
    [SEARCH_CLEAR_ATTR, 'true'],
  ])

/**
 * A component whose JSX is the field the editor builds — `<div><input
 * class=search-input/><button data-tq-search-clear/></div>` — plus, when
 * asked, a stray marked button somewhere else on the page.
 */
const makeComponentChunk = (withStrayButton: boolean): ChunkDefinition => {
  const field = element('div', [['data-tq-search-field', 'true']], [searchInput(), clearButton()])
  const root = element(
    'div',
    [],
    withStrayButton ? [field, element('div', [], [clearButton()])] : [field]
  )
  const body = types.blockStatement([types.returnStatement(root)])
  const arrow = types.arrowFunctionExpression([types.identifier('props')], body)
  const declaration = types.variableDeclaration('const', [
    types.variableDeclarator(types.identifier('TestComponent'), arrow),
  ])
  return {
    name: 'jsx-component',
    type: ChunkType.AST,
    fileType: FileType.JS,
    linkAfter: [],
    content: declaration,
    meta: {},
  }
}

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
          searchEnabled: true,
          searchDebounce: 300,
          nodes: { list: { type: 'element', content: { elementType: 'div' } } },
        },
      },
    },
  },
})

const runPlugin = async (withStrayButton = false): Promise<string> => {
  const chunk = makeComponentChunk(withStrayButton)
  const structure: ComponentStructure = {
    uidl: { name: 'TestComponent', node: makeUidlNode() },
    chunks: [chunk],
    dependencies: {},
    options: { dataSources: {}, extractedResources: {} },
  } as never
  await createNextArrayMapperPaginationPlugin()(structure)
  return generator(chunk.content as types.Node).code
}

const collapse = (code: string): string => code.replace(/\s+/g, ' ')

describe('pagination plugin — search clear button', () => {
  it('empties the query on click and renders only while something is typed', async () => {
    const flat = collapse(await runPlugin())
    expect(flat).toContain('onClick={() => setDs_0_searchQuery("")}')
    expect(flat).toContain('{ds_0_searchQuery ? <button type="button" data-tq-search-clear="true"')
    expect(flat).toContain(': null}')
    // The input beside it is the one the button clears.
    expect(flat).toContain('value={ds_0_searchQuery}')
  })

  it('leaves a marked button that shares no parent with a search input alone', async () => {
    const flat = collapse(await runPlugin(true))
    expect(flat.match(/setDs_0_searchQuery\(""\)/g)).toHaveLength(1)
    // The stray one keeps its markup, unwired and unconditional.
    expect(flat).toContain('<div><button type="button" data-tq-search-clear="true"></button></div>')
  })
})
