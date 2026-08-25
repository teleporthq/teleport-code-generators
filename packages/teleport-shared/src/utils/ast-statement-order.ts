import * as types from '@babel/types'
import {
  AST_METADATA_KEYS,
  FUNCTION_NODE_TYPES,
  collectBlockScopedBindings,
  collectReferencedIdentifiers,
} from './ast-scope'

/**
 * ------------------------------------------------------------------
 * Statement placement and ordering for generated function bodies
 * ------------------------------------------------------------------
 *
 * A generated component body is written by a dozen plugins that never see each
 * other's output. Historically each one placed its statements with
 * `body.unshift(...)` or `body.push(...)`, which encodes the position as "the
 * top" / "the bottom" instead of "after what I read" / "before the return".
 * Both spellings are wrong the moment a second plugin also writes to the body:
 *
 *   - `unshift` puts a statement ABOVE declarations an earlier plugin wrote,
 *     so a `useMemo` landed above the `useState` it depends on and the page
 *     died with
 *     `ReferenceError: Cannot access 'ds_0_state' before initialization`.
 *   - `push` puts a statement AFTER the component's `return`, where it is
 *     unreachable — a whole feature silently stops running, with no error at
 *     all to point at it.
 *
 * This module replaces both with intent-revealing primitives
 * ({@link insertStatementsAfterDependencies}, {@link insertStatementsBeforeReturn})
 * and adds {@link normalizeStatementOrder}, the end-of-pipeline net that
 * repairs the two shapes above no matter which plugin produced them.
 *
 * Everything here is a no-op on healthy code: the repairs only rewrite a block
 * once they can prove that block is broken.
 */

/**
 * Index of the `return` at the top level of `body`, or `body.length` when the
 * body has none. Only the FIRST one matters: everything after it is
 * unreachable, so it is the last position at which an inserted statement still
 * runs.
 */
export const findReturnIndex = (body: ReadonlyArray<types.Statement>): number => {
  const index = body.findIndex((statement) => statement.type === 'ReturnStatement')
  return index === -1 ? body.length : index
}

/**
 * Maps every TDZ-governed binding of a block to the index of the statement
 * declaring it. A name declared twice (illegal, but cheap to survive) keeps
 * its first position.
 */
const buildBlockScopedBindingIndex = (
  body: ReadonlyArray<types.Statement>
): Map<string, number> => {
  const index = new Map<string, number>()
  body.forEach((statement, position) => {
    collectBlockScopedBindings(statement).forEach((name) => {
      if (!index.has(name)) {
        index.set(name, position)
      }
    })
  })
  return index
}

/**
 * The earliest index at which `statements` can sit with every block-scoped
 * binding they read already declared — one past the last declaration they
 * depend on, or `0` when they depend on nothing the body declares.
 *
 * Deferred reads count here. Placing a statement further down is always safe
 * (the binding it reads still exists by then), while placing it too high
 * throws, so over-approximating only errs towards correctness.
 *
 * Deliberately the EARLIEST such index rather than "just before the return":
 * that way anything already in the body that wants to read the new bindings
 * sits below the insertion point.
 */
export const findDependencySafeIndex = (
  body: ReadonlyArray<types.Statement>,
  statements: ReadonlyArray<types.Statement>
): number => {
  if (statements.length === 0) {
    return 0
  }

  const referenced = collectReferencedIdentifiers(statements, { includeDeferred: true })
  if (referenced.size === 0) {
    return 0
  }

  let index = 0
  body.forEach((statement, position) => {
    if (collectBlockScopedBindings(statement).some((name) => referenced.has(name))) {
      index = position + 1
    }
  })

  return index
}

/**
 * Inserts `statements` at the earliest position where every binding they read
 * is already in scope. Returns the index they were written to.
 */
export const insertStatementsAfterDependencies = (
  block: types.BlockStatement,
  statements: ReadonlyArray<types.Statement>
): number => {
  const index = findDependencySafeIndex(block.body, statements)
  if (statements.length > 0) {
    block.body.splice(index, 0, ...statements)
  }
  return index
}

/**
 * Inserts `statements` immediately before the body's `return`, so they run on
 * every render — the position for hooks that read nothing the body declares
 * (`useEffect(fn, [])` and friends).
 */
export const insertStatementsBeforeReturn = (
  block: types.BlockStatement,
  statements: ReadonlyArray<types.Statement>
): number => {
  const index = findReturnIndex(block.body)
  if (statements.length > 0) {
    block.body.splice(index, 0, ...statements)
  }
  return index
}

/**
 * Statements that are safe to lift out of a function body's unreachable tail.
 *
 * Only these two shapes, because they are what a misplaced `body.push(...)`
 * produces — a hook call is an `ExpressionStatement`, a hoisted memo is a
 * `const` — and neither can change the meaning of the code it moves past.
 * Everything else stays exactly where it is: a `break`/`continue`/`return`
 * moved above the `return` would REDIRECT control flow rather than restore it,
 * and a `var` or `function` after a `return` is still hoisted, so its binding
 * is observable where it stands.
 */
const isLiftableFromUnreachableTail = (statement: types.Statement): boolean => {
  if (statement.type === 'ExpressionStatement') {
    return true
  }
  return statement.type === 'VariableDeclaration' && statement.kind !== 'var'
}

/**
 * Moves statements that ended up AFTER a function body's `return` back in
 * front of it. A plugin appending with `body.push(...)` produces exactly this:
 * code that looks right in the file, never runs, and reports nothing.
 *
 * Returns whether anything moved.
 */
export const liftUnreachableTail = (block: types.BlockStatement): boolean => {
  const { body } = block
  const returnIndex = findReturnIndex(body)
  if (returnIndex >= body.length - 1) {
    return false
  }

  const tail = body.slice(returnIndex + 1)
  const lifted = tail.filter(isLiftableFromUnreachableTail)
  if (lifted.length === 0) {
    return false
  }

  const kept = tail.filter((statement) => !isLiftableFromUnreachableTail(statement))
  block.body = body.slice(0, returnIndex).concat(lifted, [body[returnIndex]], kept)
  return true
}

/** Removes and returns the smallest entry of `queue`. */
const takeSmallest = (queue: number[]): number => {
  let position = 0
  for (let index = 1; index < queue.length; index++) {
    if (queue[index] < queue[position]) {
      position = index
    }
  }
  return queue.splice(position, 1)[0]
}

const hasAnyReadBefore = (
  reads: Set<string>,
  declaredAt: Map<string, number>,
  position: number
) => {
  let broken = false
  reads.forEach((name) => {
    if ((declaredAt.get(name) as number) > position) {
      broken = true
    }
  })
  return broken
}

/**
 * Reorders a block's statements so no block-scoped binding is read before it
 * is declared — and does nothing at all when none is.
 *
 * The reorder is a STABLE topological sort: statements keep their original
 * relative order except where a dependency forces them apart, so a body that
 * was already valid comes out byte-identical and a broken one comes out as the
 * closest valid arrangement. Only IMMEDIATE reads create an edge; a name read
 * inside a nested function body is read when that function is called, which is
 * always after the whole block has finished evaluating, so forcing an order on
 * it would shuffle correct code for no reason.
 *
 * Hook order stays intact: every statement here is unconditional and at the
 * top level of the body, so whatever order this produces is the order React
 * sees on every single render.
 *
 * A dependency cycle (mutually recursive `const`s, a self-reading declarator)
 * is broken code that no ordering can fix, so the block is left untouched
 * rather than partially rewritten.
 *
 * Returns whether anything moved.
 */
export const repairTemporalDeadZone = (block: types.BlockStatement): boolean => {
  const { body } = block
  if (body.length < 2) {
    return false
  }

  const declaredAt = buildBlockScopedBindingIndex(body)
  if (declaredAt.size === 0) {
    return false
  }

  const names = new Set<string>()
  declaredAt.forEach((_position, name) => names.add(name))

  const readsPerStatement = body.map((statement) =>
    collectReferencedIdentifiers(statement, { only: names })
  )

  const isBroken = readsPerStatement.some((reads, position) =>
    hasAnyReadBefore(reads, declaredAt, position)
  )
  if (!isBroken) {
    return false
  }

  // Every edge is kept, not only the violated ones, so the sort cannot repair
  // one dependency by breaking another that currently happens to hold.
  const dependencies = body.map(() => new Set<number>())
  const dependents: number[][] = body.map(() => [])
  readsPerStatement.forEach((reads, position) => {
    reads.forEach((name) => {
      const source = declaredAt.get(name) as number
      if (source !== position) {
        dependencies[position].add(source)
      }
    })
  })

  const remaining = dependencies.map((entry) => entry.size)
  dependencies.forEach((entry, position) => {
    entry.forEach((source) => dependents[source].push(position))
  })

  const ready: number[] = []
  remaining.forEach((count, position) => {
    if (count === 0) {
      ready.push(position)
    }
  })

  const ordered: types.Statement[] = []
  while (ready.length > 0) {
    const next = takeSmallest(ready)
    ordered.push(body[next])
    dependents[next].forEach((dependent) => {
      remaining[dependent] -= 1
      if (remaining[dependent] === 0) {
        ready.push(dependent)
      }
    })
  }

  if (ordered.length !== body.length) {
    return false
  }

  block.body = ordered
  return true
}

/**
 * Applies both repairs to every block in an AST.
 *
 * Module scope is deliberately left alone: the order of a `Program` body is
 * owned by the chunk linker (imports first, then the component, then its
 * export), and re-deriving it from identifier reads would fight that.
 *
 * Returns how many blocks were repaired, which is what a caller wanting to
 * assert "the pipeline emitted nothing broken" checks.
 */
export const normalizeStatementOrder = (ast: types.Node | null | undefined): number => {
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

    // A parent is visited before its children, so a function body is lifted
    // out of unreachability BEFORE it is visited as a block in its own right
    // and the recovered statements take part in the dependency sort.
    if (FUNCTION_NODE_TYPES.has(node.type) && node.body && node.body.type === 'BlockStatement') {
      if (liftUnreachableTail(node.body)) {
        repaired++
      }
    }

    if (node.type === 'BlockStatement' && repairTemporalDeadZone(node)) {
      repaired++
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
