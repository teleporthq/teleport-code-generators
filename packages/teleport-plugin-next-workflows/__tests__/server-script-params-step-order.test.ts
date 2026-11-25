import * as nodePath from 'path'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'

// A server script outside a custom node reads the workflow's step results by
// position (`params[2]`) or by shape (the last one carrying rows). Its route
// reads them in the order the workflow runs its steps, and only the results of
// the steps that run before its segment: keys that are no step, keys in another
// order and loop bookkeeping change nothing it reads. These generate the whole
// project and run its segment routes.

interface GeneratedEntry {
  path: string[]
  files: Array<{ name: string; fileType?: string; content: unknown }>
}

interface RouteReply {
  status: number
  body: { success?: boolean; results?: Record<string, any>; error?: string }
}

type Context = Record<string, unknown>
type Route = (context: Context) => Promise<RouteReply>

const savedSecret = process.env.NEXTAUTH_SECRET
beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'params-step-order-test-secret'
})
afterAll(() => {
  if (savedSecret === undefined) {
    delete process.env.NEXTAUTH_SECRET
  } else {
    process.env.NEXTAUTH_SECRET = savedSecret
  }
})

// What a probe reports: the tag of each step result it reads by position, and
// the first row of the last result, scanning back, that carries rows.
const probe = (tag: string) =>
  [
    'function customHandler(params) {',
    '  function tagOf(value) { return value && value.tag ? value.tag : null; }',
    '  var row = null;',
    '  for (var i = params.length - 1; i >= 0; i--) {',
    '    if (params[i] && Array.isArray(params[i].rows)) { row = params[i].rows[0]; break; }',
    '  }',
    `  return { tag: ${JSON.stringify(tag)}, seen: params.map(tagOf), row: row };`,
    '}',
  ].join('\n')

const tagged = (tag: string, extra = '') =>
  `function customHandler() { return { tag: ${JSON.stringify(tag)}${extra} }; }`

const STORED_REWARD = { id: 'reward-1', points: 10 }
const OTHER_REWARD = { id: 'reward-2', points: 9999 }

const script = (id: string, stepNumber: number, context: 'client' | 'server', code: string) => ({
  id,
  type: 'general-custom-js',
  label: id,
  stepNumber,
  config: { code, context },
})

const edge = (source: string, target: string, extra: Record<string, string> = {}) => ({
  id: `${source}-${target}`,
  source,
  target,
  ...extra,
})

const trigger = { type: 'event-element-clicked', nodeId: 'trigger', scope: 'element', config: {} }

// trigger → readCode (browser) → loadReward, check (server) → note (browser)
// → redeem (server) → confirm (browser)
const redeemWorkflow = {
  id: 'wf-redeem',
  name: 'Redeem Reward',
  trigger,
  nodes: [
    script('readCode', 1, 'client', tagged('readCode')),
    script(
      'loadReward',
      2,
      'server',
      tagged('loadReward', `, rows: [${JSON.stringify(STORED_REWARD)}]`)
    ),
    script('check', 3, 'server', probe('check')),
    script('note', 4, 'client', tagged('note')),
    script('redeem', 5, 'server', probe('redeem')),
    script('confirm', 6, 'client', tagged('confirm')),
  ],
  edges: [
    edge('trigger', 'readCode'),
    edge('readCode', 'loadReward'),
    edge('loadReward', 'check'),
    edge('check', 'note'),
    edge('note', 'redeem'),
    edge('redeem', 'confirm'),
  ],
}

// trigger → items (browser) → loop over items.list { each (browser) } → total (server)
const browserLoopWorkflow = {
  id: 'wf-browser-loop',
  name: 'Total Items',
  trigger,
  nodes: [
    script('items', 1, 'client', tagged('items', ', list: [1, 2]')),
    {
      id: 'loop',
      type: 'general-loop',
      label: 'loop',
      stepNumber: 2,
      config: {
        loopType: 'forEach',
        collection: { type: 'workflowContext', nodeId: 'items', path: ['items', 'list'] },
      },
    },
    script('each', 3, 'client', tagged('each')),
    script('total', 4, 'server', probe('total')),
  ],
  edges: [
    edge('trigger', 'items'),
    edge('items', 'loop'),
    edge('loop', 'each', { sourceHandle: 'loop', targetHandle: 'loop-body-in' }),
    edge('each', 'loop', { sourceHandle: 'loop-body-out', targetHandle: 'loop-back' }),
    edge('loop', 'total', { sourceHandle: 'done' }),
  ],
}

// trigger → loop over trigger.list { double (server) } → sum (server): one segment.
const serverLoopWorkflow = {
  id: 'wf-server-loop',
  name: 'Double Items',
  trigger,
  nodes: [
    {
      id: 'loop',
      type: 'general-loop',
      label: 'loop',
      stepNumber: 1,
      config: {
        loopType: 'map',
        collection: { type: 'workflowContext', nodeId: 'trigger', path: ['trigger', 'list'] },
      },
    },
    {
      id: 'double',
      type: 'general-custom-js',
      label: 'double',
      stepNumber: 2,
      config: {
        code: 'function customHandler(params) { return { tag: "double", value: params.item * 2 }; }',
        context: 'server',
        params: {
          item: { type: 'workflowContext', nodeId: 'loop', path: ['loop', 'currentItem'] },
        },
      },
    },
    script('sum', 3, 'server', probe('sum')),
  ],
  edges: [
    edge('trigger', 'loop'),
    edge('loop', 'double', { sourceHandle: 'loop', targetHandle: 'loop-body-in' }),
    edge('double', 'loop', { sourceHandle: 'loop-body-out', targetHandle: 'loop-back' }),
    edge('loop', 'sum', { sourceHandle: 'done' }),
  ],
}

const generate = async (workflows: Record<string, unknown>): Promise<Map<string, string>> => {
  const structure = {
    uidl: {
      name: 'Store',
      globals: { settings: { title: 'Store', language: 'en' }, env: {} },
      root: {
        name: 'Root',
        stateDefinitions: {
          route: { type: 'string', defaultValue: 'Home', values: [{ value: 'Home' }] },
        },
        node: { type: 'element', content: { elementType: 'container', children: [] as unknown[] } },
      },
      components: {},
      dataSources: {},
      workflows: { workflows: JSON.parse(JSON.stringify(workflows)), customNodes: {} },
    },
    strategy: { pages: { options: {} } },
    files: new Map<string, GeneratedEntry>(),
    dependencies: {},
    devDependencies: {},
  }
  await new NextWorkflowProjectPlugin().runAfter(structure as never)
  const files = new Map<string, string>()
  for (const entry of structure.files.values()) {
    for (const file of entry.files) {
      files.set(
        [...entry.path, `${file.name}.${file.fileType || 'js'}`].join('/'),
        String(file.content)
      )
    }
  }
  return files
}

/** A CommonJS loader over the generated files. */
const createApp = (files: Map<string, string>) => {
  const cache = new Map<string, { exports: unknown }>()
  const load = (path: string): unknown => {
    const cached = cache.get(path)
    if (cached) {
      return cached.exports
    }
    const source = files.get(path)
    if (source === undefined) {
      throw new Error(`Cannot find module '${path}'`)
    }
    const module = { exports: {} as unknown }
    cache.set(path, module)
    const dir = nodePath.posix.dirname(path)
    const localRequire = (id: string): unknown => {
      if (id.startsWith('.')) {
        const joined = nodePath.posix.normalize(nodePath.posix.join(dir, id))
        return load(joined.endsWith('.js') ? joined : `${joined}.js`)
      }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(id)
    }
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', source)(module, module.exports, localRequire)
    return module.exports
  }
  return load
}

/** The generated route of one server segment of one workflow. */
const routeOf = (
  files: Map<string, string>,
  load: (path: string) => unknown,
  workflowName: string,
  segmentId: string
): Route => {
  const path = Array.from(files.keys()).find((candidate) => {
    const source = files.get(candidate) || ''
    return (
      candidate.startsWith('pages/api/workflows/') &&
      source.includes(` * Workflow: ${workflowName}\n`) &&
      source.includes(` * Segment ID: ${segmentId}\n`)
    )
  })
  if (!path) {
    throw new Error(`no route for ${workflowName} / ${segmentId}`)
  }
  const handler = load(path) as (req: unknown, res: unknown) => Promise<void>
  return async (context) => {
    const reply: RouteReply = { status: 0, body: {} }
    const res = {
      setHeader: (): undefined => undefined,
      status(code: number) {
        reply.status = code
        return this
      },
      json(payload: RouteReply['body']) {
        reply.body = payload
        return this
      },
    }
    await handler(
      {
        method: 'POST',
        body: { context: JSON.parse(JSON.stringify(context)) },
        headers: { host: 'localhost:3000', 'sec-fetch-site': 'same-origin' },
      },
      res
    )
    return reply
  }
}

/** The browser's side of a hop: the reply merges into what it holds. */
const merge = (context: Context, results: Record<string, unknown> = {}): Context => {
  const next = { ...context }
  for (const key of Object.keys(results)) {
    next[key] = results[key]
  }
  return next
}

const reversed = (context: Context): Context => {
  const next: Context = {}
  for (const key of Object.keys(context).reverse()) {
    next[key] = context[key]
  }
  return next
}

/** `context` with `extra` placed right after the key `after`. */
const insertedAfter = (context: Context, after: string, extra: Context): Context => {
  const next: Context = {}
  for (const key of Object.keys(context)) {
    next[key] = context[key]
    if (key === after) {
      Object.assign(next, extra)
    }
  }
  return next
}

const withRows = (tag: string) => ({ tag, rows: [OTHER_REWARD] })

const NOT_STEPS = {
  p2: withRows('p2'),
  p3: withRows('p3'),
  p4: withRows('p4'),
  p5: withRows('p5'),
}

describe('a server script reads the step results of the steps before it, in step order', () => {
  let firstSegment: Route
  let secondSegment: Route

  beforeAll(async () => {
    const files = await generate({ 'wf-redeem': redeemWorkflow })
    const load = createApp(files)
    firstSegment = routeOf(files, load, 'Redeem Reward', 'server-1')
    secondSegment = routeOf(files, load, 'Redeem Reward', 'server-2')
  })

  const START: Context = { trigger: { tag: 'trigger' }, readCode: { tag: 'readCode' } }

  const honestRun = async () => {
    const first = await firstSegment(START)
    const beforeRedeem = merge(merge(START, first.body.results), { note: { tag: 'note' } })
    return { first, beforeRedeem }
  }

  it('reads every earlier step result, the browser steps included, in step order', async () => {
    const { first, beforeRedeem } = await honestRun()
    expect(first.status).toBe(200)
    expect(first.body.results?.check).toEqual({
      tag: 'check',
      seen: ['trigger', 'readCode', 'loadReward'],
      row: STORED_REWARD,
    })
    const redeem = await secondSegment(beforeRedeem)
    expect(redeem.status).toBe(200)
    expect(redeem.body.results?.redeem).toEqual({
      tag: 'redeem',
      seen: ['trigger', 'readCode', 'loadReward', 'check', 'note'],
      row: STORED_REWARD,
    })
  })

  it('reads the same step order whatever order the request sends its keys in', async () => {
    const check = await firstSegment(reversed(START))
    expect(check.body.results?.check).toEqual({
      tag: 'check',
      seen: ['trigger', 'readCode', 'loadReward'],
      row: STORED_REWARD,
    })
    const { beforeRedeem } = await honestRun()
    const redeem = await secondSegment(reversed(beforeRedeem))
    expect(redeem.body.results?.redeem).toEqual({
      tag: 'redeem',
      seen: ['trigger', 'readCode', 'loadReward', 'check', 'note'],
      row: STORED_REWARD,
    })
  })

  it('reads no key that is not a step before it', async () => {
    const check = await firstSegment(insertedAfter(START, 'trigger', NOT_STEPS))
    expect(check.body.results?.check).toEqual({
      tag: 'check',
      seen: ['trigger', 'readCode', 'loadReward'],
      row: STORED_REWARD,
    })

    const { beforeRedeem } = await honestRun()
    const redeem = await secondSegment({
      ...insertedAfter(beforeRedeem, 'readCode', NOT_STEPS),
      confirm: withRows('confirm'),
      redeem: withRows('redeem'),
    })
    expect(redeem.body.results?.redeem).toEqual({
      tag: 'redeem',
      seen: ['trigger', 'readCode', 'loadReward', 'check', 'note'],
      row: STORED_REWARD,
    })
  })

  it('reads the same steps when the keys are both reordered and added to', async () => {
    const { beforeRedeem } = await honestRun()
    const redeem = await secondSegment(reversed({ ...beforeRedeem, ...NOT_STEPS }))
    expect(redeem.body.results?.redeem).toEqual({
      tag: 'redeem',
      seen: ['trigger', 'readCode', 'loadReward', 'check', 'note'],
      row: STORED_REWARD,
    })
  })

  it('replies no key that is not a step', async () => {
    const { beforeRedeem } = await honestRun()
    const redeem = await secondSegment({ ...beforeRedeem, ...NOT_STEPS })
    expect(Object.keys(redeem.body.results || {}).filter((key) => !key.startsWith('__'))).toEqual([
      'redeem',
    ])
  })
})

describe('a server script after a loop the browser ran', () => {
  let total: Route

  beforeAll(async () => {
    const files = await generate({ 'wf-browser-loop': browserLoopWorkflow })
    total = routeOf(files, createApp(files), 'Total Items', 'server-1')
  })

  // What the browser holds once its loop has run: the loop's own result is
  // scaffolding, its body's last result a step result.
  const AFTER_LOOP: Context = {
    trigger: { tag: 'trigger' },
    items: { tag: 'items', list: [1, 2] },
    __loopScopeStack: [],
    __loopNodeIds: { loop: true },
    __loopItem: 2,
    __loopIndex: 1,
    loop: { completed: true, iterations: 2 },
    loop_iter: { item: 2, index: 1 },
    each: { tag: 'each' },
  }

  const HONEST = { tag: 'total', seen: ['trigger', 'items', 'each'], row: null as unknown }

  it('reads the loop body result and never the loop itself', async () => {
    const reply = await total(AFTER_LOOP)
    expect(reply.status).toBe(200)
    expect(reply.body.results?.total).toEqual(HONEST)
  })

  it('reads the same results when the request names the loop as still running', async () => {
    const reply = await total({
      ...AFTER_LOOP,
      __loopScopeStack: [{ loopNodeId: 'loop', bodyNodeIds: { each: true } }],
    })
    expect(reply.body.results?.total).toEqual(HONEST)
  })

  it('reads the same results when the request leaves the loop out of its loops', async () => {
    const reply = await total({ ...AFTER_LOOP, __loopNodeIds: {} })
    expect(reply.body.results?.total).toEqual(HONEST)
  })
})

describe('a loop inside a server segment', () => {
  let segment: Route

  beforeAll(async () => {
    const files = await generate({ 'wf-server-loop': serverLoopWorkflow })
    segment = routeOf(files, createApp(files), 'Double Items', 'server-1')
  })

  const EXPECTED_PASSES = [
    { tag: 'double', value: 2 },
    { tag: 'double', value: 4 },
    { tag: 'double', value: 6 },
  ]

  it('runs its body once per item and the step after it reads the body result', async () => {
    const reply = await segment({ trigger: { tag: 'trigger', list: [1, 2, 3] } })
    expect(reply.status).toBe(200)
    expect(reply.body.results?.loop).toMatchObject({ iterations: 3, results: EXPECTED_PASSES })
    expect(reply.body.results?.sum).toEqual({ tag: 'sum', seen: ['trigger', 'double'], row: null })
  })

  it('runs the same whatever loop bookkeeping the request carries', async () => {
    const reply = await segment({
      trigger: { tag: 'trigger', list: [1, 2, 3] },
      __loopScopeStack: [{ loopNodeId: 'loop', bodyNodeIds: { double: true } }],
      __loopNodeIds: {},
      double: withRows('double'),
      loop: { completed: true, iterations: 0, results: [] },
    })
    expect(reply.body.results?.loop).toMatchObject({ iterations: 3, results: EXPECTED_PASSES })
    expect(reply.body.results?.sum).toEqual({ tag: 'sum', seen: ['trigger', 'double'], row: null })
  })
})
