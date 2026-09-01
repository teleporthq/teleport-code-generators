import * as types from '@babel/types'

/**
 * How the generator recognises the pagination controls the builder authored.
 *
 * The marker is a STATIC UIDL attribute, which survives the resolver, the JSX
 * printer and the browser verbatim — unlike `elementType`, which the resolver
 * replaces with the node's `semanticType`, and unlike the class name, which is
 * a side effect of the styling pipeline (`ThqPreviousElm` →
 * `products-list-thq-previous-elm`) and so silently renames whenever a node is
 * renamed. The same attribute is readable from the DOM, which is how the
 * pagination-scroll runtime already identifies its own nodes.
 */
export const PAGINATION_CONTROL_ATTR = 'data-tq-pagination-control'

/**
 * `'pages'` is the container the page-number buttons are repeated into and
 * `'page'` the single template button inside it. `'ellipsis'` and `'sentinel'`
 * are reserved for an authored gap marker / scroll sentinel; until a builder
 * emits them both runtimes fall back to generating their own.
 */
export type PaginationControlKind =
  | 'first'
  | 'previous'
  | 'pages'
  | 'page'
  | 'ellipsis'
  | 'next'
  | 'last'
  | 'load-more'
  | 'sentinel'

// tslint:disable:no-any

// Reads a JSX attribute's literal string value, covering both the plain
// `attr="value"` form and the `attr={'value'}` container the UIDL printer emits
// for some static attributes.
export function readJSXAttributeString(node: any, attrName: string): string {
  const attr = node?.openingElement?.attributes?.find(
    (candidate: any) => candidate.type === 'JSXAttribute' && candidate.name?.name === attrName
  )
  return attr?.value?.value || attr?.value?.expression?.value || ''
}

/**
 * Depth-first search for one authored pagination control.
 *
 * `legacyClassName` keeps every project generated before the marker existed
 * working: its Previous/Next buttons carry no attribute, so the search falls
 * back to the class-name substring the generator has always matched on. New
 * control kinds have no legacy spelling and are marker-only.
 */
export function findPaginationControl(
  root: any,
  kind: PaginationControlKind,
  legacyClassName?: string
): any {
  const search = (node: any, matches: (candidate: any) => boolean): any => {
    if (!node) {
      return null
    }
    if (node.type === 'JSXElement' && matches(node)) {
      return node
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = search(child, matches)
        if (found) {
          return found
        }
      }
    }
    return null
  }

  const byMarker = search(
    root,
    (node) => readJSXAttributeString(node, PAGINATION_CONTROL_ATTR) === kind
  )
  if (byMarker || !legacyClassName) {
    return byMarker
  }
  return search(root, (node) => readJSXAttributeString(node, 'className').includes(legacyClassName))
}

/** Every authored control of one kind, in document order (page-number templates aside, callers want one). */
export function findAllPaginationControls(root: any, kind: PaginationControlKind): any[] {
  const found: any[] = []
  const traverse = (node: any): void => {
    if (!node) {
      return
    }
    if (
      node.type === 'JSXElement' &&
      readJSXAttributeString(node, PAGINATION_CONTROL_ATTR) === kind
    ) {
      found.push(node)
    }
    if (Array.isArray(node.children)) {
      node.children.forEach(traverse)
    }
  }
  traverse(root)
  return found
}

/**
 * Turns an authored control into a real `<button type="button">`.
 *
 * The builders author these as styled containers (a `div` after the resolver),
 * so without this a keyboard user could never reach them and a click would not
 * register as a form-safe activation. An author-supplied `type` is respected.
 */
export function convertControlToButton(node: any): void {
  node.openingElement.name.name = 'button'
  if (node.closingElement) {
    node.closingElement.name.name = 'button'
  }
  const hasType = node.openingElement.attributes.some((attr: any) => attr.name?.name === 'type')
  if (!hasType) {
    node.openingElement.attributes.push(
      types.jsxAttribute(types.jsxIdentifier('type'), types.stringLiteral('button'))
    )
  }
}

/** Replaces (never duplicates) one JSX attribute, appending it last. */
export function setJSXExpressionAttribute(
  node: any,
  attrName: string,
  expression: types.Expression
): void {
  node.openingElement.attributes = node.openingElement.attributes.filter(
    (attr: any) => attr.name?.name !== attrName
  )
  node.openingElement.attributes.push(
    types.jsxAttribute(types.jsxIdentifier(attrName), types.jsxExpressionContainer(expression))
  )
}

/** Drops one JSX attribute if present. */
export function removeJSXAttribute(node: any, attrName: string): void {
  node.openingElement.attributes = node.openingElement.attributes.filter(
    (attr: any) => attr.name?.name !== attrName
  )
}

/**
 * Removes the controls that belong to a pagination mode this mapper is not in —
 * a numbered strip left in a Previous/Next list would render unwired buttons
 * that look clickable and do nothing.
 *
 * Children carrying NO marker are always kept: they are the author's own
 * additions (a page counter, a spacer) and the generator has no business
 * deciding whether they belong.
 */
export function dropInactivePaginationControls(
  paginationNode: any,
  activeKinds: PaginationControlKind[]
): void {
  const active = new Set<string>(activeKinds)
  const prune = (node: any): void => {
    if (!node || !Array.isArray(node.children)) {
      return
    }
    node.children = node.children.filter((child: any) => {
      if (child?.type !== 'JSXElement') {
        return true
      }
      const marker = readJSXAttributeString(child, PAGINATION_CONTROL_ATTR)
      return marker === '' || active.has(marker)
    })
    node.children.forEach(prune)
  }
  prune(paginationNode)
}
