import * as types from '@babel/types'
import { readJSXAttributeString } from './pagination-controls'

/**
 * The search inputs of a page, and the mapper each one searches.
 *
 * Two kinds exist. The platform's own `DataSourceSearchInputNode` renders with
 * a `search-input` class and is paired with a search-enabled mapper BY ORDER
 * — the first such input searches the first such mapper. A page's OWN text
 * input, kept where its author drew it, is marked `data-tq-search-for` with
 * the node id of the mapper it searches — the marker the editor writes
 * (`listing-search-field.ts`) and the canvas renderer binds by
 * (`mapper-search-registry.ts`). Marked inputs are paired by that id and
 * never take a place in the order, so a template's toolbar box beside a
 * platform listing shifts nothing.
 *
 * Both are wired the same way: controlled by the mapper's search query state,
 * which the mapper debounces into its fetch and keeps in the address.
 */

export const SEARCH_FOR_ATTR = 'data-tq-search-for'

// tslint:disable:no-any

export interface SearchInput {
  node: any
  /** The mapper node id a marked input names; undefined for a platform input paired by order. */
  forNodeId?: string
}

function isInput(node: any): boolean {
  return node?.type === 'JSXElement' && node.openingElement?.name?.name === 'input'
}

function hasSearchInputClass(node: any): boolean {
  return readJSXAttributeString(node, 'className').includes('search-input')
}

/** Every search input under `root`, in document order. */
export function findAllSearchInputsInJSX(root: any): SearchInput[] {
  const results: SearchInput[] = []

  const traverse = (node: any): void => {
    if (!node) {
      return
    }

    if (isInput(node)) {
      const forNodeId = readJSXAttributeString(node, SEARCH_FOR_ATTR)
      if (forNodeId) {
        results.push({ node, forNodeId })
      } else if (hasSearchInputClass(node)) {
        results.push({ node })
      }
    }

    if (node.children && Array.isArray(node.children)) {
      node.children.forEach((c: any) => traverse(c))
    }
    if (node.body) {
      if (Array.isArray(node.body)) {
        node.body.forEach((s: any) => traverse(s))
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
    // `{activeTabIndex === 0 && (<div>…<DataProvider/>…</div>)}` — a tab
    // panel, a gated section: the provider sits on the RIGHT of a logical
    // expression (or in a ternary's `test`), which is not a child, a body or
    // an argument. Left unvisited, the products list under the first tab of
    // a shop was never paginated or seeded, and rendered nothing.
    if (node.left) {
      traverse(node.left)
    }
    if (node.right) {
      traverse(node.right)
    }
    if (node.test) {
      traverse(node.test)
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

/**
 * The search-enabled usage each input searches: a marked input's by the mapper
 * node id it names, a platform input's by its place among the platform inputs.
 */
export function pairSearchInputs<Usage extends { searchEnabled: boolean; nodeId?: string }>(
  inputs: SearchInput[],
  usages: Usage[]
): Map<any, Usage> {
  const searchable = usages.filter((usage) => usage.searchEnabled)
  const paired = new Map<any, Usage>()
  let position = 0
  for (const input of inputs) {
    if (input.forNodeId) {
      const named = searchable.find((candidate) => candidate.nodeId === input.forNodeId)
      if (named) {
        paired.set(input.node, named)
      }
      continue
    }
    const next = searchable[position]
    position += 1
    if (next) {
      paired.set(input.node, next)
    }
  }
  return paired
}

/**
 * Controls the input by the mapper's query: `value` reads it, `onChange`
 * writes it. A marked input may sit inside a form of the page's own; Enter
 * in it must not submit that form and reload the filtered list away.
 */
export function wireSearchInput(
  input: SearchInput,
  vars: { searchQueryVar: string; setSearchQueryVar: string }
): void {
  const attributes = input.node.openingElement.attributes.filter(
    (attr: any) => !['onChange', 'value', 'onKeyDown'].includes(attr.name?.name)
  )
  attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('onChange'),
      types.jsxExpressionContainer(
        types.arrowFunctionExpression(
          [types.identifier('e')],
          types.callExpression(types.identifier(vars.setSearchQueryVar), [
            types.memberExpression(
              types.memberExpression(types.identifier('e'), types.identifier('target')),
              types.identifier('value')
            ),
          ])
        )
      )
    ),
    types.jsxAttribute(
      types.jsxIdentifier('value'),
      types.jsxExpressionContainer(types.identifier(vars.searchQueryVar))
    )
  )
  if (input.forNodeId) {
    attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('onKeyDown'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression(
            [types.identifier('e')],
            types.blockStatement([
              types.ifStatement(
                types.binaryExpression(
                  '===',
                  types.memberExpression(types.identifier('e'), types.identifier('key')),
                  types.stringLiteral('Enter')
                ),
                types.expressionStatement(
                  types.callExpression(
                    types.memberExpression(
                      types.identifier('e'),
                      types.identifier('preventDefault')
                    ),
                    []
                  )
                )
              ),
            ])
          )
        )
      )
    )
  }
  input.node.openingElement.attributes = attributes
}
