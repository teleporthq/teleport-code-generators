/* tslint:disable:function-constructor max-classes-per-file */
import * as types from '@babel/types'
import generator from '@babel/generator'
import { ComponentStructure, UIDLStateDefinition } from '@teleporthq/teleport-types'
import { createNextArrayMapperPaginationPlugin } from '../src/pagination-plugin'
import { generateDataSourceFetcherWithCore } from '../src/data-source-fetchers'
import { extractDynamicSort, readSortStateDefaults } from '../src/sort-utils'
import {
  makeGetStaticPropsChunk,
  makeUidlNode,
  makeWidgetComponentChunk,
  type RepeaterOptions,
} from './_helpers/pagination-widget-fixture'

/**
 * The store's products listing sorts by the dropdown a visitor picks from —
 * `sortBy.split("-")[0]`, a page state starting at "name-asc". The build did
 * not know where that sort starts, so it fetched the listing's first page
 * unsorted and the list dropped it: the server HTML carried loading skeletons
 * in every pagination mode. The build now fetches page 1 by the sort a visitor
 * starts with, and the list shows those rows while the sort is still there.
 */

// tslint:disable:no-any

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

const runPagePlugin = async (
  repeater: RepeaterOptions,
  // `null`: the page declares no state, so the build cannot know the sort.
  stateDefinitions: Record<string, UIDLStateDefinition> | null = SORT_DROPDOWN
) => {
  const chunk = makeWidgetComponentChunk({ controls: ['previous', 'next', 'load-more'] })
  const staticPropsChunk = makeGetStaticPropsChunk()
  const structure: ComponentStructure = {
    uidl: {
      name: 'ProductsList',
      node: makeUidlNode({ ...STORE_SORT, ...repeater }),
      ...(stateDefinitions ? { stateDefinitions } : {}),
    },
    chunks: [chunk, staticPropsChunk],
    dependencies: {},
    options: { dataSources: {}, extractedResources: {} },
  } as never
  await createNextArrayMapperPaginationPlugin()(structure)
  return {
    component: collapse(generator(chunk.content as types.Node).code),
    staticProps: collapse(generator(staticPropsChunk.content as types.Node).code),
    chunk,
    staticPropsChunk,
  }
}

const categoryFilter = {
  type: 'condition',
  source: 'category',
  destination: { type: 'dynamic', content: { referenceType: 'state', id: 'selectedCategory' } },
  operand: '=',
}

describe('readSortStateDefaults', () => {
  const sortOf = (sort: string, direction?: string) =>
    extractDynamicSort(
      { type: 'expr', content: sort },
      direction ? { type: 'expr', content: direction } : undefined
    )!

  it('reads the dropdown state the store sort starts at', () => {
    const sort = sortOf(STORE_SORT.sort.content, STORE_SORT.sortDirection.content)
    expect(readSortStateDefaults(sort, SORT_DROPDOWN)).toEqual([
      { binding: 'sortBy', value: 'name-asc' },
    ])
  })

  it('reads a column state and a direction state, as the admin tables bind them', () => {
    const sort = sortOf(`usersSortColumn || ''`, `usersSortDirection || ''`)
    expect(
      readSortStateDefaults(sort, {
        usersSortColumn: { type: 'string', defaultValue: 'created_at' },
        usersSortDirection: { type: 'string', defaultValue: 'desc' },
      })
    ).toEqual([
      { binding: 'usersSortColumn', value: 'created_at' },
      { binding: 'usersSortDirection', value: 'desc' },
    ])
  })

  it('cannot know a sort that reads anything but a state starting at a fixed value', () => {
    const states: Record<string, UIDLStateDefinition> = {
      ...SORT_DROPDOWN,
      seeded: {
        type: 'string',
        defaultValue: 'name',
        dataSourceBinding: { dataSourceId: 'ds1' } as never,
      },
      picked: { type: 'array', defaultValue: ['name'] },
    }
    // A prop, the browser, an undeclared name, a state seeded from data, a
    // state that is not a single value.
    expect(readSortStateDefaults(sortOf('props.sortColumn'), states)).toBeUndefined()
    expect(readSortStateDefaults(sortOf('window.sortColumn || sortBy'), states)).toBeUndefined()
    expect(readSortStateDefaults(sortOf('sortColumn'), states)).toBeUndefined()
    expect(readSortStateDefaults(sortOf('seeded'), states)).toBeUndefined()
    expect(readSortStateDefaults(sortOf('picked[0]'), states)).toBeUndefined()
    expect(readSortStateDefaults(sortOf(STORE_SORT.sort.content), undefined)).toBeUndefined()
  })

  it('takes a sort that reads nothing as never moving', () => {
    expect(readSortStateDefaults(sortOf(`('name')`, `('desc')`), SORT_DROPDOWN)).toEqual([])
  })
})

describe('a list sorted by a dropdown, on a page', () => {
  it('fetches its first page at build time by the sort a visitor starts with', async () => {
    const { staticProps } = await runPagePlugin({ searchEnabled: true })

    // The browser's own sort expression, with the dropdown at its default —
    // not a copy of what the default means.
    expect(staticProps).toContain(
      `postgresqlProductsDs1.fetchData({ page: 1, perPage: 20, queryColumns: JSON.stringify(["name"]), sorts: ${STARTING_SORTS} }, { as: "visitor" })`
    )
  })

  it('shows those rows on page 1 while the sort, the search and the filter are untouched', async () => {
    const { component } = await runPagePlugin({ searchEnabled: true, filters: [categoryFilter] })

    expect(component).toContain(
      'initialData={ds_0_state.page === 1 && !ds_0_state.debouncedQuery && sortBy === "name-asc" && !selectedCategory ? props?.items_ds_0 : undefined}'
    )
  })

  it('does the same for a list without search', async () => {
    const { component, staticProps } = await runPagePlugin({})

    expect(staticProps).toContain(`sorts: ${STARTING_SORTS}`)
    expect(component).toContain(
      'initialData={ds_0_page === 1 && sortBy === "name-asc" ? props?.items_ds_0 : undefined}'
    )
  })

  it('and for a search list that does not page', async () => {
    const { component, staticProps } = await runPagePlugin({
      paginated: false,
      searchEnabled: true,
    })

    expect(staticProps).toContain(`sorts: ${STARTING_SORTS}`)
    expect(component).toContain(
      'initialData={!ds_0_debouncedQuery && sortBy === "name-asc" ? props?.items_ds_0 : undefined}'
    )
  })

  it('starts an infinite-scroll list from them, frozen, while the sort is untouched', async () => {
    const { component, staticProps } = await runPagePlugin({ infiniteScroll: true })

    expect(staticProps).toContain(`sorts: ${STARTING_SORTS}`)
    expect(component).toContain('initialData={ds_0_firstPage}')
    expect(component).toContain(
      'const ds_0_firstPage = useMemo(() => sortBy === "name-asc" && props?.items_ds_0?.length > 0 ? props?.items_ds_0 : undefined, [])'
    )
    // Filed as page 1 under the signature fetchData computes from the same
    // params, so page 2 appends to them.
    expect(component).toContain('const sig = JSON.stringify({ ...ds_0_params, page: 0 })')
  })

  it('declares the frozen first page below the sort state it reads', async () => {
    // The dropdown's state as the component plugin declares it, at the top of
    // the body; the first page reads it while rendering.
    const chunk = makeWidgetComponentChunk({ controls: ['load-more'] })
    const body = (
      (chunk.content as types.VariableDeclaration).declarations[0]
        .init as types.ArrowFunctionExpression
    ).body as types.BlockStatement
    body.body.unshift(
      types.variableDeclaration('const', [
        types.variableDeclarator(
          types.arrayPattern([types.identifier('sortBy'), types.identifier('setSortBy')]),
          types.callExpression(types.identifier('useState'), [types.stringLiteral('name-asc')])
        ),
      ])
    )
    const structure: ComponentStructure = {
      uidl: {
        name: 'ProductsList',
        node: makeUidlNode({ ...STORE_SORT, infiniteScroll: true }),
        stateDefinitions: SORT_DROPDOWN,
      },
      chunks: [chunk, makeGetStaticPropsChunk()],
      dependencies: {},
      options: { dataSources: {}, extractedResources: {} },
    } as never
    await createNextArrayMapperPaginationPlugin()(structure)
    const code = collapse(generator(chunk.content as types.Node).code)

    expect(code.indexOf('const [sortBy, setSortBy] = useState("name-asc")')).toBeGreaterThan(-1)
    expect(code.indexOf('const [sortBy, setSortBy]')).toBeLessThan(
      code.indexOf('const ds_0_firstPage =')
    )
  })

  it('starts a Load more list from them too, per query', async () => {
    const { component } = await runPagePlugin({
      infiniteScroll: true,
      infiniteScrollLoadMore: true,
      searchEnabled: true,
    })

    expect(component).toContain(
      'const ds_0_firstPage = useMemo(() => !ds_0_state.debouncedQuery && sortBy === "name-asc" && props?.items_ds_0?.length > 0 ? props?.items_ds_0 : undefined, [ds_0_state.debouncedQuery])'
    )
    expect(component).toContain('initialData={ds_0_firstPage}')
  })

  it('keeps fetching page 1 in the browser when the build cannot know the starting sort', async () => {
    for (const repeater of [{ searchEnabled: true }, { infiniteScroll: true }]) {
      const { component, staticProps } = await runPagePlugin(repeater, null)
      expect(component).not.toContain('initialData')
      expect(staticProps).not.toContain('sorts:')
    }
  })
})

/**
 * Executed: what the build fetches and what the browser asks for next must be
 * one ordering of one row set, page after page.
 */
describe('the first page and the next, run', () => {
  // What getStaticProps hands fetchData: `{ page: 1, perPage: 20, …, sorts }`,
  // then who it reads for.
  const buildTimeArguments = (staticPropsChunk: any): Array<Record<string, unknown>> => {
    let call: types.CallExpression | undefined
    types.traverseFast(staticPropsChunk.content, (node) => {
      if (
        !call &&
        node.type === 'CallExpression' &&
        node.callee.type === 'MemberExpression' &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'fetchData' &&
        node.arguments[0]?.type === 'ObjectExpression'
      ) {
        call = node
      }
    })
    const args = call!.arguments.map((arg) => generator(arg as types.Node).code)
    return new Function(`return [${args.join(', ')}]`)()
  }
  const buildTimeParams = (staticPropsChunk: any): Record<string, unknown> =>
    buildTimeArguments(staticPropsChunk)[0]

  // The provider's params as the browser computes them, for the given state.
  const browserParams = (chunk: any, state: Record<string, unknown>): Record<string, string> => {
    let memo: types.Expression | undefined
    types.traverseFast(chunk.content, (node) => {
      if (
        !memo &&
        node.type === 'JSXAttribute' &&
        node.name.name === 'params' &&
        node.value?.type === 'JSXExpressionContainer' &&
        node.value.expression.type === 'CallExpression'
      ) {
        const arrow = node.value.expression.arguments[0]
        if (arrow?.type === 'ArrowFunctionExpression') {
          memo = arrow.body as types.Expression
        }
      }
    })
    const names = Object.keys(state)
    const params = new Function(...names, `return (${generator(memo!).code})`)(
      ...names.map((name) => state[name])
    )
    // What `new URLSearchParams(params)` puts on the wire.
    return Object.fromEntries(new URLSearchParams(params))
  }

  it('sends the build and the browser one sort string while the dropdown is untouched', async () => {
    const { staticPropsChunk, chunk } = await runPagePlugin({ searchEnabled: true })
    const atBuild = buildTimeParams(staticPropsChunk)
    const inBrowser = browserParams(chunk, {
      ds_0_state: { page: 2, debouncedQuery: '' },
      sortBy: 'name-asc',
    })

    expect(atBuild.sorts).toBe('[{"field":"name","order":"asc"}]')
    expect(inBrowser.sorts).toBe(atBuild.sorts)
    // Any other pick is another query, fetched fresh.
    expect(
      browserParams(chunk, { ds_0_state: { page: 1, debouncedQuery: '' }, sortBy: 'price-desc' })
        .sorts
    ).toBe('[{"field":"price","order":"desc"}]')
  })

  /**
   * The products route as the project ships it, over a database that records
   * the statements it is sent.
   */
  const bootProductsRoute = () => {
    const dataSource = {
      id: 'ds-1',
      name: 'db',
      type: 'teleport',
      config: {
        host: 'teleporthq.secrets.TELEPORT_DB_HOST',
        port: 5432,
        user: 'teleporthq.secrets.TELEPORT_DB_USER',
        password: 'teleporthq.secrets.TELEPORT_DB_PASSWORD',
        database: 'teleporthq.secrets.TELEPORT_DB_NAME',
        selectedTables: { teleport_products: { columns: [{ name: 'id', type: 'uuid' }] } },
      },
    }
    const code = generateDataSourceFetcherWithCore(dataSource as never, 'teleport_products')
      .replace(
        "import { Client, types as pgTypes } from 'pg'",
        "const { Client, types: pgTypes } = require('pg')"
      )
      .replace(/^export \{[^}]*\}\s*$/m, '')
      .replace(/^export default \{[^}]*\}\s*$/m, '')
      .concat('\nmodule.exports = { handler: handler, fetchData: fetchData }')
    expect(code).not.toMatch(/^(export|import) /m)

    const statements: string[] = []
    class FakeClient {
      public async connect(): Promise<void> {
        return
      }
      public async end(): Promise<void> {
        return
      }
      public async query(sql: string): Promise<any> {
        statements.push(sql)
        return { rows: [], rowCount: 0 }
      }
    }
    const fakeRequire = (name: string): any => {
      if (name === 'pg') {
        return { Client: FakeClient }
      }
      if (name === 'next-auth/jwt') {
        return { getToken: async () => null }
      }
      throw new Error('unexpected require: ' + name)
    }
    const moduleObj: { exports: any } = { exports: {} }
    new Function('require', 'module', 'exports', 'process', 'console', code)(
      fakeRequire,
      moduleObj,
      moduleObj.exports,
      {
        env: {
          NEXTAUTH_SECRET: 'secret',
          TELEPORT_DB_HOST: 'h',
          TELEPORT_DB_USER: 'u',
          TELEPORT_DB_PASSWORD: 'p',
          TELEPORT_DB_NAME: 'd',
        },
      },
      { error: () => undefined, warn: () => undefined, log: () => undefined }
    )
    const lastSelect = (): string =>
      statements.filter((sql) => /^\s*SELECT \* FROM/i.test(sql)).pop() || ''
    return {
      atBuild: async (args: Array<Record<string, unknown>>) => {
        await moduleObj.exports.fetchData(...args)
        return lastSelect()
      },
      inBrowser: async (query: Record<string, string>) => {
        const res = { status: () => res, json: () => res, setHeader: () => res }
        await moduleObj.exports.handler({ method: 'GET', query, headers: {} }, res)
        return lastSelect()
      },
    }
  }

  const orderBy = (sql: string): string => (sql.match(/ ORDER BY .*? LIMIT/) || [''])[0]
  const rowWindow = (sql: string): string => (sql.match(/ LIMIT \d+( OFFSET \d+)?$/) || [''])[0]

  it('orders page 1 at build time exactly as the browser orders page 2', async () => {
    const { staticPropsChunk, chunk } = await runPagePlugin({ searchEnabled: true })
    const route = bootProductsRoute()

    const firstPage = await route.atBuild(buildTimeArguments(staticPropsChunk))
    const secondPage = await route.inBrowser(
      browserParams(chunk, { ds_0_state: { page: 2, debouncedQuery: '' }, sortBy: 'name-asc' })
    )

    // The same columns, rows without a value last, the row's id breaking ties.
    expect(orderBy(firstPage)).toBe(' ORDER BY name ASC NULLS LAST, "id" ASC LIMIT')
    expect(orderBy(secondPage)).toBe(orderBy(firstPage))
    // Page 2 starts where page 1 ends.
    expect(rowWindow(firstPage)).toBe(' LIMIT 20 OFFSET 0')
    expect(rowWindow(secondPage)).toBe(' LIMIT 20 OFFSET 20')
    // Over the same rows: the products a visitor is served, never a draft the
    // build could read as the store.
    expect(firstPage).toContain("WHERE (LOWER(TRIM(status)) = 'active')")
    expect(firstPage.replace(/ OFFSET \d+$/, '')).toBe(secondPage.replace(/ OFFSET \d+$/, ''))
  })
})
