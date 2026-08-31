import * as types from '@babel/types'
import { AST_METADATA_KEYS, FUNCTION_NODE_TYPES, collectReferencedIdentifiers } from './ast-scope'

/**
 * ------------------------------------------------------------------
 * Effect-cleanup contract for generated React components
 * ------------------------------------------------------------------
 *
 * React reads the RETURN VALUE of an effect callback as that effect's cleanup
 * function and calls it on unmount (and before every re-run). Anything else
 * coming back is stored anyway and invoked blindly, so a callback that returns
 * a value which is not callable does not fail where it was written — it fails
 * later, in React's own commit phase, as
 *
 *   TypeError: destroy is not a function
 *       at safelyCallDestroy (react-dom.development.js)
 *
 * with a stack made entirely of React frames and no hint of the component that
 * caused it. The page renders fine; it dies the moment the user navigates away.
 *
 * The shape that produced it here was a concise arrow body:
 *
 *   useEffect(() => import('@google/model-viewer'), [])
 *
 * The arrow was only meant to RUN the dynamic import, but a concise body also
 * RETURNS it, so every product card handed React a Promise as its cleanup and
 * paginating the product list crashed the app.
 *
 * Emitters are expected to build effects whose callback returns a function or
 * nothing at all. This module is the end-of-pipeline NET that repairs the
 * shapes which are provably in breach, no matter which plugin produced them,
 * so the same mistake can never reach a browser again.
 *
 * Like `ast-statement-order`, every repair here is a no-op on healthy code: a
 * callback that already honours the contract prints byte-identical.
 */

/** The hooks whose first argument React treats as an effect with a cleanup. */
export const EFFECT_HOOK_NAMES: ReadonlySet<string> = new Set<string>([
  'useEffect',
  'useLayoutEffect',
  'useInsertionEffect',
])

/**
 * Identifier used for the temporary holding an effect callback's repaired
 * return value. Prefixed and namespaced so it cannot collide with anything the
 * UIDL can name; {@link pickCleanupBindingName} still proves it free.
 */
const CLEANUP_BINDING_NAME = '__tqEffectCleanup'

/**
 * Statement-valued node keys — the positions where a single statement can sit
 * without an enclosing block, e.g. the `return` of `if (done) return {}`.
 * Repairing one means replacing it with a block, which these keys allow.
 */
const SINGLE_STATEMENT_KEYS: ReadonlyArray<string> = ['consequent', 'alternate', 'body']

/**
 * The hook a call expression invokes — a bare `useEffect(…)` or the
 * `React.useEffect(…)` spelling some plugins emit — or `null` for anything
 * else.
 *
 * Only the `React` namespace is accepted on purpose: `anything.useEffect(…)`
 * would let an unrelated API that happens to share the name inherit React's
 * cleanup contract, and rewriting ITS return value would be a real change in
 * behaviour rather than a repair.
 */
const getCalledHookName = (callee: types.Node | null | undefined): string | null => {
  if (!callee) {
    return null
  }
  if (callee.type === 'Identifier') {
    return callee.name
  }
  if (
    (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'React' &&
    callee.property.type === 'Identifier'
  ) {
    return callee.property.name
  }
  return null
}

/** True for the two node types React can actually call as a cleanup. */
const isFunctionExpression = (
  node: types.Node | null | undefined
): node is types.ArrowFunctionExpression | types.FunctionExpression =>
  !!node && (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression')

/** True for `import('…')`, whose value is always a Promise. */
const isDynamicImportCall = (node: types.Node): boolean => {
  if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') {
    return false
  }
  const { callee } = node
  // Babel models the dynamic import callee as its own `Import` node, but a
  // hand-built AST may spell it as an identifier that happens to print the
  // same. Both are the same expression once generated.
  return callee.type === 'Import' || (callee.type === 'Identifier' && callee.name === 'import')
}

/**
 * True when an expression can NEVER evaluate to something callable, so React
 * would certainly reject it as a cleanup.
 *
 * Deliberately conservative — every entry is a shape whose result type is
 * fixed by the language. `a || b`, `cond ? a : b`, `new X()` and any ordinary
 * call are all absent because each of them CAN yield a function, and a net
 * that rewrites code it has not proven broken is worse than the bug it hunts.
 */
export const isProvablyNotAFunction = (node: types.Node | null | undefined): boolean => {
  if (!node) {
    return false
  }

  switch (node.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
    case 'NullLiteral':
    case 'BigIntLiteral':
    case 'DecimalLiteral':
    case 'RegExpLiteral':
    case 'TemplateLiteral':
    case 'ObjectExpression':
    case 'ArrayExpression':
    case 'JSXElement':
    case 'JSXFragment':
    // `void x`, `typeof x`, `!x`, `-x`, `delete x` — each has a primitive result.
    case 'UnaryExpression':
    // `a + b`, `a instanceof B`, `a in b` — a number, string or boolean.
    case 'BinaryExpression':
    case 'UpdateExpression':
      return true
    // A sequence evaluates to its last operand.
    case 'SequenceExpression':
      return isProvablyNotAFunction(node.expressions[node.expressions.length - 1])
    default:
      return isDynamicImportCall(node)
  }
}

/**
 * A binding name for the repaired return value that `expression` does not
 * already read. Without this check the `const` introduced by the repair could
 * shadow an outer binding the expression itself depends on, turning a cleanup
 * bug into a ReferenceError.
 */
const pickCleanupBindingName = (expression: types.Expression): string => {
  const referenced = collectReferencedIdentifiers(expression, { includeDeferred: true })
  if (!referenced.has(CLEANUP_BINDING_NAME)) {
    return CLEANUP_BINDING_NAME
  }
  let suffix = 2
  while (referenced.has(`${CLEANUP_BINDING_NAME}${suffix}`)) {
    suffix++
  }
  return `${CLEANUP_BINDING_NAME}${suffix}`
}

/**
 * `<expression>; return;` — keeps the side effect and the early exit the
 * original `return <expression>` had, and hands React nothing.
 */
const dropReturnedValue = (statement: types.ReturnStatement): types.Statement[] => [
  types.expressionStatement(statement.argument as types.Expression),
  types.returnStatement(),
]

/**
 * Turns a concise arrow body into a block that cannot leak a bad cleanup.
 *
 * The two branches match the two things a concise body can mean. An arrow
 * returning an arrow (`() => () => stop()`) is a cleanup written on purpose
 * and is left alone. Everything else returned a value only because concise
 * arrow syntax returns whatever it evaluates — the author wrote an expression
 * to RUN, not to hand back — so the value is either dropped (when it is
 * provably not callable) or passed through a `typeof` gate that keeps a real
 * cleanup and swallows anything else.
 */
const repairConciseArrowBody = (callback: types.ArrowFunctionExpression): number => {
  const expression = callback.body as types.Expression

  if (isFunctionExpression(expression)) {
    return 0
  }

  if (isProvablyNotAFunction(expression)) {
    callback.body = types.blockStatement([types.expressionStatement(expression)])
    return 1
  }

  const name = pickCleanupBindingName(expression)
  callback.body = types.blockStatement([
    types.variableDeclaration('const', [
      types.variableDeclarator(types.identifier(name), expression),
    ]),
    types.ifStatement(
      types.binaryExpression(
        '===',
        types.unaryExpression('typeof', types.identifier(name)),
        types.stringLiteral('function')
      ),
      types.returnStatement(types.identifier(name))
    ),
  ])
  return 1
}

/**
 * Strips values from the `return`s that belong to an effect callback's own
 * body. Nested functions are skipped: their `return`s are answers to whoever
 * calls them, not cleanups handed to React.
 */
const repairEffectReturns = (body: types.BlockStatement): number => {
  let repaired = 0

  const needsRepair = (statement: types.Statement): boolean =>
    statement.type === 'ReturnStatement' && isProvablyNotAFunction(statement.argument)

  // tslint:disable-next-line:no-any
  const visit = (node: any): void => {
    if (!node || typeof node !== 'object') {
      return
    }

    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index++) {
        const entry = node[index]
        if (entry && needsRepair(entry)) {
          const replacement = dropReturnedValue(entry)
          node.splice(index, 1, ...replacement)
          // Step past the inserted `return;` — it is already compliant.
          index += replacement.length - 1
          repaired++
          continue
        }
        visit(entry)
      }
      return
    }

    if (typeof node.type !== 'string') {
      return
    }

    // A nested function owns its own returns.
    if (FUNCTION_NODE_TYPES.has(node.type)) {
      return
    }

    // `if (done) return {}` has no statement list to splice into, so the bare
    // statement is promoted to a block holding the repaired pair.
    SINGLE_STATEMENT_KEYS.forEach((key) => {
      const child = node[key]
      if (child && child.type === 'ReturnStatement' && needsRepair(child)) {
        node[key] = types.blockStatement(dropReturnedValue(child))
        repaired++
      }
    })

    Object.keys(node).forEach((key) => {
      if (AST_METADATA_KEYS.has(key) || key.charAt(0) === '_') {
        return
      }
      visit(node[key])
    })
  }

  visit(body)
  return repaired
}

/**
 * Rebuilds an `async` effect callback as a synchronous one that starts the
 * async work and returns nothing.
 *
 * An async function ALWAYS returns a Promise, so `useEffect(async () => …)` is
 * broken by construction however careful its body is. Running the original
 * function as an IIFE keeps its behaviour exactly (React passes an effect
 * callback no arguments, so no parameter is lost) while the effect itself now
 * hands React nothing.
 */
const wrapAsyncCallback = (
  callback: types.ArrowFunctionExpression | types.FunctionExpression
): types.ArrowFunctionExpression =>
  types.arrowFunctionExpression(
    [],
    types.blockStatement([types.expressionStatement(types.callExpression(callback, []))])
  )

/**
 * Brings one effect call in line with the cleanup contract. Returns how many
 * repairs it took, so `0` means the call was already correct.
 */
const repairEffectCall = (call: types.CallExpression | types.OptionalCallExpression): number => {
  const callback = call.arguments[0]
  if (!isFunctionExpression(callback)) {
    // `useEffect(handler, [])` — the callback is defined elsewhere and nothing
    // here can prove what it returns.
    return 0
  }

  // A generator called as an effect callback returns an iterator, but calling
  // one runs NONE of its body, so there is no repair that preserves what the
  // author wrote. Left untouched on purpose.
  if (callback.generator) {
    return 0
  }

  if (callback.async) {
    call.arguments[0] = wrapAsyncCallback(callback)
    return 1
  }

  if (callback.type === 'ArrowFunctionExpression' && callback.body.type !== 'BlockStatement') {
    return repairConciseArrowBody(callback)
  }

  return repairEffectReturns(callback.body as types.BlockStatement)
}

/**
 * Applies the cleanup contract to every effect hook call in an AST.
 *
 * Returns how many callbacks were repaired, which is what a caller wanting to
 * assert "the pipeline emitted nothing broken" checks.
 */
export const normalizeEffectCleanups = (ast: types.Node | null | undefined): number => {
  let repaired = 0

  // tslint:disable-next-line:no-any
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') {
      return
    }

    if (Array.isArray(node)) {
      node.forEach((entry) => walk(entry))
      return
    }

    if (typeof node.type !== 'string') {
      return
    }

    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const hookName = getCalledHookName(node.callee)
      if (hookName && EFFECT_HOOK_NAMES.has(hookName)) {
        // Repaired before descending, so the walk goes on to visit whatever
        // replaced the callback and finds any effect nested inside it.
        repaired += repairEffectCall(node)
      }
    }

    Object.keys(node).forEach((key) => {
      if (AST_METADATA_KEYS.has(key) || key.charAt(0) === '_') {
        return
      }
      walk(node[key])
    })
  }

  walk(ast)
  return repaired
}
