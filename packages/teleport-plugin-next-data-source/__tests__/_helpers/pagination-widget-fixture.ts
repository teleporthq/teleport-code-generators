import * as types from '@babel/types'
import { ChunkType, FileType, ChunkDefinition } from '@teleporthq/teleport-types'
import {
  PAGINATION_CONTROL_ATTR,
  PAGINATION_FOR_ATTR,
  RANGE_TEMPLATE_ATTR,
} from '../../src/pagination-controls'
import { SEARCH_FOR_ATTR } from '../../src/search-input'

/**
 * A component shell carrying a `DataProvider` and the pagination controls a
 * builder would have authored, so the wiring steps of the plugin have something
 * real to find.
 *
 * `__tests__/_helpers` is excluded from the jest test match, so this file is a
 * fixture rather than a suite.
 */

// tslint:disable:no-any

interface ControlOptions {
  /** Which `data-tq-pagination-control` markers to author. */
  controls: string[]
  /** Author Previous/Next with only the legacy class names, no markers. */
  legacyOnly?: boolean
  /** Number of DataProvider + widget pairs to emit (order-based zip coverage). */
  mappers?: number
  /** The element the providers render in: a table's body, a list. */
  rootTag?: string
  /**
   * The `data-tq-range-template` of a `range` control in the widget. Defaults
   * to the "Showing" wording; `null` authors the control with no template.
   */
  rangeTemplate?: string | null
  /**
   * A `range` text OUTSIDE every widget, placed BEFORE the first provider (a
   * toolbar above the list), naming its mapper with `data-tq-pagination-for`.
   */
  standaloneRange?: { forNodeId: string; template?: string }
  /**
   * Search inputs OUTSIDE every widget, placed BEFORE the first provider, in
   * this order: a page's own box naming its mapper with `data-tq-search-for`,
   * or the platform's (`search-input` class) paired by order.
   */
  standaloneSearch?: Array<{ forNodeId?: string; name: string }>
}

// ASCII hyphen on purpose: the generator prints string literals through jsesc,
// which would turn an en dash into `–` and make every assertion unreadable.
export const RANGE_DRAWN_TEXT = 'Showing 1-8 of 12'
export const RANGE_TEMPLATE = 'Showing {from}–{to} of {total}'

const control = (
  marker: string,
  children: types.JSXElement['children'] = [],
  extraAttrs: Array<[string, string]> = []
): types.JSXElement =>
  types.jsxElement(
    types.jsxOpeningElement(
      types.jsxIdentifier('div'),
      [
        types.jsxAttribute(
          types.jsxIdentifier('className'),
          types.stringLiteral(`thq-${marker}-elm`)
        ),
        types.jsxAttribute(
          types.jsxIdentifier(PAGINATION_CONTROL_ATTR),
          types.stringLiteral(marker)
        ),
        ...extraAttrs.map(([name, value]) =>
          types.jsxAttribute(types.jsxIdentifier(name), types.stringLiteral(value))
        ),
      ],
      false
    ),
    types.jsxClosingElement(types.jsxIdentifier('div')),
    children,
    false
  )

const rangeControl = (
  template: string | null | undefined,
  forNodeId?: string
): types.JSXElement => {
  const attrs: Array<[string, string]> = []
  if (template !== null) {
    attrs.push([RANGE_TEMPLATE_ATTR, template ?? RANGE_TEMPLATE])
  }
  if (forNodeId) {
    attrs.push([PAGINATION_FOR_ATTR, forNodeId])
  }
  return control('range', [types.jsxText(RANGE_DRAWN_TEXT)], attrs)
}

const searchInput = (name: string, forNodeId?: string): types.JSXElement =>
  types.jsxElement(
    types.jsxOpeningElement(
      types.jsxIdentifier('input'),
      [
        types.jsxAttribute(types.jsxIdentifier('name'), types.stringLiteral(name)),
        forNodeId
          ? types.jsxAttribute(types.jsxIdentifier(SEARCH_FOR_ATTR), types.stringLiteral(forNodeId))
          : types.jsxAttribute(
              types.jsxIdentifier('className'),
              types.stringLiteral('products-list-search-input')
            ),
      ],
      true
    ),
    null,
    [],
    true
  )

const legacyControl = (direction: 'previous' | 'next'): types.JSXElement =>
  types.jsxElement(
    types.jsxOpeningElement(
      types.jsxIdentifier('div'),
      [
        types.jsxAttribute(
          types.jsxIdentifier('className'),
          types.stringLiteral(`products-list-thq-${direction}-elm`)
        ),
      ],
      false
    ),
    types.jsxClosingElement(types.jsxIdentifier('div')),
    [types.jsxText(direction === 'previous' ? 'Previous' : 'Next')],
    false
  )

const buildWidget = (options: ControlOptions): types.JSXElement => {
  const children: types.JSXElement[] = []
  for (const marker of options.controls) {
    if (marker === 'pages') {
      // The container holds ONE template button, which the generator repeats.
      children.push(control('pages', [control('page', [types.jsxText('1')])]))
      continue
    }
    if (options.legacyOnly && (marker === 'previous' || marker === 'next')) {
      children.push(legacyControl(marker))
      continue
    }
    if (marker === 'range') {
      children.push(rangeControl(options.rangeTemplate))
      continue
    }
    children.push(control(marker))
  }

  return types.jsxElement(
    types.jsxOpeningElement(
      types.jsxIdentifier('div'),
      [
        types.jsxAttribute(
          types.jsxIdentifier('className'),
          types.stringLiteral('products-list-cms-pagination-node')
        ),
      ],
      false
    ),
    types.jsxClosingElement(types.jsxIdentifier('div')),
    children,
    false
  )
}

// Mirrors the real emitted shape: a self-closing `<DataProvider>` whose
// `renderSuccess` returns a `<Repeater renderItem={row => …}>`. The plugin only
// treats a provider as an array mapper when it can read that `renderItem`
// parameter name, so the fixture must carry one.
const buildDataProvider = (name: string, rowIdentifier: string): types.JSXElement =>
  types.jsxElement(
    types.jsxOpeningElement(
      types.jsxIdentifier('DataProvider'),
      [
        types.jsxAttribute(
          types.jsxIdentifier('name'),
          types.jsxExpressionContainer(types.stringLiteral(name))
        ),
        types.jsxAttribute(
          types.jsxIdentifier('renderSuccess'),
          types.jsxExpressionContainer(
            types.arrowFunctionExpression(
              [types.identifier('items')],
              types.jsxElement(
                types.jsxOpeningElement(
                  types.jsxIdentifier('Repeater'),
                  [
                    types.jsxAttribute(
                      types.jsxIdentifier('renderItem'),
                      types.jsxExpressionContainer(
                        types.arrowFunctionExpression(
                          [types.identifier(rowIdentifier)],
                          types.jsxElement(
                            types.jsxOpeningElement(types.jsxIdentifier('div'), [], true),
                            null,
                            [],
                            true
                          )
                        )
                      )
                    ),
                  ],
                  true
                ),
                null,
                [],
                true
              )
            )
          )
        ),
      ],
      true
    ),
    null,
    [],
    true
  )

export const makeWidgetComponentChunk = (options: ControlOptions): ChunkDefinition => {
  const sections: types.JSXElement[] = []
  if (options.standaloneRange) {
    sections.push(rangeControl(options.standaloneRange.template, options.standaloneRange.forNodeId))
  }
  for (const search of options.standaloneSearch ?? []) {
    sections.push(searchInput(search.name, search.forNodeId))
  }
  const mappers = options.mappers ?? 1
  for (let i = 0; i < mappers; i += 1) {
    const identifier = `items${i === 0 ? '' : i}`
    sections.push(buildDataProvider(identifier, `${identifier}_row`))
    sections.push(buildWidget(options))
  }

  const rootTag = options.rootTag ?? 'div'
  const root = types.jsxElement(
    types.jsxOpeningElement(types.jsxIdentifier(rootTag), [], false),
    types.jsxClosingElement(types.jsxIdentifier(rootTag)),
    sections,
    false
  )

  return {
    name: 'jsx-component',
    type: ChunkType.AST,
    fileType: FileType.JS,
    linkAfter: [],
    content: types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('TestComponent'),
        types.arrowFunctionExpression(
          [types.identifier('props')],
          types.blockStatement([types.returnStatement(root)])
        )
      ),
    ]),
    meta: {},
  }
}

export interface RepeaterOptions {
  paginated?: boolean
  searchEnabled?: boolean
  paginationMode?: 'buttons' | 'numbered'
  infiniteScroll?: boolean
  infiniteScrollLoadMore?: boolean
  perPage?: number
  /** The list's filters, as the inspector authors them (conditions and groups). */
  filters?: unknown[]
  /** The mapper's editor node id, as the UIDL carries it on the repeater. */
  nodeId?: string
  /** The repeater's sort and direction as the UIDL carries them: a static column, or an expression. */
  sort?: unknown
  sortDirection?: unknown
  /** The repeater's cache config. */
  cache?: unknown
  /** The repeater's `source`, for a list bound inside the payload (with `dataSourceType`). */
  source?: string
  dataSourceType?: string
}

export const makeUidlNode = (options: RepeaterOptions, identifier: string = 'items'): any => ({
  type: 'data-source-list',
  content: {
    renderPropIdentifier: identifier,
    resourceDefinition: {
      dataSourceId: 'ds1',
      tableName: 'products',
      dataSourceType: options.dataSourceType ?? 'postgresql',
    },
    resource: {
      params: {
        queryColumns: { content: ['name'] },
        ...(options.filters ? { filters: { type: 'static', content: options.filters } } : {}),
      },
    },
    nodes: {
      success: {
        type: 'cms-list-repeater',
        content: {
          renderPropIdentifier: `${identifier}_row`,
          paginated: options.paginated !== false,
          perPage: options.perPage ?? 20,
          searchEnabled: !!options.searchEnabled,
          searchDebounce: 300,
          ...(options.paginationMode ? { paginationMode: options.paginationMode } : {}),
          ...(options.infiniteScroll ? { infiniteScroll: true } : {}),
          ...(options.infiniteScrollLoadMore ? { infiniteScrollLoadMore: true } : {}),
          ...(options.nodeId ? { nodeId: options.nodeId } : {}),
          ...(options.sort ? { sort: options.sort } : {}),
          ...(options.sortDirection ? { sortDirection: options.sortDirection } : {}),
          ...(options.cache ? { cache: options.cache } : {}),
          ...(options.source ? { source: options.source } : {}),
          nodes: { list: { type: 'element', content: { elementType: 'div' } } },
        },
      },
    },
  },
})

/** Wraps several data-source-lists in one element node, as a page would. */
export const makeMultiMapperUidl = (repeaters: RepeaterOptions[]): any => ({
  type: 'element',
  content: {
    elementType: 'container',
    children: repeaters.map((options, index) =>
      makeUidlNode(options, `items${index === 0 ? '' : index}`)
    ),
  },
})

/**
 * The page's `getStaticProps` as the main data-source plugin leaves it: a
 * `Promise.all` of prefetches and a `props` object, which the pagination plugin
 * extends with each paginated list's first page and its count. Its presence is
 * what makes the component a page.
 */
export const makeGetStaticPropsChunk = (): ChunkDefinition => ({
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
