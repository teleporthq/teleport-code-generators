import { ComponentUIDL, UIDLNode, UIDLElement, UIDLStaticValue } from '@teleporthq/teleport-types'
import { analyzeExpressionScope } from './expression-identifiers'
import { extractFallbackLiteral } from './expression-fallback'
import { RENDER_SCOPE_IDENTIFIERS, isGeneratorInternalIdentifier } from './ambient-identifiers'

/**
 * Neutralises UIDL `expr` nodes that reference an identifier which is not in
 * scope.
 *
 * The content pipeline occasionally emits an expression whose reference was
 * never bound to anything:
 *
 *  - a "row template" arrives without its enclosing repeater — a `<select>`
 *    gets a single templated option `<option>{{ cat.name }}</option>` but no
 *    `<array-mapper>`, so the iterator `cat` is never declared;
 *  - a field binding keeps the raw column name it was authored with
 *    (`{{ state }}` for an address' state column) because nothing resolved it
 *    to a prop / state reference.
 *
 * The importer turns those interpolations into `expr` nodes
 * (`{ type: 'expr', content: 'cat.name' }`) and the JSX generator emits them
 * verbatim. At render time the root reference is undeclared and React throws
 * `ReferenceError: cat is not defined`, which fails the entire static export /
 * `next build`.
 *
 * This pass walks the component tree, tracks every identifier a node introduces
 * into the render scope (repeater iterators, `index`, CMS / data-source render
 * props), and replaces any `expr` used as element content or as an attribute
 * value whose root reference resolves to nothing. The replacement keeps the
 * expression's own literal fallback when it has one (`company?.name || 'N/A'`
 * → `N/A`) and is empty otherwise, so the affected element still renders
 * instead of crashing the build.
 *
 * It only ever removes provably-broken expressions: an expression survives
 * untouched unless one of its root references cannot be resolved to anything
 * AND the analyser could account for every binding the expression declares.
 *
 * Two expression positions are intentionally out of scope. Event handler
 * statements (`element.content.events`) run in a callback where `event` and the
 * generator's own locals are bound, and they cannot break a build. Conditional
 * references (`conditional.content.reference`) have no neutral replacement —
 * they decide whether a subtree renders at all, so blanking one would silently
 * show or hide content rather than degrade it.
 */

const EMPTY_STATIC_NODE: UIDLStaticValue = { type: 'static', content: '' }

interface SanitizeContext {
  componentName: string
  /** Identifiers bound for the whole component: render scope, props and state. */
  boundRoots: Set<string>
}

const withBindings = (scope: Set<string>, ...names: Array<string | undefined>): Set<string> => {
  const bindings = names.filter((name): name is string => Boolean(name))
  if (bindings.length === 0) {
    return scope
  }
  const next = new Set(scope)
  bindings.forEach((name) => next.add(name))
  return next
}

const findUnboundRoots = (
  expression: string,
  context: SanitizeContext,
  scope: Set<string>
): string[] => {
  const { freeIdentifiers, resolvable } = analyzeExpressionScope(expression)
  if (!resolvable) {
    return []
  }
  const unbound: string[] = []
  freeIdentifiers.forEach((root) => {
    if (!context.boundRoots.has(root) && !scope.has(root) && !isGeneratorInternalIdentifier(root)) {
      unbound.push(root)
    }
  })
  return unbound
}

/**
 * Returns the static node an unbound expression must be replaced with, or
 * `undefined` when the expression is fine and has to be left alone.
 */
const neutralizeExpression = (
  expression: string,
  context: SanitizeContext,
  scope: Set<string>
): UIDLStaticValue | undefined => {
  const unbound = findUnboundRoots(expression, context, scope)
  if (unbound.length === 0) {
    return undefined
  }

  const fallback = extractFallbackLiteral(expression)
  // tslint:disable-next-line:no-console
  console.warn(
    `[unbound-expression] ${context.componentName}: expression \`${expression}\` references ` +
      `undeclared ${unbound.join(', ')}. Replaced with ${JSON.stringify(fallback ?? '')} so the ` +
      `build does not fail with a ReferenceError.`
  )

  return fallback === null ? { ...EMPTY_STATIC_NODE } : { type: 'static', content: fallback }
}

const sanitizeElement = (
  element: UIDLElement,
  context: SanitizeContext,
  scope: Set<string>
): void => {
  const { attrs, abilities, children } = element

  if (attrs) {
    Object.keys(attrs).forEach((attrKey) => {
      const attr = attrs[attrKey]
      if (attr.type === 'expr') {
        const replacement = neutralizeExpression(attr.content, context, scope)
        if (replacement) {
          attrs[attrKey] = replacement
        }
        return
      }
      if (attr.type === 'element') {
        sanitizeNode(attr, context, scope)
      }
    })
  }

  // Link abilities are normally folded into attributes by the abilities
  // resolver before this pass runs; this covers the ones that survive.
  if (abilities?.link?.type === 'url') {
    const url = abilities.link.content?.url
    if (url && url.type === 'expr') {
      const replacement = neutralizeExpression(url.content, context, scope)
      if (replacement) {
        abilities.link.content.url = replacement
      }
    }
  }

  if (children) {
    children.forEach((child, index) => {
      if (child.type === 'expr') {
        const replacement = neutralizeExpression(child.content, context, scope)
        if (replacement) {
          children[index] = replacement
        }
        return
      }
      sanitizeNode(child, context, scope)
    })
  }
}

const sanitizeNode = (node: UIDLNode, context: SanitizeContext, scope: Set<string>): void => {
  if (!node || !node.type) {
    return
  }

  switch (node.type) {
    case 'element': {
      // An element node can wrap a data-source node in its `content`.
      const content = node.content as unknown as { type?: string }
      if (content.type === 'data-source-item' || content.type === 'data-source-list') {
        sanitizeNode(node.content as unknown as UIDLNode, context, scope)
        return
      }
      sanitizeElement(node.content, context, scope)
      return
    }

    case 'conditional':
      sanitizeNode(node.content.node, context, scope)
      return

    case 'repeat': {
      // Mirrors generateRepeatNode: `source.map((iteratorName, index?) => …)`.
      const iteratorName = node.content.meta?.iteratorName || 'item'
      const indexName = node.content.meta?.useIndex ? 'index' : undefined
      sanitizeNode(node.content.node, context, withBindings(scope, iteratorName, indexName))
      return
    }

    case 'cms-list-repeater': {
      // Mirrors generateCMSListRepeaterNode: `renderItem={(item, index) => …}`.
      const listScope = withBindings(scope, node.content.renderPropIdentifier, 'index')
      sanitizeNode(node.content.nodes.list, context, listScope)
      if (node.content.nodes.empty) {
        sanitizeNode(node.content.nodes.empty, context, scope)
      }
      if (node.content.nodes.loading) {
        sanitizeNode(node.content.nodes.loading, context, scope)
      }
      return
    }

    case 'cms-list':
    case 'cms-item': {
      // Mirrors generateCMSNode: `cms-item` renders through
      // `(renderPropIdentifier) => …` while `cms-list` renders through
      // `(params) => …`. Both names are added so either shape resolves.
      const successScope = withBindings(scope, node.content.renderPropIdentifier, 'params')
      sanitizeNode(node.content.nodes.success, context, successScope)
      if (node.content.nodes.error) {
        sanitizeNode(node.content.nodes.error, context, scope)
      }
      if (node.content.nodes.loading) {
        sanitizeNode(node.content.nodes.loading, context, scope)
      }
      return
    }

    case 'cms-mixed-type': {
      const mappingScope = withBindings(scope, node.content.renderPropIdentifier)
      const mappings = node.content.mappings || {}
      Object.keys(mappings).forEach((key) => {
        sanitizeNode(mappings[key], context, mappingScope)
      })
      if (node.content.nodes?.fallback) {
        sanitizeNode(node.content.nodes.fallback, context, scope)
      }
      if (node.content.nodes?.error) {
        sanitizeNode(node.content.nodes.error, context, scope)
      }
      return
    }

    case 'data-source-item':
    case 'data-source-list': {
      const successScope = withBindings(scope, node.content.renderPropIdentifier)
      if (node.content.nodes?.success) {
        sanitizeNode(node.content.nodes.success, context, successScope)
      }
      if (node.content.nodes?.error) {
        sanitizeNode(node.content.nodes.error, context, scope)
      }
      if (node.content.nodes?.loading) {
        sanitizeNode(node.content.nodes.loading, context, scope)
      }
      if (node.content.children) {
        node.content.children.forEach((child) => {
          sanitizeNode(child, context, successScope)
        })
      }
      return
    }

    case 'slot':
      if (node.content.fallback) {
        sanitizeNode(node.content.fallback as UIDLNode, context, scope)
      }
      return

    default:
      // static / dynamic / expr / raw / inject / import — leaf nodes handled by
      // their parent element (children / attrs), nothing to descend into.
      return
  }
}

const collectBoundRoots = (uidl: ComponentUIDL): Set<string> => {
  const boundRoots = new Set(RENDER_SCOPE_IDENTIFIERS)
  Object.keys(uidl.propDefinitions || {}).forEach((prop) => boundRoots.add(prop))
  Object.keys(uidl.stateDefinitions || {}).forEach((state) => boundRoots.add(state))
  return boundRoots
}

export const resolveUnboundExpressions = (uidl: ComponentUIDL): void => {
  if (!uidl.node) {
    return
  }
  const context: SanitizeContext = {
    componentName: uidl.name || 'component',
    boundRoots: collectBoundRoots(uidl),
  }
  sanitizeNode(uidl.node, context, new Set<string>())
}
