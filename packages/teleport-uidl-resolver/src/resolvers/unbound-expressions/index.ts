import { ComponentUIDL, UIDLNode, UIDLElement, UIDLStaticValue } from '@teleporthq/teleport-types'
import { extractRootIdentifiers } from './expression-identifiers'
import { AMBIENT_IDENTIFIERS, isGeneratorInternalIdentifier } from './ambient-identifiers'

/**
 * Neutralises UIDL `expr` nodes that reference an identifier which is not in
 * scope.
 *
 * The AI content pipeline occasionally emits a "row template" without its
 * enclosing repeater — e.g. a `<select>` gets a single templated option
 * `<option>{{ cat.name }}</option>` but no `<array-mapper>`, so the iterator
 * `cat` is never bound. The importer turns that interpolation into an `expr`
 * node (`{ type: 'expr', content: 'cat.name' }`), and the JSX generator emits
 * it verbatim. At render time `cat` is undefined and React throws
 * `ReferenceError: cat is not defined`, which fails the entire static export /
 * `next build`.
 *
 * This resolver pass walks the component tree, tracks every iterator variable
 * introduced by a repeater, and replaces any `expr` used as element content or
 * as an attribute value whose root reference is neither an in-scope iterator,
 * a declared state / prop, nor a JavaScript global with an empty static node.
 * The affected element still renders (empty) instead of crashing the build.
 *
 * It only ever removes provably-broken expressions: an expression survives
 * untouched unless one of its root references cannot be resolved to anything.
 */

const EMPTY_STATIC_NODE: UIDLStaticValue = { type: 'static', content: '' }

const withIterator = (scope: Set<string>, iteratorName?: string): Set<string> => {
  if (!iteratorName) {
    return scope
  }
  const next = new Set(scope)
  next.add(iteratorName)
  return next
}

const isUnboundExpression = (
  expression: string,
  boundRoots: Set<string>,
  scope: Set<string>
): boolean => {
  const roots = extractRootIdentifiers(expression)
  let hasUnboundRoot = false
  roots.forEach((root) => {
    if (!boundRoots.has(root) && !scope.has(root) && !isGeneratorInternalIdentifier(root)) {
      hasUnboundRoot = true
    }
  })
  return hasUnboundRoot
}

const sanitizeElement = (
  element: UIDLElement,
  boundRoots: Set<string>,
  scope: Set<string>
): void => {
  const { attrs, abilities, children } = element

  if (attrs) {
    Object.keys(attrs).forEach((attrKey) => {
      const attr = attrs[attrKey]
      if (attr.type === 'expr' && isUnboundExpression(attr.content, boundRoots, scope)) {
        attrs[attrKey] = { ...EMPTY_STATIC_NODE }
        return
      }
      if (attr.type === 'element') {
        sanitizeNode(attr, boundRoots, scope)
      }
    })
  }

  if (abilities?.link?.type === 'url') {
    const url = abilities.link.content?.url
    if (url && url.type === 'expr' && isUnboundExpression(url.content, boundRoots, scope)) {
      abilities.link.content.url = { ...EMPTY_STATIC_NODE }
    }
  }

  if (children) {
    children.forEach((child, index) => {
      if (child.type === 'expr' && isUnboundExpression(child.content, boundRoots, scope)) {
        children[index] = { ...EMPTY_STATIC_NODE }
        return
      }
      sanitizeNode(child, boundRoots, scope)
    })
  }
}

const sanitizeNode = (node: UIDLNode, boundRoots: Set<string>, scope: Set<string>): void => {
  if (!node || !node.type) {
    return
  }

  switch (node.type) {
    case 'element': {
      // An element node can wrap a data-source node in its `content`.
      const content = node.content as unknown as { type?: string }
      if (content.type === 'data-source-item' || content.type === 'data-source-list') {
        sanitizeNode(node.content as unknown as UIDLNode, boundRoots, scope)
        return
      }
      sanitizeElement(node.content, boundRoots, scope)
      return
    }

    case 'conditional':
      sanitizeNode(node.content.node, boundRoots, scope)
      return

    case 'repeat': {
      const iteratorName = node.content.meta?.iteratorName || 'item'
      let nextScope = withIterator(scope, iteratorName)
      if (node.content.meta?.useIndex) {
        nextScope = withIterator(nextScope, 'index')
      }
      sanitizeNode(node.content.node, boundRoots, nextScope)
      return
    }

    case 'cms-list-repeater': {
      const nextScope = withIterator(scope, node.content.renderPropIdentifier)
      sanitizeNode(node.content.nodes.list, boundRoots, nextScope)
      if (node.content.nodes.empty) {
        sanitizeNode(node.content.nodes.empty, boundRoots, scope)
      }
      if (node.content.nodes.loading) {
        sanitizeNode(node.content.nodes.loading, boundRoots, scope)
      }
      return
    }

    case 'cms-list':
    case 'cms-item': {
      const nextScope = withIterator(scope, node.content.renderPropIdentifier)
      sanitizeNode(node.content.nodes.success, boundRoots, nextScope)
      if (node.content.nodes.error) {
        sanitizeNode(node.content.nodes.error, boundRoots, scope)
      }
      if (node.content.nodes.loading) {
        sanitizeNode(node.content.nodes.loading, boundRoots, scope)
      }
      return
    }

    case 'cms-mixed-type': {
      const nextScope = withIterator(scope, node.content.renderPropIdentifier)
      const mappings = node.content.mappings || {}
      Object.keys(mappings).forEach((key) => {
        sanitizeNode(mappings[key], boundRoots, nextScope)
      })
      if (node.content.nodes?.fallback) {
        sanitizeNode(node.content.nodes.fallback, boundRoots, scope)
      }
      if (node.content.nodes?.error) {
        sanitizeNode(node.content.nodes.error, boundRoots, scope)
      }
      return
    }

    case 'data-source-item':
    case 'data-source-list': {
      const nextScope = withIterator(scope, node.content.renderPropIdentifier)
      if (node.content.nodes?.success) {
        sanitizeNode(node.content.nodes.success, boundRoots, nextScope)
      }
      if (node.content.nodes?.error) {
        sanitizeNode(node.content.nodes.error, boundRoots, scope)
      }
      if (node.content.nodes?.loading) {
        sanitizeNode(node.content.nodes.loading, boundRoots, scope)
      }
      if (node.content.children) {
        node.content.children.forEach((child) => {
          sanitizeNode(child, boundRoots, nextScope)
        })
      }
      return
    }

    case 'slot':
      if (node.content.fallback) {
        sanitizeNode(node.content.fallback as UIDLNode, boundRoots, scope)
      }
      return

    default:
      // static / dynamic / expr / raw / inject / import — leaf nodes handled by
      // their parent element (children / attrs), nothing to descend into.
      return
  }
}

const collectBoundRoots = (uidl: ComponentUIDL): Set<string> => {
  const boundRoots = new Set(AMBIENT_IDENTIFIERS)
  Object.keys(uidl.propDefinitions || {}).forEach((prop) => boundRoots.add(prop))
  Object.keys(uidl.stateDefinitions || {}).forEach((state) => boundRoots.add(state))
  return boundRoots
}

export const resolveUnboundExpressions = (uidl: ComponentUIDL): void => {
  if (!uidl.node) {
    return
  }
  const boundRoots = collectBoundRoots(uidl)
  sanitizeNode(uidl.node, boundRoots, new Set<string>())
}
