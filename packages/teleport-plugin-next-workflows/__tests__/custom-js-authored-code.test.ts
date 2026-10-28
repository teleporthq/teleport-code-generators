import { generateServerSegmentAPIRoute } from '../src/api-route-generator'
import { generateSharedRuntimeUtilsCode } from '../src/executor-generator'
import { assertWorkflowsAreSecure, CodegenSecurityError } from '../src/security-scanner'
import { findProjectCodeViolations } from '../src/project-code-scanner'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'

/**
 * A custom-JS step's code, and a condition's mode, are only ever what the
 * author wrote. The runtime resolves every config field before a handler runs:
 * a step whose code is `{{state.code}}` used to compile the code a visitor's
 * request carried in its page state, which reached the real `process` through
 * a `.constructor` escape (the precheck review's probe). The generated route
 * now drops code that is not authored text, and the code generator refuses to
 * generate it.
 */

const SECRET = 'postgres://REAL-SECRET'
const scope = globalThis as Record<string, unknown>
const ESCAPE =
  "function customHandler(params) { var p = (function(){}).constructor('return process')(); return { leak: p.env.TELEPORT_DB_CONNECTION_STRING }; }"

const originalSecret = process.env.TELEPORT_DB_CONNECTION_STRING
beforeEach(() => {
  process.env.TELEPORT_DB_CONNECTION_STRING = SECRET
  delete scope.__tqModePwned
})
afterAll(() => {
  if (originalSecret === undefined) {
    delete process.env.TELEPORT_DB_CONNECTION_STRING
  } else {
    process.env.TELEPORT_DB_CONNECTION_STRING = originalSecret
  }
  delete scope.__tqModePwned
})

const segmentOf = (nodes: any[]): WorkflowSegment => ({
  id: 'server-1',
  env: 'server',
  nodeIds: nodes.map((n) => n.id),
  nodes,
  edges: [],
  entryNodeIds: [nodes[0].id],
})

/** The generated segment route, run with the server runtime, answering a visitor's request. */
async function runRoute(segment: WorkflowSegment, context: Record<string, unknown>) {
  const runtime = loadServerRuntime()
  const requireStub = (id: string) => (id.endsWith('server-runtime') ? runtime : {})
  const routeModule: { exports: any } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', generateServerSegmentAPIRoute(segment, 'Quote'))(
    routeModule,
    routeModule.exports,
    requireStub
  )
  const reply = { status: 0, body: null as any }
  const res = {
    status(code: number) {
      reply.status = code
      return this
    },
    json(payload: unknown) {
      reply.body = payload
      return this
    },
  }
  await (routeModule.exports as (req: unknown, res: unknown) => Promise<void>)(
    { method: 'POST', body: { context }, headers: { host: 'localhost:3000' } },
    res
  )
  return reply
}

describe('a custom-JS step runs only the code the author wrote', () => {
  it.each([
    ['a {{state.…}} token', '{{state.code}}'],
    [
      'a page-state reference',
      { type: 'workflowContext', nodeId: '__stateValues', path: ['__stateValues', 'code'] },
    ],
  ])('never compiles a visitor’s code bound by %s', async (_kind, code) => {
    const reply = await runRoute(
      segmentOf([
        {
          id: 'q-js',
          type: 'general-custom-js',
          label: 'Shape quote',
          stepNumber: 1,
          config: { code, context: 'server' },
        },
      ]),
      { __stateValues: { code: ESCAPE } }
    )
    expect(JSON.stringify(reply.body)).not.toContain(SECRET)
    expect(reply.body?.results?.['q-js']?.leak).toBeUndefined()
  })

  it('still runs the code the author wrote', async () => {
    const reply = await runRoute(
      segmentOf([
        {
          id: 'q-js',
          type: 'general-custom-js',
          label: 'Shape quote',
          stepNumber: 1,
          config: {
            code: 'function customHandler(params) { return { total: 42 }; }',
            context: 'server',
          },
        },
      ]),
      {}
    )
    expect(reply.status).toBe(200)
    expect(reply.body.results['q-js']).toEqual({ total: 42 })
  })
})

describe('a condition’s mode is the one the author wrote', () => {
  const utils: { exports: Record<string, any> } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', generateSharedRuntimeUtilsCode())(utils, utils.exports)
  const runtime = utils.exports
  const PAYLOAD = '(globalThis.__tqModePwned = true)'

  it('an if step whose mode is a token never compiles its condition', () => {
    const authored = { conditionType: '{{state.mode}}', condition: PAYLOAD }
    const context = { __stateValues: { mode: 'expression' } }
    const resolved = runtime.resolveConfig(authored, context)
    expect(resolved.conditionType).toBe('expression')
    runtime.evaluateCondition(resolved, context, authored)
    expect(scope.__tqModePwned).toBeUndefined()
  })

  it('a switch whose mode is a reference never compiles its cases', () => {
    const authored = {
      switchValue: 1,
      comparisonMode: {
        type: 'workflowContext',
        nodeId: '__stateValues',
        path: ['__stateValues', 'mode'],
      },
      cases: [{ id: 'a', condition: PAYLOAD }],
    }
    const context = { __stateValues: { mode: 'expression' } }
    runtime.matchSwitchCase(authored, runtime.resolveConfig(authored, context), context)
    expect(scope.__tqModePwned).toBeUndefined()
  })

  it('an authored expression mode still compiles', () => {
    const authored = { conditionType: 'expression', condition: 'context.n > 1' }
    expect(runtime.evaluateCondition(authored, { n: 2 }, authored)).toBe(true)
  })
})

describe('the code generator refuses code that is a reference', () => {
  const workflowWith = (code: unknown) => ({
    workflows: {
      wf: {
        id: 'wf',
        name: 'Quote',
        nodes: [{ id: 'q-js', type: 'general-custom-js', config: { code } }],
      },
    },
  })

  it.each([
    ['a {{…}} token', '{{state.code}}'],
    ['a context value', { type: 'workflowContext', nodeId: 'n1', path: ['code'] }],
    ['a secret reference', 'WORKFLOW_SECRET_CODE'],
    ['an inserted value', '<span class="context-value-inline">code</span>'],
  ])('refuses a custom-JS step whose code is %s', (_kind, code) => {
    let error: unknown
    try {
      assertWorkflowsAreSecure(workflowWith(code) as never)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(CodegenSecurityError)
    expect((error as CodegenSecurityError).violations[0]).toMatchObject({
      nodeId: 'q-js',
      rule: 'unreadable-step-code',
    })
  })

  it('refuses custom JS that reads the whole environment, or a key it builds, as the editor does', () => {
    for (const [code, rule] of [
      ['function customHandler() { return { env: process.env }; }', 'process-without-property'],
      ['function customHandler(p) { return process.env[p.name]; }', 'dynamic-env-access'],
    ]) {
      let error: unknown
      try {
        assertWorkflowsAreSecure(workflowWith(code) as never)
      } catch (caught) {
        error = caught
      }
      expect((error as CodegenSecurityError).violations.map((v) => v.rule)).toContain(rule)
    }
    expect(() =>
      assertWorkflowsAreSecure(
        workflowWith(
          "function customHandler() { var KEY = 'MY_API_URL'; return { url: process.env ? process.env[KEY] : '' }; }"
        ) as never
      )
    ).not.toThrow()
  })

  it('generates authored code', () => {
    expect(() =>
      assertWorkflowsAreSecure(
        workflowWith('function customHandler(params) { return params[0]; }') as never
      )
    ).not.toThrow()
  })
})

describe('the code generator reads the code pages run on the server', () => {
  const pageWith = (node: unknown, stateDefinitions: Record<string, unknown> = {}) => ({
    root: { name: 'Root', stateDefinitions, node },
    components: {},
  })
  const text = (content: string) => ({ type: 'expr', content })

  it('refuses a state mapping function that escapes the sandbox', () => {
    const violations = findProjectCodeViolations(
      pageWith(text('items.length'), {
        items: {
          type: 'array',
          defaultValue: [],
          mappingFunction: `function mapData(items) { return (function(){}).constructor('return process')().env }`,
        },
      })
    )
    expect(violations.map((v) => v.rule)).toContain('sandbox-escape-constructor')
  })

  it('refuses an expression the page prerenders that reads a platform secret', () => {
    expect(
      findProjectCodeViolations(pageWith(text('process.env.NEXTAUTH_SECRET'))).map((v) => v.rule)
    ).toContain('protected-env-access')
  })

  // The editor's gate refuses these as process-without-property,
  // dynamic-env-access and sandbox-escape-function; the code generator's
  // page check runs the same custom-code rules.
  it.each([
    ['the whole environment', 'process.env', 'process-without-property'],
    [
      'a secret by a key it builds',
      'process.env[["NEXTAUTH","SECRET"].join("_")]',
      'dynamic-env-access',
    ],
    [
      'the environment through the Function constructor',
      'new Function("return process.env")()',
      'sandbox-escape-function',
    ],
  ])('refuses a page expression that reads %s', (_kind, code, rule) => {
    expect(findProjectCodeViolations(pageWith(text(code))).map((v) => v.rule)).toContain(rule)
  })

  it('reads an expression however deep the page nests it', () => {
    let node: unknown = text('process.env.NEXTAUTH_SECRET')
    for (let depth = 0; depth < 400; depth++) {
      node = { type: 'element', content: { elementType: 'container', children: [node] } }
    }
    expect(findProjectCodeViolations(pageWith(node)).map((v) => v.rule)).toContain(
      'protected-env-access'
    )
  })

  it('leaves process.env that is only tested, or read by a key the code spells out', () => {
    expect(
      findProjectCodeViolations(
        pageWith(
          text(
            "typeof process !== 'undefined' && process.env ? process.env['NEXT_PUBLIC_SITE'] : ''"
          )
        )
      )
    ).toEqual([])
  })

  it('generates the expressions and mapping functions the editor writes', () => {
    expect(
      findProjectCodeViolations(
        pageWith(
          {
            type: 'element',
            content: { elementType: 'text', children: [text('product?.[\'name\'] || "Product"')] },
          },
          {
            items: {
              type: 'array',
              defaultValue: [],
              mappingFunction: 'function mapData(items) { return items.slice(0, 3) }',
            },
          }
        )
      )
    ).toEqual([])
  })
})
