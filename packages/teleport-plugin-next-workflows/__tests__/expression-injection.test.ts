import { generateServerSegmentAPIRoute } from '../src/api-route-generator'
import { generateSharedRuntimeUtilsCode } from '../src/executor-generator'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'

// An if / switch / while expression is compiled only when the AUTHOR wrote its
// text. Text that comes from the context — a node result, a page state, a form
// field — is a value: it is read as data and never reaches new Function, so a
// request cannot run code on the server (A2-07). Each test plants a payload
// that would set a global flag if it were ever executed.

const scope = globalThis as Record<string, unknown>
const PAYLOAD = '(globalThis.__tqExpressionPwned = true)'

beforeEach(() => {
  delete scope.__tqExpressionPwned
})
afterAll(() => {
  delete scope.__tqExpressionPwned
})

function loadUtils(): Record<string, any> {
  const utils: { exports: Record<string, any> } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', generateSharedRuntimeUtilsCode())(utils, utils.exports)
  return utils.exports
}

const stateRef = {
  type: 'workflowContext',
  nodeId: '__stateValues',
  path: ['__stateValues', 'cond'],
}

describe('runtime — only authored expressions are compiled', () => {
  const utils = loadUtils()

  it('runs an if expression the author wrote', () => {
    const authored = { conditionType: 'expression', condition: 'context.n > 1' }
    expect(utils.evaluateCondition(authored, { n: 2 }, authored)).toBe(true)
    expect(utils.evaluateCondition(authored, { n: 0 }, authored)).toBe(false)
  })

  it('reads a bound if condition as data, never as code', () => {
    const authored = { conditionType: 'expression', condition: stateRef }
    const context = { __stateValues: { cond: PAYLOAD } }
    const resolved = utils.resolveConfig(authored, context)
    expect(resolved.condition).toBe(PAYLOAD)
    // A non-empty string is truthy data; the payload never ran.
    expect(utils.evaluateCondition(resolved, context, authored)).toBe(true)
    expect(scope.__tqExpressionPwned).toBeUndefined()
    const falsy = utils.resolveConfig(authored, { __stateValues: { cond: 'false' } })
    expect(utils.evaluateCondition(falsy, {}, authored)).toBe(false)
  })

  it('reads a {{state.…}} token condition as data', () => {
    const authored = { conditionType: 'expression', condition: '{{state.cond}}' }
    const context = { __stateValues: { cond: PAYLOAD } }
    const resolved = utils.resolveConfig(authored, context)
    utils.evaluateCondition(resolved, context, authored)
    expect(scope.__tqExpressionPwned).toBeUndefined()
  })

  it('compiles only authored switch cases, the switch value handed in as data', () => {
    const authored = {
      switchValue: 5,
      comparisonMode: 'expression',
      cases: [
        { id: 'bound', condition: stateRef },
        { id: 'big', condition: 'value > 3' },
      ],
    }
    const context = { __stateValues: { cond: '' } }
    expect(utils.matchSwitchCase(authored, utils.resolveConfig(authored, context), context)).toBe(
      'big'
    )
    const hostile = { __stateValues: { cond: PAYLOAD } }
    // A bound case is a value: a non-empty one matches as truthy data, unrun.
    expect(utils.matchSwitchCase(authored, utils.resolveConfig(authored, hostile), hostile)).toBe(
      'bound'
    )
    expect(scope.__tqExpressionPwned).toBeUndefined()
  })

  it('never compiles request text in the client executor either', async () => {
    const node = {
      id: 'route',
      type: 'general-switch',
      stepNumber: 1,
      config: {
        switchValue: 1,
        comparisonMode: 'expression',
        cases: [{ id: 'a', condition: stateRef }],
      },
    }
    const context: Record<string, unknown> = { __stateValues: { cond: PAYLOAD } }
    await utils.executeNodes([node], [], context, {}, {}, null, 'run')
    expect(context.route).toEqual({ matchedCase: 'a' })
    expect(scope.__tqExpressionPwned).toBeUndefined()
  })
})

describe('generated server segment — a request cannot run code through an expression', () => {
  function run(segment: WorkflowSegment, context: Record<string, unknown>) {
    const runtime = loadServerRuntime()
    const requireStub = (id: string) => (id.endsWith('server-runtime') ? runtime : {})
    const routeModule: { exports: any } = { exports: {} }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('module', 'exports', 'require', generateServerSegmentAPIRoute(segment, 'Expr'))(
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
    return (routeModule.exports as (req: unknown, res: unknown) => Promise<void>)(
      { method: 'POST', body: { context }, headers: { host: 'localhost:3000' } },
      res
    ).then(() => reply)
  }

  const segmentOf = (nodes: any[]): WorkflowSegment => ({
    id: 'server-1',
    env: 'server',
    nodeIds: nodes.map((n) => n.id),
    nodes,
    edges: [],
    entryNodeIds: nodes.map((n) => n.id),
  })

  it('an if-statement bound to page state', async () => {
    const segment = segmentOf([
      {
        id: 'gate',
        type: 'general-if-statement',
        label: 'Gate',
        stepNumber: 1,
        config: { conditionType: 'expression', condition: '{{state.cond}}' },
      },
    ])
    const reply = await run(segment, { __stateValues: { cond: PAYLOAD } })
    expect(reply.status).toBe(200)
    expect(scope.__tqExpressionPwned).toBeUndefined()
  })

  it('a switch whose case is bound to page state', async () => {
    const segment = segmentOf([
      {
        id: 'route',
        type: 'general-switch',
        label: 'Route',
        stepNumber: 1,
        config: {
          switchValue: 1,
          comparisonMode: 'expression',
          cases: [{ id: 'a', condition: stateRef }],
        },
      },
    ])
    const reply = await run(segment, { __stateValues: { cond: PAYLOAD } })
    expect(reply.status).toBe(200)
    expect(reply.body.results.route).toEqual({ matchedCase: 'a' })
    expect(scope.__tqExpressionPwned).toBeUndefined()
  })
})

describe('runtime — a context chip in an authored expression is a named argument', () => {
  const utils = loadUtils()
  const chip = (nodeId: string, field: string) =>
    `<span class="context-value-inline" data-ctx-node-id="${nodeId}" data-ctx-path="[&quot;${nodeId}&quot;,&quot;${field}&quot;]">${field}</span>`

  it('compares the switch value with the chip value, as HEAD compiled it', () => {
    const authored = {
      switchValue: 5,
      comparisonMode: 'expression',
      cases: [
        { id: 'big', condition: 'value > ' + chip('n1', 'max') },
        { id: 'small', condition: 'value <= ' + chip('n1', 'max') },
      ],
    }
    const context = { n1: { max: 100 } }
    expect(utils.matchSwitchCase(authored, utils.resolveConfig(authored, context), context)).toBe(
      'small'
    )
    const lower = { n1: { max: 2 } }
    expect(utils.matchSwitchCase(authored, utils.resolveConfig(authored, lower), lower)).toBe('big')
  })

  it('passes a quoted chip as a string and never as code', () => {
    const authored = {
      conditionType: 'expression',
      condition: "context.plan === '" + chip('n1', 'plan') + "'",
    }
    expect(utils.evaluateCondition(authored, { plan: 'pro', n1: { plan: 'pro' } }, authored)).toBe(
      true
    )
    const hostile = {
      plan: 'pro',
      n1: { plan: "x' || (globalThis.__tqExpressionPwned = true) || '" },
    }
    expect(utils.evaluateCondition(authored, hostile, authored)).toBe(false)
    expect(scope.__tqExpressionPwned).toBeUndefined()
  })

  it('passes the reference parts of a parts array as arguments', () => {
    const authored = {
      conditionType: 'expression',
      condition: [
        'context.total > ',
        { type: 'workflowContext', nodeId: 'n1', path: ['n1', 'limit'] },
      ],
    }
    expect(utils.evaluateCondition(authored, { total: 10, n1: { limit: 3 } }, authored)).toBe(true)
    expect(utils.evaluateCondition(authored, { total: 1, n1: { limit: PAYLOAD } }, authored)).toBe(
      false
    )
    expect(scope.__tqExpressionPwned).toBeUndefined()
  })

  it('reads a whole-token condition by the truth of the value it names', () => {
    const authored = { conditionType: 'expression', condition: '{{state.count}}' }
    for (const [count, expected] of [
      ['0', false],
      ['3', true],
      ['false', false],
      ['', false],
    ] as Array<[string, boolean]>) {
      const context = { __stateValues: { count } }
      expect(
        utils.evaluateCondition(utils.resolveConfig(authored, context), context, authored)
      ).toBe(expected)
    }
  })
})

describe('generated server segment — a transform expression bound to a value never runs', () => {
  it('drops a bound map expression and runs the authored one', async () => {
    const runtime = loadServerRuntime()
    const requireStub = (id: string) => (id.endsWith('server-runtime') ? runtime : {})
    const segment: WorkflowSegment = {
      id: 'server-1',
      env: 'server',
      nodeIds: ['bound', 'authored'],
      nodes: [
        {
          id: 'bound',
          type: 'transform-array',
          label: 'Bound',
          stepNumber: 1,
          config: { operation: 'map', input: [1, 2], mapExpression: '{{state.code}}' },
        },
        {
          id: 'authored',
          type: 'transform-array',
          label: 'Authored',
          stepNumber: 2,
          config: { operation: 'map', input: [1, 2], mapExpression: 'return item * 10' },
        },
      ] as any,
      edges: [],
      entryNodeIds: ['bound', 'authored'],
    }
    const routeModule: { exports: any } = { exports: {} }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('module', 'exports', 'require', generateServerSegmentAPIRoute(segment, 'Expr'))(
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
    await routeModule.exports(
      {
        method: 'POST',
        body: {
          context: { __stateValues: { code: 'globalThis.__tqExpressionPwned = true; return 0' } },
        },
        headers: { host: 'localhost:3000' },
      },
      res
    )
    expect(reply.status).toBe(200)
    expect(scope.__tqExpressionPwned).toBeUndefined()
    expect(reply.body.results.bound.result).toEqual([1, 2])
    expect(reply.body.results.authored.result).toEqual([10, 20])
  })
})

describe('runtime — a condition that is only a context chip reads the word it spells (N1)', () => {
  const utils = loadUtils()
  const chip =
    '<span class="context-value-inline" data-ctx-node-id="n1" data-ctx-path="[&quot;n1&quot;,&quot;flag&quot;]">flag</span>'

  it.each([
    ['false', false],
    ['0', false],
    ['', false],
    [0, false],
    [false, false],
    ['yes', true],
    [true, true],
    [2, true],
  ])('an if whose condition is one chip holding %p is %p', (flag, expected) => {
    for (const condition of [chip, '<p>' + chip + '&nbsp;</p>', ' ' + chip + ' ']) {
      const authored = { conditionType: 'expression', condition }
      const context = { n1: { flag } }
      expect(
        utils.evaluateCondition(utils.resolveConfig(authored, context), context, authored)
      ).toBe(expected)
    }
    const parts = {
      conditionType: 'expression',
      condition: [{ type: 'workflowContext', nodeId: 'n1', path: ['n1', 'flag'] }],
    }
    expect(utils.evaluateCondition(parts, { n1: { flag } }, parts)).toBe(expected)
  })

  it('keeps {{ }} text beside code a clean false (the editor warns the author)', () => {
    const authored = { conditionType: 'expression', condition: '{{state.count}} > 3' }
    const context = { __stateValues: { count: 10 } }
    expect(utils.evaluateCondition(utils.resolveConfig(authored, context), context, authored)).toBe(
      false
    )
  })
})
