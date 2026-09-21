import * as types from '@babel/types'
import { setJSXExpressionAttribute } from './pagination-controls'

/**
 * The "clear search" button a listing's search field carries — marked
 * `data-tq-search-clear` by the editor (`listing-search-field.ts`), the same
 * marker the canvas renderer acts on. The search keyword is the mapper's own
 * React state, which no authored workflow can reach, so the generator wires
 * the button here: a click empties the query, and the button renders only
 * while the query is non-empty.
 *
 * A button belongs to the search input it shares a parent with — the field
 * wrapper — never to "the next search-enabled mapper": a page with two lists
 * and one clear button would otherwise wire it to the wrong list.
 */

export const SEARCH_CLEAR_ATTR = 'data-tq-search-clear'

// tslint:disable:no-any

export interface SearchClearButton {
  node: any
  parent: any
  index: number
}

function hasSearchClearMarker(node: any): boolean {
  return !!node?.openingElement?.attributes?.some(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name?.name === SEARCH_CLEAR_ATTR
  )
}

/** Every marked button under `root`, with the JSX parent and child index it sits at. */
export function findAllSearchClearButtonsInJSX(root: any): SearchClearButton[] {
  const results: SearchClearButton[] = []
  const traverse = (node: any): void => {
    if (!node) {
      return
    }
    if (node.type === 'JSXElement' && Array.isArray(node.children)) {
      node.children.forEach((child: any, index: number) => {
        if (child?.type === 'JSXElement' && hasSearchClearMarker(child)) {
          results.push({ node: child, parent: node, index })
        }
        traverse(child)
      })
      return
    }
    if (node.body) {
      if (Array.isArray(node.body)) {
        node.body.forEach((statement: any) => traverse(statement))
      } else {
        traverse(node.body)
      }
    }
    if (node.consequent) {
      traverse(node.consequent)
    }
    if (node.alternate) {
      traverse(node.alternate)
    }
    if (node.expression) {
      traverse(node.expression)
    }
    if (node.argument) {
      traverse(node.argument)
    }
  }
  traverse(root)
  return results
}

/** The search input the button shares its parent with, or null. */
export function findSiblingSearchInput(button: SearchClearButton, searchInputs: any[]): any | null {
  const siblings: any[] = button.parent.children ?? []
  return siblings.find((sibling) => searchInputs.includes(sibling)) ?? null
}

/**
 * Wires one button: `onClick` empties the query, and the element is replaced
 * in its parent by `{query ? <button…/> : null}`.
 */
export function wireSearchClearButton(
  button: SearchClearButton,
  vars: { searchQueryVar: string; setSearchQueryVar: string }
): void {
  setJSXExpressionAttribute(
    button.node,
    'onClick',
    types.arrowFunctionExpression(
      [],
      types.callExpression(types.identifier(vars.setSearchQueryVar), [types.stringLiteral('')])
    )
  )
  button.parent.children[button.index] = types.jsxExpressionContainer(
    types.conditionalExpression(
      types.identifier(vars.searchQueryVar),
      button.node,
      types.nullLiteral()
    )
  )
}
