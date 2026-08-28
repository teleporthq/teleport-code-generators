import * as types from '@babel/types'

/**
 * ------------------------------------------------------------------
 * Scope-aware identifier analysis for generated JavaScript ASTs
 * ------------------------------------------------------------------
 *
 * Generated components are assembled by a dozen independent plugins, each of
 * which splices statements into the SAME component body. Nothing in that
 * pipeline knows what the others wrote, so the only thing keeping the output
 * valid is that every statement ends up BELOW the declarations it reads. When
 * one doesn't, the browser answers with
 *
 *   ReferenceError: Cannot access 'ds_0_state' before initialization
 *
 * — a temporal-dead-zone (TDZ) error, thrown while rendering, that no test
 * asserting on source text can see.
 *
 * This module is the shared vocabulary the insertion helpers and the
 * end-of-pipeline repair pass in `ast-statement-order` are both written
 * against:
 *
 *   - which names a statement BINDS, and which of those are TDZ-governed;
 *   - which names a statement READS, split into the ones read the moment the
 *     statement executes and the ones only read when a nested function is
 *     later called.
 *
 * That split is why this is scope-aware rather than a bare identifier grep.
 * `const handlers = { run: () => helper() }` followed by `const helper = …` is
 * perfectly legal — `helper` is read when `run` is CALLED, long after the body
 * has finished evaluating — so treating it as a violation would make the
 * repair pass reorder correct code. `useMemo(() => x, [x])`, on the other
 * hand, reads `x` while the statement runs (React invokes the callback
 * synchronously, and the dependency array is a plain argument), which is
 * exactly the shape that produced the ReferenceError above.
 */

/**
 * Node keys that carry position/comment bookkeeping rather than child nodes.
 * Walking them cannot turn up a reference, and `extra`/`loc` in particular
 * hold structures we have no business inspecting.
 */
const AST_METADATA_KEY_LIST: string[] = [
  'loc',
  'start',
  'end',
  'range',
  'comments',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'extra',
]

export const AST_METADATA_KEYS: ReadonlySet<string> = new Set<string>(AST_METADATA_KEY_LIST)

/** Metadata plus the TypeScript annotation keys, which never hold a value read. */
const NON_VALUE_KEYS: ReadonlySet<string> = new Set<string>(
  AST_METADATA_KEY_LIST.concat([
    'typeAnnotation',
    'returnType',
    'typeParameters',
    'typeArguments',
    'superTypeParameters',
    'implements',
  ])
)

/**
 * JSX tag names are only variable references when they start with an uppercase
 * letter, `_` or `$` — React's own rule for telling `<Repeater />` (a binding)
 * from `<div />` (a string).
 */
const JSX_COMPONENT_NAME_RE = /^[A-Z_$]/

/** Every node type whose body belongs to a function. */
export const FUNCTION_NODE_TYPES: ReadonlySet<string> = new Set<string>([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',
])

/**
 * React hooks that call one of their function arguments SYNCHRONOUSLY, during
 * the very statement that invokes them, mapped to the argument's position:
 * `useMemo(cb)` runs `cb` before returning, and `useState`/`useReducer` run a
 * lazy initializer on the spot. A TDZ read inside such a callback crashes the
 * render exactly like a top-level read, so the analysis must see through it.
 *
 * `useEffect`/`useCallback` are deliberately absent — their callbacks run
 * after the whole body has evaluated (or never), so nothing inside them can
 * hit the dead zone of a body-level binding.
 */
const SYNC_CALLBACK_ARGUMENT_BY_HOOK: Record<string, number> = {
  useMemo: 0,
  useState: 0,
  useReducer: 2,
}

export interface ReferenceOptions {
  /**
   * Restrict the result to these names. Callers usually know the small set of
   * bindings they care about, and filtering here keeps the walk from
   * allocating an entry per identifier in a 600-line page.
   */
  readonly only?: ReadonlySet<string>
  /**
   * Also collect names read inside DEFERRED function bodies (callbacks that
   * only run when something later calls them).
   *
   * OFF by default, which is the sound choice for deciding whether existing
   * code is broken: a deferred read is legal no matter where the declaration
   * sits. ON when choosing where to PLACE new statements, where
   * over-approximating only ever moves them further down, never into a TDZ.
   */
  readonly includeDeferred?: boolean
}

/**
 * Names introduced by a pattern (`const { a, b: [c] } = …`, a function
 * parameter, a catch binding). Appends to `out` so a caller can accumulate
 * across a whole declaration without allocating per declarator.
 */
const collectPatternNames = (pattern: types.Node | null | undefined, out: string[]): string[] => {
  if (!pattern || typeof pattern !== 'object') {
    return out
  }

  switch (pattern.type) {
    case 'Identifier':
      out.push(pattern.name)
      return out
    case 'ObjectPattern':
      pattern.properties.forEach((property) => {
        if (property.type === 'RestElement') {
          collectPatternNames(property.argument, out)
          return
        }
        collectPatternNames(property.value, out)
      })
      return out
    case 'ArrayPattern':
      pattern.elements.forEach((element) => collectPatternNames(element, out))
      return out
    case 'AssignmentPattern':
      collectPatternNames(pattern.left, out)
      return out
    case 'RestElement':
      collectPatternNames(pattern.argument, out)
      return out
    default:
      return out
  }
}

/**
 * Names a statement introduces that are governed by the temporal dead zone —
 * i.e. reading them before this statement runs THROWS.
 *
 * `var` and `function` declarations are deliberately excluded: both are
 * hoisted AND initialised before any statement of the block executes (to
 * `undefined` and to the function respectively), so reading them early is
 * legal JavaScript. Only `let`, `const` and `class` can throw.
 */
export const collectBlockScopedBindings = (statement: types.Node | null | undefined): string[] => {
  if (!statement || typeof statement !== 'object') {
    return []
  }

  if (statement.type === 'VariableDeclaration') {
    if (statement.kind === 'var') {
      return []
    }
    const names: string[] = []
    statement.declarations.forEach((declarator) => collectPatternNames(declarator.id, names))
    return names
  }

  if (statement.type === 'ClassDeclaration' && statement.id) {
    return [statement.id.name]
  }

  return []
}

/**
 * Every name a statement puts into the surrounding block scope, TDZ-governed
 * or not. Used to know what an inner block SHADOWS, where the difference
 * between "throws when read early" and "reads as undefined" is irrelevant:
 * either way the name no longer refers to the outer binding.
 */
const collectDeclaredBindings = (statement: types.Node | null | undefined): string[] => {
  if (!statement || typeof statement !== 'object') {
    return []
  }

  if (statement.type === 'VariableDeclaration') {
    const names: string[] = []
    statement.declarations.forEach((declarator) => collectPatternNames(declarator.id, names))
    return names
  }

  if (
    (statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration') &&
    statement.id
  ) {
    return [statement.id.name]
  }

  return []
}

/** Every name the statements of one block introduce into that block's scope. */
const collectBlockBindings = (
  statements: ReadonlyArray<types.Statement | null | undefined>
): Set<string> => {
  const bindings = new Set<string>()
  statements.forEach((statement) => {
    collectDeclaredBindings(statement).forEach((name) => bindings.add(name))
  })
  return bindings
}

const isBoundInScopes = (scopes: Array<Set<string>>, name: string): boolean => {
  for (let index = scopes.length - 1; index >= 0; index--) {
    if (scopes[index].has(name)) {
      return true
    }
  }
  return false
}

/**
 * True when an `Identifier` sits somewhere that is a NAME rather than a value
 * read — an object-literal key, a non-computed member property, a label, an
 * import specifier. Getting this wrong in the permissive direction would make
 * `{ page: 1 }` look like a read of a binding called `page`.
 */
// tslint:disable-next-line:no-any
const isNonReferencePosition = (parent: any, key: string | null): boolean => {
  if (!parent || !key) {
    return false
  }

  switch (parent.type) {
    case 'MemberExpression':
    case 'OptionalMemberExpression':
      return key === 'property' && !parent.computed
    case 'ObjectProperty':
    case 'ObjectMethod':
    case 'ClassMethod':
    case 'ClassPrivateMethod':
    case 'ClassProperty':
    case 'ClassPrivateProperty':
      return key === 'key' && !parent.computed
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return key === 'label'
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
    case 'ExportSpecifier':
    case 'MetaProperty':
    case 'JSXAttribute':
    case 'JSXNamespacedName':
      return true
    default:
      return false
  }
}

/**
 * True when a `JSXIdentifier` is a component reference (`<Repeater />`,
 * `<React.Fragment />`) rather than an intrinsic tag or an attribute name.
 */
const isJSXComponentReference = (
  node: types.JSXIdentifier,
  // tslint:disable-next-line:no-any
  parent: any,
  key: string | null
): boolean => {
  if (!parent || !JSX_COMPONENT_NAME_RE.test(node.name)) {
    return false
  }
  if (parent.type === 'JSXOpeningElement' || parent.type === 'JSXClosingElement') {
    return key === 'name'
  }
  if (parent.type === 'JSXMemberExpression') {
    return key === 'object'
  }
  return false
}

/**
 * The position of the function argument `callee` invokes synchronously, or
 * `-1` when it invokes none that we recognise.
 */
// tslint:disable-next-line:no-any
const getSyncCallbackArgumentIndex = (callee: any): number => {
  if (callee && callee.type === 'Identifier') {
    const index = SYNC_CALLBACK_ARGUMENT_BY_HOOK[callee.name]
    return index === undefined ? -1 : index
  }
  return -1
}

/**
 * Collects the identifiers a node READS, honouring every scope introduced
 * along the way so a shadowing binding is never mistaken for the outer one.
 *
 * Reads that happen while the node evaluates are always collected — including
 * inside an IIFE body and inside callbacks the recognised React hooks invoke
 * synchronously. Reads inside other nested functions are deferred and only
 * collected when {@link ReferenceOptions.includeDeferred} asks for them.
 *
 * Accepts a single node or an array of them, so a caller holding the list of
 * statements it is about to insert can ask about all of them at once.
 */
export const collectReferencedIdentifiers = (
  root: types.Node | ReadonlyArray<types.Node | null | undefined> | null | undefined,
  options: ReferenceOptions = {}
): Set<string> => {
  const found = new Set<string>()
  const { only, includeDeferred = false } = options

  // Nothing can match, so skip the walk entirely.
  if (only && only.size === 0) {
    return found
  }

  const scopes: Array<Set<string>> = []

  const record = (name: string): void => {
    if (only && !only.has(name)) {
      return
    }
    if (isBoundInScopes(scopes, name)) {
      return
    }
    found.add(name)
  }

  /**
   * Walks a binding pattern. The bound names are declarations rather than
   * reads, but a default value (`const { a = fallback } = …`) and a computed
   * key (`const { [prop]: a } = …`) genuinely are read here.
   */
  const visitPattern = (pattern: types.Node | null | undefined): void => {
    if (!pattern || typeof pattern !== 'object') {
      return
    }

    switch (pattern.type) {
      case 'Identifier':
        return
      case 'ObjectPattern':
        pattern.properties.forEach((property) => {
          if (property.type === 'RestElement') {
            visitPattern(property.argument)
            return
          }
          if (property.computed) {
            visit(property.key, null, null)
          }
          visitPattern(property.value)
        })
        return
      case 'ArrayPattern':
        pattern.elements.forEach((element) => visitPattern(element))
        return
      case 'AssignmentPattern':
        visitPattern(pattern.left)
        visit(pattern.right, null, null)
        return
      case 'RestElement':
        visitPattern(pattern.argument)
        return
      default:
        // A member expression in destructuring position (`[obj.a] = …`) writes
        // to something that already exists — walk it as an expression.
        visit(pattern, null, null)
        return
    }
  }

  // tslint:disable-next-line:no-any
  const visitChildren = (node: any): void => {
    Object.keys(node).forEach((key) => {
      if (NON_VALUE_KEYS.has(key) || key.charAt(0) === '_') {
        return
      }
      visit(node[key], node, key)
    })
  }

  /**
   * `invokedNow` marks a function whose body runs while the surrounding
   * statement evaluates (an IIFE, a `useMemo` callback). Its directly-executed
   * code counts as immediate; functions nested INSIDE it are deferred again
   * unless they are themselves invoked on the spot.
   */
  // tslint:disable-next-line:no-any
  const visitFunction = (node: any, invokedNow: boolean): void => {
    // A computed method key (`{ [name]() {} }`) is evaluated where the object
    // literal is, not when the method runs, so it is never deferred.
    if (node.computed && node.key) {
      visit(node.key, null, null)
    }

    if (!includeDeferred && !invokedNow) {
      return
    }

    const frame = new Set<string>()
    const names: string[] = []
    const params: types.Node[] = node.params || []
    params.forEach((param) => collectPatternNames(param, names))
    if (node.id && node.id.type === 'Identifier') {
      names.push(node.id.name)
    }
    names.forEach((name) => frame.add(name))

    scopes.push(frame)
    params.forEach((param) => visitPattern(param))
    visit(node.body, node, 'body')
    scopes.pop()
  }

  // tslint:disable-next-line:no-any
  const visit = (node: any, parent: any, key: string | null): void => {
    if (!node || typeof node !== 'object') {
      return
    }

    if (Array.isArray(node)) {
      node.forEach((entry) => visit(entry, parent, key))
      return
    }

    if (typeof node.type !== 'string') {
      return
    }

    if (node.type === 'Identifier') {
      if (!isNonReferencePosition(parent, key)) {
        record(node.name)
      }
      return
    }

    if (node.type === 'JSXIdentifier') {
      if (isJSXComponentReference(node as types.JSXIdentifier, parent, key)) {
        record(node.name)
      }
      return
    }

    if (FUNCTION_NODE_TYPES.has(node.type)) {
      visitFunction(node, false)
      return
    }

    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const callee = node.callee
      if (callee && FUNCTION_NODE_TYPES.has(callee.type)) {
        // An IIFE: the body executes as part of this very expression.
        visitFunction(callee, true)
      } else {
        visit(callee, node, 'callee')
      }

      const syncIndex = getSyncCallbackArgumentIndex(callee)
      const args: types.Node[] = node.arguments || []
      args.forEach((argument, index) => {
        if (index === syncIndex && argument && FUNCTION_NODE_TYPES.has(argument.type)) {
          visitFunction(argument, true)
          return
        }
        visit(argument, node, 'arguments')
      })
      return
    }

    if (node.type === 'VariableDeclarator') {
      visitPattern(node.id)
      visit(node.init, node, 'init')
      return
    }

    if (node.type === 'CatchClause') {
      const frame = new Set<string>()
      collectPatternNames(node.param, []).forEach((name) => frame.add(name))
      scopes.push(frame)
      visit(node.body, node, 'body')
      scopes.pop()
      return
    }

    if (node.type === 'BlockStatement' || node.type === 'StaticBlock') {
      scopes.push(collectBlockBindings(node.body))
      visitChildren(node)
      scopes.pop()
      return
    }

    if (
      node.type === 'ForStatement' ||
      node.type === 'ForInStatement' ||
      node.type === 'ForOfStatement'
    ) {
      const head = node.type === 'ForStatement' ? node.init : node.left
      const frame = new Set<string>()
      if (head && head.type === 'VariableDeclaration' && head.kind !== 'var') {
        collectBlockScopedBindings(head).forEach((name) => frame.add(name))
      }
      scopes.push(frame)
      visitChildren(node)
      scopes.pop()
      return
    }

    if (node.type === 'SwitchStatement') {
      visit(node.discriminant, node, 'discriminant')
      // Every `case` shares ONE block scope, so the bindings of all of them
      // have to be in place before any consequent is walked.
      const frame = new Set<string>()
      const cases: Array<{ consequent?: types.Statement[] }> = node.cases || []
      cases.forEach((switchCase) => {
        collectBlockBindings(switchCase.consequent || []).forEach((name) => frame.add(name))
      })
      scopes.push(frame)
      visit(node.cases, node, 'cases')
      scopes.pop()
      return
    }

    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      visit(node.superClass, node, 'superClass')
      visit(node.decorators, node, 'decorators')
      visit(node.body, node, 'body')
      return
    }

    visitChildren(node)
  }

  if (Array.isArray(root)) {
    root.forEach((entry) => visit(entry, null, null))
  } else {
    visit(root, null, null)
  }

  return found
}
