/* tslint:disable:function-constructor no-any */
import * as types from '@babel/types'
import generator from '@babel/generator'
import {
  ChunkDefinition,
  ChunkType,
  ComponentStructure,
  FileType,
  UIDLStateDefinition,
} from '@teleporthq/teleport-types'
import { createNextPagesDataSourcePlugin } from '../src/index'
import {
  bootProductsRoute,
  browserParams,
  buildTimeArguments,
  orderBy,
  rowWindow,
} from './_helpers/first-page-runtime'

/**
 * A PLAIN list — no paging, no search — sorted by the dropdown a visitor picks
 * from (`sortBy.split("-")[0]`, a page state starting at "name-asc"). The
 * page's getStaticProps fetched its rows unsorted and the list dropped them, so
 * the server HTML carried its loading slot and the browser fetched the rows on
 * load. The build now fetches them by the sort a visitor starts with, the list
 * shows them while the sort is still there, and any other sort is fetched fresh
 * — the rule the paged lists follow (starting-sort-first-page.test.ts).
 */

const DS_ID = 'ds1'
const TABLE = 'teleport_products'

const STORE_SORT = {
  sort: { type: 'expr', content: `sortBy.split("-")[0] || ''` },
  sortDirection: { type: 'expr', content: `sortBy.split("-")[1] || ''` },
}

// The sort dropdown's state, as the store template declares it.
const SORT_DROPDOWN: Record<string, UIDLStateDefinition> = {
  sortBy: { type: 'string', defaultValue: 'name-asc', urlSearchParamBinding: { key: 'sortBy' } },
}

const STARTING_SORTS = `(sortBy => JSON.stringify([{ field: sortBy.split("-")?.[0] || '', order: sortBy.split("-")?.[1] || '' }]))("name-asc")`

const collapse = (code: string): string => code.replace(/\s+/g, ' ')

const jsx = (name: string, attrs: types.JSXAttribute[], children: types.JSXElement[] = []) =>
  types.jsxElement(
    types.jsxOpeningElement(types.jsxIdentifier(name), attrs, children.length === 0),
    children.length === 0 ? null : types.jsxClosingElement(types.jsxIdentifier(name)),
    children,
    children.length === 0
  )

// The provider the component generator emits for a list of six products.
const makeProvider = (): types.JSXElement =>
  jsx('DataProvider', [
    types.jsxAttribute(
      types.jsxIdentifier('name'),
      types.jsxExpressionContainer(types.stringLiteral('items'))
    ),
    types.jsxAttribute(
      types.jsxIdentifier('resourceDefinition'),
      types.jsxExpressionContainer(
        types.objectExpression([
          types.objectProperty(types.stringLiteral('dataSourceId'), types.stringLiteral(DS_ID)),
          types.objectProperty(types.stringLiteral('tableName'), types.stringLiteral(TABLE)),
          types.objectProperty(
            types.stringLiteral('dataSourceType'),
            types.stringLiteral('teleport')
          ),
        ])
      )
    ),
    types.jsxAttribute(
      types.jsxIdentifier('params'),
      types.jsxExpressionContainer(
        types.objectExpression([
          types.objectProperty(types.stringLiteral('limit'), types.numericLiteral(6)),
        ])
      )
    ),
    types.jsxAttribute(
      types.jsxIdentifier('renderSuccess'),
      types.jsxExpressionContainer(
        types.arrowFunctionExpression(
          [types.identifier('items')],
          jsx('Repeater', [
            types.jsxAttribute(
              types.jsxIdentifier('items'),
              types.jsxExpressionContainer(types.identifier('items'))
            ),
            types.jsxAttribute(
              types.jsxIdentifier('renderItem'),
              types.jsxExpressionContainer(
                types.arrowFunctionExpression([types.identifier('product')], jsx('div', []))
              )
            ),
          ])
        )
      )
    ),
  ])

interface ListOptions {
  sorted?: boolean
  filters?: unknown[]
}

const makeListNode = ({ sorted = true, filters }: ListOptions = {}): any => ({
  type: 'data-source-list',
  content: {
    renderPropIdentifier: 'items',
    resourceDefinition: { dataSourceId: DS_ID, tableName: TABLE, dataSourceType: 'teleport' },
    resource: {
      id: 'TQ_products',
      params: {
        limit: { type: 'static', content: 6 },
        ...(filters ? { filters: { type: 'static', content: filters } } : {}),
      },
    },
    nodes: {
      success: {
        type: 'cms-list-repeater',
        content: {
          renderPropIdentifier: 'product',
          paginated: false,
          searchEnabled: false,
          ...(sorted ? STORE_SORT : {}),
          nodes: { list: { type: 'element', content: { elementType: 'div' } } },
        },
      },
    },
  },
})

/** A products page drawing the given plain lists, run through the page's data-source plugin. */
const runPage = async (
  lists: ListOptions[],
  // `null`: the page declares no state, so the build cannot know the sort.
  stateDefinitions: Record<string, UIDLStateDefinition> | null = SORT_DROPDOWN
) => {
  const providers = lists.map(makeProvider)
  const chunk: ChunkDefinition = {
    name: 'jsx-component',
    type: ChunkType.AST,
    fileType: FileType.JS,
    linkAfter: [],
    content: types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('ProductsList'),
        types.arrowFunctionExpression(
          [types.identifier('props')],
          types.blockStatement([types.returnStatement(jsx('div', [], providers))])
        )
      ),
    ]),
    meta: { nodesLookup: Object.fromEntries(providers.map((p, i) => [`provider${i}`, p])) },
  }
  const structure: ComponentStructure = {
    uidl: {
      name: 'ProductsList',
      node: {
        type: 'element',
        content: { elementType: 'container', children: lists.map(makeListNode) },
      },
      ...(stateDefinitions ? { stateDefinitions } : {}),
      outputOptions: { folderPath: [], fileName: 'products' },
    },
    chunks: [chunk],
    dependencies: {},
    options: {
      dataSources: {
        [DS_ID]: {
          id: DS_ID,
          name: 'TeleportHQ database',
          type: 'teleport',
          config: { selectedTables: { [TABLE]: { columns: [{ name: 'id' }, { name: 'name' }] } } },
        },
      },
      extractedResources: {},
    },
  } as never
  await createNextPagesDataSourcePlugin()(structure)
  const staticPropsChunk = structure.chunks.find((c) => c.name === 'getStaticProps')
  return {
    component: collapse(generator(chunk.content as types.Node).code),
    staticProps: staticPropsChunk
      ? collapse(generator(staticPropsChunk.content as types.Node).code)
      : '',
    chunk,
    staticPropsChunk,
    providers,
  }
}

// The provider's `initialData` as the browser evaluates it for the given state.
const initialDataOf = (provider: types.JSXElement, state: Record<string, unknown>): unknown => {
  const attr = provider.openingElement.attributes.find(
    (a) => a.type === 'JSXAttribute' && a.name.name === 'initialData'
  ) as types.JSXAttribute | undefined
  if (!attr) {
    return undefined
  }
  const expression = (attr.value as types.JSXExpressionContainer).expression as types.Expression
  const names = Object.keys(state)
  return new Function(...names, `return (${generator(expression).code})`)(
    ...names.map((name) => state[name])
  )
}

describe('a plain list sorted by a dropdown, on a page', () => {
  it('fetches its rows at build time by the sort a visitor starts with, as a visitor', async () => {
    const { staticProps } = await runPage([{}])

    // The browser's own sort expression, with the dropdown at its default.
    expect(staticProps).toContain(
      `teleportTeleportProductsDs1.fetchData({ "limit": 6, "sorts": ${STARTING_SORTS} }, { as: "visitor" })`
    )
  })

  it('shows those rows while the sort is where a visitor starts', async () => {
    const { component } = await runPage([{}])

    expect(component).toContain(
      'initialData={sortBy === "name-asc" ? props.items_products : undefined}'
    )
    // Any other sort is another query: the params follow the dropdown.
    expect(component).toMatch(
      /sorts: JSON\.stringify\(\[\{ field: sortBy\.split\("-"\).*\}\), \[sortBy\]\)\}/
    )
  })

  it('keeps fetching in the browser when the build cannot know where the sort starts', async () => {
    const { component, staticProps } = await runPage([{}], null)

    expect(component).not.toContain('initialData')
    expect(staticProps).not.toContain('"sorts"')
  })

  it('fetches an unsorted list beside it with the same params on its own', async () => {
    const { component, staticProps } = await runPage([{ sorted: false }, {}])

    expect(staticProps).toContain(
      'const [items_products, items_products_2] = await Promise.all([teleportTeleportProductsDs1.fetchData({ "limit": 6 }, { as: "visitor" })'
    )
    expect(staticProps).toContain(
      `teleportTeleportProductsDs1.fetchData({ "limit": 6, "sorts": ${STARTING_SORTS} }, { as: "visitor" })`
    )
    expect(component).toContain('initialData={props.items_products}')
    expect(component).toContain(
      'initialData={sortBy === "name-asc" ? props.items_products_2 : undefined}'
    )
  })

  it('is never seeded while a visitor filters it', async () => {
    const byCategory = {
      type: 'condition',
      source: 'category',
      destination: { type: 'dynamic', content: { referenceType: 'state', id: 'selectedCategory' } },
      operand: '=',
    }
    const { component, staticProps } = await runPage([{ filters: [byCategory] }], {
      ...SORT_DROPDOWN,
      selectedCategory: { type: 'string', defaultValue: '' },
    })

    expect(component).not.toContain('initialData')
    expect(staticProps).not.toContain('fetchData')
  })
})

/**
 * Executed: the rows the build fetches and the ones the browser asks for must
 * be one ordering of one row set, and the build's stand in only for the
 * starting sort.
 */
describe('a plain list sorted by a dropdown, run', () => {
  it('sends the build and the browser one sort string while the dropdown is untouched', async () => {
    const { staticPropsChunk, chunk } = await runPage([{}])
    const [atBuild, readAs] = buildTimeArguments(staticPropsChunk)

    expect(readAs).toEqual({ as: 'visitor' })
    expect(atBuild.sorts).toBe('[{"field":"name","order":"asc"}]')
    expect(browserParams(chunk, { sortBy: 'name-asc' })).toEqual({
      limit: '6',
      sorts: atBuild.sorts,
    })
    expect(browserParams(chunk, { sortBy: 'price-desc' }).sorts).toBe(
      '[{"field":"price","order":"desc"}]'
    )
  })

  it('orders the rows at build time exactly as the browser orders them', async () => {
    const { staticPropsChunk, chunk } = await runPage([{}])
    const route = bootProductsRoute()

    const atBuild = await route.atBuild(buildTimeArguments(staticPropsChunk))
    const inBrowser = await route.inBrowser(browserParams(chunk, { sortBy: 'name-asc' }))

    // The same columns, rows without a value last, the row's id breaking ties,
    // over the products a visitor is served.
    expect(orderBy(atBuild)).toBe(' ORDER BY name ASC NULLS LAST, "id" ASC LIMIT')
    expect(rowWindow(atBuild)).toBe(' LIMIT 6')
    expect(atBuild).toContain("WHERE (LOWER(TRIM(status)) = 'active')")
    expect(inBrowser).toBe(atBuild)
  })

  it("shows the build's rows for the starting sort only; any other is fetched fresh", async () => {
    const { providers, staticPropsChunk, chunk } = await runPage([{ sorted: false }, {}])
    const props = { items_products: ['unsorted'], items_products_2: ['by name'] }

    expect(initialDataOf(providers[1], { sortBy: 'name-asc', props })).toEqual(['by name'])
    // Another pick: no seed, and params the provider has not fetched yet.
    expect(initialDataOf(providers[1], { sortBy: 'price-desc', props })).toBeUndefined()
    expect(browserParams(chunk, { sortBy: 'price-desc' }, 1).sorts).not.toBe(
      buildTimeArguments(staticPropsChunk, 'items_products_2')[0].sorts
    )
    // The unsorted list beside it keeps its own rows, whatever the dropdown says.
    expect(initialDataOf(providers[0], { sortBy: 'price-desc', props })).toEqual(['unsorted'])
    expect(buildTimeArguments(staticPropsChunk, 'items_products')[0]).toEqual({ limit: 6 })
  })
})
