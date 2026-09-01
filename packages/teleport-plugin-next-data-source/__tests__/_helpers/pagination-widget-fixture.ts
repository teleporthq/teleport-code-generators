import * as types from '@babel/types'
import { ChunkType, FileType, ChunkDefinition } from '@teleporthq/teleport-types'
import { PAGINATION_CONTROL_ATTR } from '../../src/pagination-controls'

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
}

const control = (marker: string, children: types.JSXElement['children'] = []): types.JSXElement =>
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
      ],
      false
    ),
    types.jsxClosingElement(types.jsxIdentifier('div')),
    children,
    false
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
  const mappers = options.mappers ?? 1
  for (let i = 0; i < mappers; i += 1) {
    const identifier = `items${i === 0 ? '' : i}`
    sections.push(buildDataProvider(identifier, `${identifier}_row`))
    sections.push(buildWidget(options))
  }

  const root = types.jsxElement(
    types.jsxOpeningElement(types.jsxIdentifier('div'), [], false),
    types.jsxClosingElement(types.jsxIdentifier('div')),
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
}

export const makeUidlNode = (options: RepeaterOptions, identifier: string = 'items'): any => ({
  type: 'data-source-list',
  content: {
    renderPropIdentifier: identifier,
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
          renderPropIdentifier: `${identifier}_row`,
          paginated: options.paginated !== false,
          perPage: options.perPage ?? 20,
          searchEnabled: !!options.searchEnabled,
          searchDebounce: 300,
          ...(options.paginationMode ? { paginationMode: options.paginationMode } : {}),
          ...(options.infiniteScroll ? { infiniteScroll: true } : {}),
          ...(options.infiniteScrollLoadMore ? { infiniteScrollLoadMore: true } : {}),
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
