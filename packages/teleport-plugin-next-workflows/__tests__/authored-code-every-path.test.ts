import * as crypto from 'crypto'
import * as nodePath from 'path'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { withEnv } from './_helpers/fake-fetch'

/**
 * Code is compiled only as the author wrote it on EVERY path that runs a node,
 * not only in a route's own steps: a custom node's steps run in process inside
 * a cron, webhook or automation route (`utils/workflows/custom-nodes.js`), and
 * their configs are resolved there too. A custom-JS step whose code, or a
 * transform-array step whose expression, is bound to an earlier step's result
 * would otherwise compile that result — with the deployment's real `process`.
 * `resolveNodeConfig` (the shared runtime) drops such a field on every path.
 */

const KEY = 'cron-key-1'
const ROUTE_PATH = '/api/workflows/cron_nightly'
const scope = globalThis as Record<string, unknown>

// What an earlier step hands on: code that reaches the real global scope (the
// custom-JS runtime shadows `globalThis` and `process`; a function's
// constructor escapes both), flags that it ran and reads a platform secret.
const REAL_GLOBAL = "(function(){}).constructor('return this')()"
const PAYLOAD_SCRIPT = `function customHandler() { ${REAL_GLOBAL}.__tqEveryPathPwned = 'custom-js'; return { leak: ${REAL_GLOBAL}.process.env.TELEPORT_DB_CONNECTION_STRING }; }`
const PAYLOAD_EXPRESSION = `${REAL_GLOBAL}.__tqEveryPathPwned = 'transform-array'; return item;`

const ref = (nodeId: string, field: string) => ({
  type: 'workflowContext',
  nodeId,
  path: [nodeId, field],
})

const customNodeWith = (boundStep: Record<string, unknown>) => ({
  'cn-1': {
    id: 'cn-1',
    name: 'Digest',
    parameters: [],
    nodes: [
      {
        id: 'c-src',
        type: 'general-custom-js',
        stepNumber: 1,
        label: 'Hand on',
        config: {
          code: `function customHandler(previousContext, params) { return { script: ${JSON.stringify(
            PAYLOAD_SCRIPT
          )}, expression: ${JSON.stringify(PAYLOAD_EXPRESSION)} }; }`,
        },
      },
      { id: 'c-run', stepNumber: 2, label: 'Run it', ...boundStep },
    ],
    edges: [{ id: 'ce1', source: 'c-src', target: 'c-run' }],
  },
})

const BOUND_CUSTOM_JS = { type: 'general-custom-js', config: { code: ref('c-src', 'script') } }
const BOUND_TRANSFORM = {
  type: 'transform-array',
  config: { operation: 'map', input: [1, 2], mapExpression: ref('c-src', 'expression') },
}

interface GeneratedEntry {
  path: string[]
  files: Array<{ name: string; fileType?: string; content: unknown }>
}

const generate = async (customNodes: Record<string, unknown>): Promise<Map<string, string>> => {
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
      dataSources: { 'ds-1': { id: 'ds-1', type: 'teleport', name: 'Store', config: {} } },
      workflows: {
        workflows: {
          'wf-nightly': {
            id: 'wf-nightly',
            name: 'Nightly digest',
            trigger: {
              type: 'event-cron-triggered',
              nodeId: 't',
              scope: 'global',
              config: { schedule: '0 * * * *', urlPath: 'cron_nightly' },
            },
            nodes: [
              {
                id: 'n-call',
                type: 'general-custom-node',
                stepNumber: 1,
                label: 'Digest',
                config: { customNodeId: 'cn-1', parameters: {} },
              },
            ],
            edges: [{ id: 'e1', source: 't', target: 'n-call' }],
          },
        },
        customNodes: JSON.parse(JSON.stringify(customNodes)),
      },
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

const signed = (): Record<string, string> => {
  const timestamp = String(Math.floor(Date.now() / 1000))
  return {
    'x-teleport-cron-id': 'cron-1',
    'x-teleport-project-id': 'project-1',
    'x-teleport-cron-execution-id': 'exec-1',
    'x-teleport-cron-timestamp': timestamp,
    'x-teleport-cron-signature':
      'v1=' +
      crypto
        .createHmac('sha256', KEY)
        .update(`v1:${timestamp}:project-1:cron-1:exec-1:${ROUTE_PATH}`)
        .digest('hex'),
  }
}

/** The generated cron route, called as the scheduler calls it. */
const runCron = async (files: Map<string, string>) => {
  const route = createApp(files)(`pages${ROUTE_PATH}.js`) as (
    req: unknown,
    res: unknown
  ) => Promise<void>
  const reply = { status: 0, body: null as any }
  const res = {
    setHeader: () => undefined,
    status(code: number) {
      reply.status = code
      return {
        json(payload: unknown) {
          reply.body = payload
        },
      }
    },
  }
  const sink = console as unknown as Record<string, unknown>
  const saved = ['warn', 'error', 'log'].map((level) => sink[level])
  ;['warn', 'error', 'log'].forEach((level) => (sink[level] = () => undefined))
  try {
    await withEnv(
      {
        TELEPORT_CRON_SECRET: KEY,
        TELEPORT_DB_CONNECTION_STRING: 'postgres://REAL-SECRET',
        VERCEL_AUTOMATION_BYPASS_SECRET: undefined,
      },
      () =>
        route(
          {
            method: 'POST',
            url: ROUTE_PATH,
            headers: { host: 'shop.test', 'x-forwarded-proto': 'https', ...signed() },
            body: {},
          },
          res
        )
    )
  } finally {
    ;['warn', 'error', 'log'].forEach((level, index) => (sink[level] = saved[index]))
  }
  return reply
}

beforeEach(() => {
  delete scope.__tqEveryPathPwned
})
afterAll(() => {
  delete scope.__tqEveryPathPwned
})

describe('a custom node run in process by a cron route compiles only authored code', () => {
  it('runs the custom node, as the route does', async () => {
    const files = await generate(
      customNodeWith({
        type: 'general-custom-js',
        config: {
          code: `function customHandler() { ${REAL_GLOBAL}.__tqEveryPathPwned = 'authored'; return {}; }`,
        },
      })
    )
    const reply = await runCron(files)
    expect(reply.status).toBe(200)
    expect(scope.__tqEveryPathPwned).toBe('authored')
  })

  it.each([
    ['a custom-JS step whose code is an earlier result', BOUND_CUSTOM_JS],
    ['a transform-array step whose expression is an earlier result', BOUND_TRANSFORM],
  ])('never compiles %s', async (_kind, boundStep) => {
    const reply = await runCron(await generate(customNodeWith(boundStep)))
    expect(reply.status).toBe(200)
    expect(scope.__tqEveryPathPwned).toBeUndefined()
    expect(JSON.stringify(reply.body)).not.toContain('REAL-SECRET')
  })
})
