import * as types from '@babel/types'
import generator from '@babel/generator'
import {
  ChunkDefinition,
  ChunkType,
  ComponentStructure,
  FileType,
} from '@teleporthq/teleport-types'
import { createNextArrayMapperPaginationPlugin } from '../src/pagination-plugin'
import {
  makeUidlNode,
  makeWidgetComponentChunk,
  type RepeaterOptions,
} from './_helpers/pagination-widget-fixture'

/**
 * A list filter can say "Category is Commercial OR Narrative" — an "any of"
 * group. The paginated and searchable lists used to flatten that group into a
 * flat list the fetcher joined with AND, so the published site showed the rows
 * that were BOTH Commercial and Narrative: none. The group now reaches the
 * fetcher as a group, in the browser fetch and in the build-time prefetch
 * alike, and the fetcher's own `normalizeFilterTree` honours its operator
 * (`filter-groups.test.ts`).
 */

const condition = (source: string, destination: unknown, operand = '=') => ({
  type: 'condition',
  source,
  destination,
  operand,
})

const group = (operator: 'and' | 'or', children: unknown[]) => ({
  type: 'group',
  operator,
  children,
})

const stateRef = (id: string) => ({ type: 'dynamic', content: { referenceType: 'state', id } })

const collapse = (code: string): string => code.replace(/\s+/g, ' ')

// The page's `getStaticProps` as the main data-source plugin leaves it: a
// `Promise.all` of prefetches and a `props` object, which the pagination plugin
// extends with the paginated list's first page and its count.
const makeGetStaticPropsChunk = (): ChunkDefinition => ({
  name: 'getStaticProps',
  type: ChunkType.AST,
  fileType: FileType.JS,
  linkAfter: ['jsx-component'],
  meta: {},
  content: types.exportNamedDeclaration(
    types.functionDeclaration(
      types.identifier('getStaticProps'),
      [types.identifier('context')],
      types.blockStatement([
        types.tryStatement(
          types.blockStatement([
            types.variableDeclaration('const', [
              types.variableDeclarator(
                types.arrayPattern([]),
                types.awaitExpression(
                  types.callExpression(
                    types.memberExpression(types.identifier('Promise'), types.identifier('all')),
                    [types.arrayExpression([])]
                  )
                )
              ),
            ]),
            types.returnStatement(
              types.objectExpression([
                types.objectProperty(types.identifier('props'), types.objectExpression([])),
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
        ),
      ]),
      false,
      true
    )
  ),
})

const runPlugin = async (repeater: RepeaterOptions) => {
  const chunk = makeWidgetComponentChunk({ controls: ['previous', 'next'] })
  const staticProps = makeGetStaticPropsChunk()
  const structure: ComponentStructure = {
    uidl: { name: 'TestComponent', node: makeUidlNode(repeater) },
    chunks: [chunk, staticProps],
    dependencies: {},
    options: { dataSources: {}, extractedResources: {} },
  } as never
  await createNextArrayMapperPaginationPlugin()(structure)
  return {
    component: collapse(generator(chunk.content as types.Node).code),
    staticProps: collapse(generator(staticProps.content as types.Node).code),
  }
}

const OR_GROUP = [
  group('or', [condition('Category', 'Commercial'), condition('Category', 'Narrative')]),
]

const expectOrGroup = (code: string) => {
  expect(code).toContain('type: "group"')
  expect(code).toContain('operator: "or"')
  expect(code).toContain('source: "Category", destination: "Commercial", operand: "="')
  expect(code).toContain('source: "Category", destination: "Narrative", operand: "="')
  // The two conditions sit INSIDE the group's children, never beside it.
  expect(code).toMatch(/children: \[[^\]]*Commercial[^\]]*Narrative[^\]]*\]/)
}

describe('pagination plugin — filter groups', () => {
  it('a paginated list keeps an or-group as an or-group in its browser fetch', async () => {
    const { component } = await runPlugin({ paginated: true, filters: OR_GROUP })
    expectOrGroup(component)
  })

  it('a searchable list keeps it too', async () => {
    const { component } = await runPlugin({
      paginated: true,
      searchEnabled: true,
      filters: OR_GROUP,
    })
    expectOrGroup(component)
  })

  it('the build-time prefetch and its count carry the same group', async () => {
    const { staticProps } = await runPlugin({ paginated: true, filters: OR_GROUP })
    expect(staticProps).toContain('page: 1')
    expectOrGroup(staticProps)
    // Once for the first page, once for the count.
    expect(staticProps.match(/operator: "or"/g)).toHaveLength(2)
  })

  it('the runtime drop of empty destinations lets a group through and prunes inside it', async () => {
    const { component } = await runPlugin({
      paginated: true,
      filters: [
        group('or', [
          condition('Category', 'Commercial'),
          condition('Category', stateRef('picked')),
        ]),
      ],
    })
    // Every level is filtered; the predicate keeps groups themselves.
    expect(component).toContain('__f.type === "group" ||')
    expect(component).toMatch(/children: \[.*\]\.filter\(__f =>/)
    // The state-bound leaf is still a dependency of the fetch params.
    expect(component).toContain('picked')
  })

  it('the prefetch prunes a dynamic leaf but keeps the group around its static sibling', async () => {
    const { staticProps } = await runPlugin({
      paginated: true,
      filters: [
        group('or', [
          condition('Category', 'Commercial'),
          condition('Category', stateRef('picked')),
        ]),
      ],
    })
    expect(staticProps).toContain('operator: "or"')
    expect(staticProps).toContain('destination: "Commercial"')
    expect(staticProps).not.toContain('picked')
  })

  it('a legacy flat condition list still works', async () => {
    const { component } = await runPlugin({
      paginated: true,
      filters: [{ source: 'Category', destination: 'Commercial', operand: '=' }],
    })
    expect(component).toContain('source: "Category", destination: "Commercial", operand: "="')
    expect(component).not.toContain('type: "group"')
  })
})
