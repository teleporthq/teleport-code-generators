import generate from '@babel/generator'
import { parse } from '@babel/parser'
import * as types from '@babel/types'
import { ASTEffectCleanup } from '../../src'

const { EFFECT_HOOK_NAMES, isProvablyNotAFunction, normalizeEffectCleanups } = ASTEffectCleanup

const parseFile = (code: string): types.File =>
  parse(code, { sourceType: 'module', plugins: ['jsx'] })

const print = (node: types.Node): string => generate(node).code

/** Normalizes `code` and reports both the repair count and the printed result. */
const normalize = (code: string): { repaired: number; code: string } => {
  const file = parseFile(code)
  const repaired = normalizeEffectCleanups(file)
  return { repaired, code: print(file) }
}

/**
 * A single expression, parsed in parentheses so a bare string is an expression
 * rather than a module directive and `function`/`class` read as expressions.
 */
const expressionOf = (code: string): types.Expression => {
  const file = parse(`(${code})`, {
    sourceType: 'module',
    plugins: ['jsx'],
    allowAwaitOutsideFunction: true,
  })
  return (file.program.body[0] as types.ExpressionStatement).expression
}

/**
 * Runs an effect callback the way React does — call it, then call whatever it
 * returned as the cleanup — and reports what happened. This is the behaviour
 * the whole module exists to protect: React stores an effect's return value
 * and invokes it blindly on unmount.
 */
const mountAndUnmount = (
  callbackSource: string
): { threw: string | null; cleanupRan: boolean; effectRan: boolean } => {
  let effectRan = false
  let cleanupRan = false
  // tslint:disable-next-line:function-constructor
  const factory = new Function('markEffect', 'markCleanup', `return (${callbackSource})`) as (
    markEffect: () => void,
    markCleanup: () => void
  ) => () => unknown
  const callback = factory(
    () => {
      effectRan = true
    },
    () => {
      cleanupRan = true
    }
  )

  const destroy = callback()
  if (destroy === undefined) {
    return { threw: null, cleanupRan, effectRan }
  }
  try {
    // Exactly what react-dom's `safelyCallDestroy` does with the value.
    ;(destroy as () => void)()
  } catch (error) {
    return { threw: (error as Error).message, cleanupRan, effectRan }
  }
  return { threw: null, cleanupRan, effectRan }
}

/** The first effect callback of a normalized program, as source text. */
const normalizedCallback = (code: string): string => {
  const file = parseFile(code)
  normalizeEffectCleanups(file)
  let callback: types.Node | null = null
  types.traverseFast(file, (node) => {
    if (callback || node.type !== 'CallExpression') {
      return
    }
    const { callee } = node
    if (callee.type === 'Identifier' && EFFECT_HOOK_NAMES.has(callee.name)) {
      callback = node.arguments[0]
    }
  })
  return print(callback as unknown as types.Node)
}

describe('isProvablyNotAFunction', () => {
  it('proves the shapes whose result type the language fixes', () => {
    const provable = [
      "'text'",
      '42',
      'true',
      'null',
      // tslint:disable-next-line:no-invalid-template-strings
      '`a${b}c`',
      '({ a: 1 })',
      '[1, 2]',
      '/re/g',
      'typeof value',
      'void 0',
      '!value',
      'a + b',
      'a instanceof B',
      'counter++',
      "(sideEffect(), 'done')",
      "import('@google/model-viewer')",
    ]
    provable.forEach((source) => {
      expect({ source, provable: isProvablyNotAFunction(expressionOf(source)) }).toEqual({
        source,
        provable: true,
      })
    })
  })

  it('refuses to guess for anything that can still yield a function', () => {
    const unknown = [
      'subscribe()',
      'a || b',
      'cond ? a : b',
      'new Cleanup()',
      'await promise',
      'handlers.stop',
      '() => stop()',
      'function () {}',
      'class Cleanup {}',
      '(sideEffect(), makeCleanup())',
    ]
    unknown.forEach((source) => {
      expect({ source, provable: isProvablyNotAFunction(expressionOf(source)) }).toEqual({
        source,
        provable: false,
      })
    })
  })
})

describe('normalizeEffectCleanups — the shape that shipped', () => {
  it('stops a concise dynamic import from being handed back as the cleanup', () => {
    const before = "() => import('@google/model-viewer')"

    const { repaired, code } = normalize(`useEffect(${before}, [])`)
    expect(repaired).toBe(1)
    expect(code).toContain("import('@google/model-viewer')")
    expect(code).not.toMatch(/useEffect\(\(\) => import/)

    // A real `import()` cannot be evaluated inside jest's vm, so the same
    // shape is exercised with the value it produces: a Promise. Before the
    // repair React's `safelyCallDestroy` calls it and throws — after it, the
    // import still runs and nothing is handed back.
    const asPromise = (source: string) =>
      source.replace("import('@google/model-viewer')", '(markEffect(), Promise.resolve())')
    expect(mountAndUnmount(asPromise(before)).threw).toMatch(/is not a function/)
    expect(mountAndUnmount(asPromise(normalizedCallback(`useEffect(${before}, [])`)))).toEqual({
      threw: null,
      cleanupRan: false,
      effectRan: true,
    })
  })

  it('leaves an effect that already returns a real cleanup untouched', () => {
    const source = [
      'useEffect(() => {',
      '  const timer = setTimeout(run, 300)',
      '  return () => clearTimeout(timer)',
      '}, [query])',
    ].join('\n')
    const { repaired, code } = normalize(source)
    expect(repaired).toBe(0)
    expect(code).toBe(print(parseFile(source)))
  })

  it('leaves a call-returned cleanup alone — an explicit return states intent', () => {
    const source = 'useEffect(() => {\n  return setupLifecycleTriggers()\n}, [])'
    expect(normalize(source).repaired).toBe(0)
  })

  it('leaves a concise arrow that returns an arrow alone', () => {
    const source = 'useEffect(() => () => unsubscribe(), [])'
    expect(normalize(source).repaired).toBe(0)
  })
})

describe('normalizeEffectCleanups — concise bodies', () => {
  it('drops a provably non-callable value outright, with no guard left behind', () => {
    const { repaired, code } = normalize('useEffect(() => ({ mounted: true }), [])')
    expect(repaired).toBe(1)
    expect(code).toContain('mounted: true')
    expect(code).not.toContain('return')
    expect(code).not.toContain('__tqEffectCleanup')
  })

  it('gates an unprovable value so a real cleanup survives and junk does not', () => {
    const callback = normalizedCallback('useEffect(() => subscribe(), [])')
    expect(callback).toContain('__tqEffectCleanup')

    const keepsCleanup = mountAndUnmount(
      callback.replace('subscribe()', '(markEffect(), markCleanup)')
    )
    expect(keepsCleanup).toEqual({ threw: null, cleanupRan: true, effectRan: true })

    const swallowsJunk = mountAndUnmount(
      callback.replace('subscribe()', '(markEffect(), Promise.resolve())')
    )
    expect(swallowsJunk).toEqual({ threw: null, cleanupRan: false, effectRan: true })
  })

  it('picks a free name so the guard cannot shadow what the value reads', () => {
    const callback = normalizedCallback('useEffect(() => subscribe(__tqEffectCleanup), [])')
    expect(callback).toContain('const __tqEffectCleanup2 =')
    expect(callback).toContain('subscribe(__tqEffectCleanup)')
  })
})

describe('normalizeEffectCleanups — block bodies', () => {
  it('keeps an early exit while dropping the value it returned', () => {
    const { repaired, code } = normalize(
      ['useEffect(() => {', '  if (skip) return {}', '  run()', '}, [])'].join('\n')
    )
    expect(repaired).toBe(1)
    expect(code).toContain('({});')
    expect(code).toContain('return;')

    const callback = normalizedCallback(
      ['useEffect(() => {', '  if (true) return {}', '  markEffect()', '}, [])'].join('\n')
    )
    // The early exit still happens — the statement after it never runs.
    expect(mountAndUnmount(callback)).toEqual({ threw: null, cleanupRan: false, effectRan: false })
  })

  it('repairs returns nested in control flow, including bare ones', () => {
    const { repaired, code } = normalize(
      [
        'useEffect(() => {',
        '  try {',
        '    for (const item of items) {',
        '      if (item) return [item]',
        '    }',
        '  } catch (error) {',
        "    return 'failed'",
        '  }',
        '}, [items])',
      ].join('\n')
    )
    expect(repaired).toBe(2)
    expect(code).not.toMatch(/return \[item\]/)
    expect(code).not.toMatch(/return 'failed'/)
  })

  it('never touches the returns of a function nested inside the callback', () => {
    const source = [
      'useEffect(() => {',
      '  const compute = () => ({ total: 1 })',
      '  window.compute = compute',
      '}, [])',
    ].join('\n')
    expect(normalize(source).repaired).toBe(0)
  })
})

describe('normalizeEffectCleanups — callback kinds', () => {
  it('wraps an async callback so the Promise never reaches React', () => {
    const { repaired, code } = normalize('useEffect(async () => {\n  await load()\n}, [])')
    expect(repaired).toBe(1)
    expect(code).toContain('(async () => {')
    expect(code).toContain('})();')

    const callback = normalizedCallback('useEffect(async () => {\n  markEffect()\n}, [])')
    expect(mountAndUnmount(callback)).toEqual({ threw: null, cleanupRan: false, effectRan: true })
  })

  it('covers useLayoutEffect, useInsertionEffect and the React namespace', () => {
    expect(normalize('useLayoutEffect(() => {\n  measure()\n}, [])').repaired).toBe(0)
    expect(normalize('useLayoutEffect(() => ({ x: 1 }), [])').repaired).toBe(1)
    expect(normalize("useInsertionEffect(() => 'css', [])").repaired).toBe(1)
    expect(normalize("React.useEffect(() => import('lib'), [])").repaired).toBe(1)
    // A same-named method on an unrelated object has no cleanup contract.
    expect(normalize('scheduler.useEffect(() => ({ id: 1 }), [])').repaired).toBe(0)
  })

  it('ignores hooks it cannot inspect and hooks that are not effects', () => {
    expect(normalize('useEffect(handleMount, [])').repaired).toBe(0)
    expect(normalize('useMemo(() => ({ a: 1 }), [])').repaired).toBe(0)
    expect(normalize('useCallback(() => ({ a: 1 }), [])').repaired).toBe(0)
    // A generator body does not run when the function is called, so there is
    // no faithful repair — it is deliberately left as written.
    expect(normalize('useEffect(function* () {\n  yield 1\n}, [])').repaired).toBe(0)
  })

  it('reaches effects nested inside other effects and inside components', () => {
    const { repaired } = normalize(
      [
        'const Page = () => {',
        "  useEffect(() => import('a'), [])",
        '  useEffect(() => {',
        "    useEffect(() => import('b'), [])",
        '  }, [])',
        '  return null',
        '}',
      ].join('\n')
    )
    expect(repaired).toBe(2)
  })

  it('is a no-op on an AST with no effects at all', () => {
    const source = 'const total = items.reduce((sum, item) => sum + item, 0)'
    const { repaired, code } = normalize(source)
    expect(repaired).toBe(0)
    expect(code).toBe(print(parseFile(source)))
  })
})
