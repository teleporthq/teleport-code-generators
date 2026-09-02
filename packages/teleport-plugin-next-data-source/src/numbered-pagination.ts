import * as types from '@babel/types'
import {
  convertControlToButton,
  findPaginationControl,
  setJSXExpressionAttribute,
} from './pagination-controls'

/**
 * Numbered pagination: First / Prev / 1 … 4 5 6 … 12 / Next / Last.
 *
 * The builder authors ONE page-number button and a container to repeat it into;
 * this module turns that template into a `.map` over a windowed token list, so
 * every number the visitor sees is the author's own styled node rather than
 * something the generator invented.
 */

// tslint:disable:no-any

/** `ds_N_pageTokens` — the windowed list of page numbers and ellipsis markers. */
export const getPageTokensVar = (index: number): string => `ds_${index}_pageTokens`

/**
 * Builds the `useMemo` that decides which page numbers are visible.
 *
 * The window is deliberately small and fixed (first, last, and one neighbour
 * either side of the current page, so at most seven entries): an unbounded
 * strip is unusable at 300 pages and wraps the layout the author styled. The
 * two ellipsis markers are distinct strings because React needs unique keys and
 * a list can legitimately need a gap on both sides.
 *
 * ⛔ Keep this in step with `computePageWindow` in the editor's renderer — the
 * canvas and the published page must agree on which numbers are shown, or the
 * author styles a strip they will never see.
 */
export const buildPageTokensDeclaration = (
  index: number,
  maxPagesVar: string,
  currentPageExpr: types.Expression
): types.VariableDeclaration => {
  const total = types.identifier('total')
  const current = types.identifier('current')
  const tokens = types.identifier('tokens')
  const start = types.identifier('start')
  const end = types.identifier('end')
  const pageVar = types.identifier('p')

  const body = types.blockStatement([
    types.variableDeclaration('const', [
      types.variableDeclarator(total, types.identifier(maxPagesVar)),
    ]),
    types.variableDeclaration('const', [
      types.variableDeclarator(current, types.cloneNode(currentPageExpr, true) as types.Expression),
    ]),
    // Nothing matched at all — the empty branch of the list is what renders.
    types.ifStatement(
      types.binaryExpression('<=', types.cloneNode(total, true), types.numericLiteral(0)),
      types.returnStatement(types.arrayExpression([]))
    ),
    types.ifStatement(
      types.binaryExpression('===', types.cloneNode(total, true), types.numericLiteral(1)),
      types.returnStatement(types.arrayExpression([types.numericLiteral(1)]))
    ),
    types.variableDeclaration('const', [
      types.variableDeclarator(tokens, types.arrayExpression([types.numericLiteral(1)])),
    ]),
    types.variableDeclaration('const', [
      types.variableDeclarator(
        start,
        types.callExpression(
          types.memberExpression(types.identifier('Math'), types.identifier('max')),
          [
            types.numericLiteral(2),
            types.binaryExpression('-', types.cloneNode(current, true), types.numericLiteral(1)),
          ]
        )
      ),
    ]),
    types.variableDeclaration('const', [
      types.variableDeclarator(
        end,
        types.callExpression(
          types.memberExpression(types.identifier('Math'), types.identifier('min')),
          [
            types.binaryExpression('-', types.cloneNode(total, true), types.numericLiteral(1)),
            types.binaryExpression('+', types.cloneNode(current, true), types.numericLiteral(1)),
          ]
        )
      ),
    ]),
    types.ifStatement(
      types.binaryExpression('>', types.cloneNode(start, true), types.numericLiteral(2)),
      types.expressionStatement(
        types.callExpression(
          types.memberExpression(types.cloneNode(tokens, true), types.identifier('push')),
          [types.stringLiteral('start-ellipsis')]
        )
      )
    ),
    types.forStatement(
      types.variableDeclaration('let', [
        types.variableDeclarator(pageVar, types.cloneNode(start, true)),
      ]),
      types.binaryExpression('<=', types.cloneNode(pageVar, true), types.cloneNode(end, true)),
      types.assignmentExpression('+=', types.cloneNode(pageVar, true), types.numericLiteral(1)),
      types.expressionStatement(
        types.callExpression(
          types.memberExpression(types.cloneNode(tokens, true), types.identifier('push')),
          [types.cloneNode(pageVar, true)]
        )
      )
    ),
    types.ifStatement(
      types.binaryExpression(
        '<',
        types.cloneNode(end, true),
        types.binaryExpression('-', types.cloneNode(total, true), types.numericLiteral(1))
      ),
      types.expressionStatement(
        types.callExpression(
          types.memberExpression(types.cloneNode(tokens, true), types.identifier('push')),
          [types.stringLiteral('end-ellipsis')]
        )
      )
    ),
    types.expressionStatement(
      types.callExpression(
        types.memberExpression(types.cloneNode(tokens, true), types.identifier('push')),
        [types.cloneNode(total, true)]
      )
    ),
    types.returnStatement(types.cloneNode(tokens, true)),
  ])

  return types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier(getPageTokensVar(index)),
      types.callExpression(types.identifier('useMemo'), [
        types.arrowFunctionExpression([], body),
        types.arrayExpression([
          types.identifier(maxPagesVar),
          types.cloneNode(currentPageExpr, true) as types.Expression,
        ]),
      ])
    ),
  ])
}

export interface NumberedPaginationVars {
  index: number
  maxPagesVar: string
  /** How this usage reads its current page (`ds_N_state.page` or `ds_N_page`). */
  currentPageExpr: () => types.Expression
  /** How it writes a page number back. */
  buildSetPageStatement: (pageExpr: types.Expression) => types.Expression
}

/** `<setter>(<page>)` wrapped so an already-current page does not re-render. */
const buildJumpHandler = (
  vars: NumberedPaginationVars,
  targetExpr: types.Expression
): types.Expression => types.arrowFunctionExpression([], vars.buildSetPageStatement(targetExpr))

/**
 * Wires the First / Last buttons and expands the page-number template.
 *
 * Prev / Next are left to `wirePaginationButtons`, which already emits them and
 * whose output must stay byte-identical for every project that never switches
 * mode.
 */
export const wireNumberedPagination = (paginationNode: any, vars: NumberedPaginationVars): void => {
  const firstButton = findPaginationControl(paginationNode, 'first')
  const lastButton = findPaginationControl(paginationNode, 'last')
  const pagesContainer = findPaginationControl(paginationNode, 'pages')

  if (firstButton) {
    convertControlToButton(firstButton)
    setJSXExpressionAttribute(
      firstButton,
      'onClick',
      buildJumpHandler(vars, types.numericLiteral(1))
    )
    setJSXExpressionAttribute(
      firstButton,
      'disabled',
      types.binaryExpression('<=', vars.currentPageExpr(), types.numericLiteral(1))
    )
  }

  if (lastButton) {
    convertControlToButton(lastButton)
    setJSXExpressionAttribute(
      lastButton,
      'onClick',
      buildJumpHandler(vars, types.identifier(vars.maxPagesVar))
    )
    // `maxPages === 0` is "no results", where jumping to the last page would
    // mean jumping to page 0.
    setJSXExpressionAttribute(
      lastButton,
      'disabled',
      types.logicalExpression(
        '||',
        types.binaryExpression('===', types.identifier(vars.maxPagesVar), types.numericLiteral(0)),
        types.binaryExpression('>=', vars.currentPageExpr(), types.identifier(vars.maxPagesVar))
      )
    )
  }

  if (!pagesContainer) {
    return
  }

  const template = findPaginationControl(pagesContainer, 'page')
  if (!template) {
    // A container with no template to repeat: leave whatever the author put
    // there alone rather than inventing an unstyled strip.
    return
  }

  const ellipsisTemplate = findPaginationControl(pagesContainer, 'ellipsis')
  const tokenId = types.identifier('token')

  // The author's own button, cloned per visible page: their class name (and so
  // every style they applied) rides along.
  const numberButton = types.cloneNode(template, true) as any
  convertControlToButton(numberButton)
  setJSXExpressionAttribute(
    numberButton,
    'onClick',
    buildJumpHandler(vars, types.cloneNode(tokenId, true))
  )
  // The current page is marked, not disabled: `[aria-current='page']` is
  // styleable and keeps the button reachable for screen readers.
  setJSXExpressionAttribute(
    numberButton,
    'aria-current',
    types.conditionalExpression(
      types.binaryExpression('===', vars.currentPageExpr(), types.cloneNode(tokenId, true)),
      types.stringLiteral('page'),
      types.identifier('undefined')
    )
  )
  setJSXExpressionAttribute(
    numberButton,
    'key',
    types.templateLiteral(
      [
        types.templateElement({ raw: 'page-', cooked: 'page-' }),
        types.templateElement({ raw: '', cooked: '' }, true),
      ],
      [types.cloneNode(tokenId, true)]
    )
  )
  // Whatever label the template carried ('1') is replaced by the real number.
  numberButton.children = [types.jsxExpressionContainer(types.cloneNode(tokenId, true))]

  const gapNode = ellipsisTemplate
    ? (types.cloneNode(ellipsisTemplate, true) as any)
    : types.jsxElement(
        types.jsxOpeningElement(types.jsxIdentifier('span'), [], false),
        types.jsxClosingElement(types.jsxIdentifier('span')),
        [types.jsxText('…')],
        false
      )
  setJSXExpressionAttribute(gapNode, 'key', types.cloneNode(tokenId, true))

  // {ds_N_pageTokens.map(token => typeof token === 'number' ? <button…> : <span…>)}
  pagesContainer.children = [
    types.jsxExpressionContainer(
      types.callExpression(
        types.memberExpression(
          types.identifier(getPageTokensVar(vars.index)),
          types.identifier('map')
        ),
        [
          types.arrowFunctionExpression(
            [types.cloneNode(tokenId, true)],
            types.conditionalExpression(
              types.binaryExpression(
                '===',
                types.unaryExpression('typeof', types.cloneNode(tokenId, true)),
                types.stringLiteral('number')
              ),
              numberButton,
              gapNode
            )
          ),
        ]
      )
    ),
  ]
}
