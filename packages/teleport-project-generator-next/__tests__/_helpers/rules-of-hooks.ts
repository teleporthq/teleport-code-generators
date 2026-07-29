/**
 * A minimal Rules-of-Hooks analyser for the React source the Next project
 * generator emits as plain strings.
 *
 * Those component files are template literals, so TypeScript, ESLint and the
 * react-hooks plugin never see them — a hook placed after an early `return`
 * type-checks, lints and builds cleanly and then throws
 * "Rendered more hooks than during the previous render" in the browser on the
 * second render. `tq-countdown` shipped exactly that defect: its `targetDate`
 * useMemo sat below the mounted-guard return, so the component rendered 7 hooks
 * on the first pass and 8 on the next, crashing every page that embedded it.
 *
 * The two conditions checked here are the two that React enforces at runtime:
 *   1. a hook may not run after a statement that can return early
 *   2. a hook may not run inside a condition, loop or try block
 *
 * Hook calls inside NESTED functions (a `useEffect` callback, an event handler,
 * a `.map()` body) belong to that inner function, not the component, so the walk
 * deliberately stops at every function boundary.
 */

import { parse } from '@babel/parser'

type Node = Record<string, unknown> & { type: string; loc?: { start: { line: number } } }

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
])

const CONTROL_FLOW_TYPES = new Set([
  'IfStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'SwitchStatement',
  'TryStatement',
  'ConditionalExpression',
  'LogicalExpression',
])

const HOOK_NAME = /^use[A-Z]/

export type HookViolationKind = 'after-early-return' | 'conditional'

export interface HookViolation {
  kind: HookViolationKind
  hook: string
  /** Enclosing function name, or `<anonymous>`. */
  fn: string
  line: number
}

function isNode(value: unknown): value is Node {
  return !!value && typeof value === 'object' && typeof (value as Node).type === 'string'
}

/** Every child node of `node`, in source order. */
function childNodes(node: Node): Node[] {
  const out: Node[] = []
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') {
      continue
    }
    const value = (node as Record<string, unknown>)[key]
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (isNode(entry)) {
          out.push(entry)
        }
      }
      continue
    }
    if (isNode(value)) {
      out.push(value)
    }
  }
  return out
}

function callName(node: Node): string | null {
  if (node.type !== 'CallExpression') {
    return null
  }
  const callee = node.callee as Node | undefined
  if (!callee) {
    return null
  }
  if (callee.type === 'Identifier') {
    return String((callee as unknown as { name: string }).name)
  }
  // React.useMemo(...) — the hook is the property, not the object.
  if (callee.type === 'MemberExpression') {
    const property = (callee as unknown as { property?: Node }).property
    if (property && property.type === 'Identifier') {
      return String((property as unknown as { name: string }).name)
    }
  }
  return null
}

/** Walks `node` and its descendants, stopping at nested function boundaries. */
function walkOwnScope(
  node: Node,
  visit: (current: Node, insideControlFlow: boolean) => void,
  insideControlFlow = false
): void {
  for (const child of childNodes(node)) {
    if (FUNCTION_TYPES.has(child.type)) {
      continue
    }
    const nested = insideControlFlow || CONTROL_FLOW_TYPES.has(child.type)
    visit(child, insideControlFlow)
    walkOwnScope(child, visit, nested)
  }
}

/** True when `statement` can hand control back to the caller before the next statement runs. */
function canReturnEarly(statement: Node): boolean {
  if (statement.type === 'ReturnStatement' || statement.type === 'ThrowStatement') {
    return true
  }
  let found = false
  walkOwnScope(statement, (current) => {
    if (current.type === 'ReturnStatement' || current.type === 'ThrowStatement') {
      found = true
    }
  })
  return found
}

function functionName(node: Node, parentName: string | null): string {
  const id = (node as unknown as { id?: { name?: string } }).id
  if (id && id.name) {
    return id.name
  }
  return parentName ?? '<anonymous>'
}

function analyseFunction(node: Node, name: string, violations: HookViolation[]): void {
  const body = (node as unknown as { body?: Node }).body
  if (!body || body.type !== 'BlockStatement') {
    return
  }
  const statements = ((body as unknown as { body?: Node[] }).body ?? []).filter(isNode)

  let earlyReturnIndex = -1
  for (let index = 0; index < statements.length; index++) {
    if (canReturnEarly(statements[index])) {
      earlyReturnIndex = index
      break
    }
  }

  statements.forEach((statement, index) => {
    const inspect = (current: Node, insideControlFlow: boolean): void => {
      const called = callName(current)
      if (!called || !HOOK_NAME.test(called)) {
        return
      }
      const line = current.loc ? current.loc.start.line : 0
      if (insideControlFlow || CONTROL_FLOW_TYPES.has(statement.type)) {
        violations.push({ kind: 'conditional', hook: called, fn: name, line })
        return
      }
      if (earlyReturnIndex !== -1 && index > earlyReturnIndex) {
        violations.push({ kind: 'after-early-return', hook: called, fn: name, line })
      }
    }
    inspect(statement, false)
    walkOwnScope(statement, inspect)
  })
}

/**
 * Returns every Rules-of-Hooks violation in `source`.
 *
 * `source` must be a complete ES module — the generators emit exactly that.
 */
export function findRulesOfHooksViolations(source: string): HookViolation[] {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] }) as unknown as Node
  const violations: HookViolation[] = []

  const visit = (node: Node, inferredName: string | null): void => {
    if (FUNCTION_TYPES.has(node.type)) {
      analyseFunction(node, functionName(node, inferredName), violations)
    }
    for (const child of childNodes(node)) {
      // `const TqCountdown = (props) => {...}` — carry the binding name onto the arrow.
      let nextName: string | null = null
      if (node.type === 'VariableDeclarator') {
        const id = (node as unknown as { id?: { name?: string } }).id
        nextName = id && id.name ? id.name : null
      }
      visit(child, nextName)
    }
  }

  visit(ast, null)
  return violations
}
