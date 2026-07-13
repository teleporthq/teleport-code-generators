import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { nodeRegistry } from '../src/nodes'

/**
 * Regression (Vercel "ReferenceError: state_update_local_state is not defined" at
 * "Collecting page data"): node-handlers-client.js / node-handlers-server.js used
 * to emit separate top-level `async function <name>` declarations plus a
 * `module.exports` map that referenced them by name. That forward-reference shape
 * can dangle in production — a bundler/minifier that drops a single-use
 * declaration, or a handler whose emitted name drifts from its map key, leaves the
 * top-level map referencing an undefined identifier, which throws at MODULE-EVAL.
 * The emitter now inlines each handler as its map value (a named function
 * expression), so a dangling reference is structurally impossible.
 */
describe('generateNodeHandlerFile — inline handler map (dangling-proof)', () => {
  const plugin = new NextWorkflowProjectPlugin()
  const code: string = (plugin as any).generateNodeHandlerFile(
    new Set(['state-update-local-state', 'toast-show', 'general-extract-form-data']),
    'client'
  )

  it('inlines each handler inside a self-invoking function map value (no bare forward reference)', () => {
    // The value is an IIFE that runs the handler (possibly multi-statement) and
    // returns its entry function — never a bare top-level declaration reference.
    expect(code).toMatch(/'state-update-local-state':\s*\(function \(\) \{/)
    expect(code).toMatch(/return state_update_local_state;\s*\}\)\(\)/)
    // The old fragile shape — a bare `'x-y': x_y` identifier reference — must be gone.
    expect(code).not.toMatch(/'state-update-local-state':\s*state_update_local_state\s*[,}]/)
  })

  it('has no dangling map reference (every value is defined at its own site)', () => {
    const entry = /['"]([a-z0-9]+(?:-[a-z0-9]+)+)['"]\s*:\s*([a-z0-9]+(?:_[a-z0-9]+)+)\b/g
    const dangling: string[] = []
    let m: RegExpExecArray | null = entry.exec(code)
    while (m !== null) {
      const [, key, ident] = m
      if (key.replace(/-/g, '_') === ident && !new RegExp(`function ${ident}\\b`).test(code)) {
        dangling.push(ident)
      }
      m = entry.exec(code)
    }
    expect(dangling).toEqual([])
  })

  it('evaluates as a CommonJS module without ReferenceError and exposes callable handlers', () => {
    const moduleObj = { exports: {} as Record<string, unknown> }
    // Simulate Next.js module-eval (the "Collecting page data" require). If a map
    // value referenced an undefined identifier this would throw ReferenceError.
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', code)(moduleObj, moduleObj.exports)
    expect(typeof moduleObj.exports['state-update-local-state']).toBe('function')
    expect(typeof moduleObj.exports['toast-show']).toBe('function')
    expect(typeof moduleObj.exports['general-extract-form-data']).toBe('function')
  })
})

/**
 * Whole-registry contract: EVERY node type must produce a syntactically valid,
 * module-eval-safe handler file in BOTH environments. The narrow 3-handler test
 * above only exercised single-function CLIENT handlers, so it missed the class
 * of handlers that emit MULTIPLE top-level statements — AI nodes
 * (`generateAIProviderUtils() + '\n\n' + <fn>`), `payment-charge-user` and
 * `general-rate-limiter` (function + appended helper declarations). Inlining
 * those as a bare object-literal value produced `'ai-custom-prompt': var … `,
 * a SyntaxError that crashed `require()` of node-handlers-server.js. This test
 * evaluates the generated file for every registry type in both envs — the exact
 * loop that surfaced the regression — so any future multi-statement or
 * name-drifting handler fails CI here instead of at a Vercel build.
 */
describe('generateNodeHandlerFile — every registry node type is eval-safe in both envs', () => {
  const plugin = new NextWorkflowProjectPlugin()
  const allTypes = Object.keys(nodeRegistry)

  for (const env of ['client', 'server'] as const) {
    it(`compiles + evaluates a file containing every node type (${env})`, () => {
      const code: string = (plugin as any).generateNodeHandlerFile(new Set(allTypes), env)
      // Empty is legal only if no handler is relevant to this env — never here.
      expect(code.length).toBeGreaterThan(0)

      const moduleObj = { exports: {} as Record<string, unknown> }
      expect(() => {
        // eslint-disable-next-line no-new-func
        new Function('module', 'exports', code)(moduleObj, moduleObj.exports)
      }).not.toThrow()

      // Each emitted map value must resolve to a callable handler (the IIFE
      // returned the entry function, not `undefined` from a name drift).
      for (const key of Object.keys(moduleObj.exports)) {
        expect(typeof moduleObj.exports[key]).toBe('function')
      }
    })

    it(`emits an eval-safe single-type file for each node type individually (${env})`, () => {
      const offenders: string[] = []
      for (const type of allTypes) {
        const code: string = (plugin as any).generateNodeHandlerFile(new Set([type]), env)
        if (!code) {
          continue // handler not relevant to this env — nothing emitted
        }
        try {
          const moduleObj = { exports: {} as Record<string, unknown> }
          // eslint-disable-next-line no-new-func
          new Function('module', 'exports', code)(moduleObj, moduleObj.exports)
          if (typeof moduleObj.exports[type] !== 'function') {
            offenders.push(`${type} (value not callable)`)
          }
        } catch (err) {
          offenders.push(`${type} (${(err as Error).message})`)
        }
      }
      expect(offenders).toEqual([])
    })
  }
})
