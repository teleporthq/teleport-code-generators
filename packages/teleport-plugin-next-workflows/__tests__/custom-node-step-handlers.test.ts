import * as nodePath from 'path'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { generateCronAPIRoute, generateWebhookWorkflowAPIRoute } from '../src/api-route-generator'
import { generateAutomationHandlerModule } from '../src/automations/handler-module-generator'

/**
 * A cron, webhook or automation route runs the custom nodes it calls in
 * process (`utils/workflows/custom-nodes.js`) with its own handler map. That
 * map used to hold handlers only for the route's own step types, so a custom
 * node's step of any other type logged "No handler for node type" and was
 * skipped — an automation calling "Send Booking Email" never sent it. The
 * route now carries the handlers of every custom node it calls, recursively.
 */

const scope = globalThis as Record<string, unknown>
// The custom-JS runtime shadows `globalThis`; a function's constructor reaches the real one.
const REAL_GLOBAL = "(function(){}).constructor('return this')()"

const call = (id: string, customNodeId: string, stepNumber = 1) => ({
  id,
  type: 'general-custom-node',
  stepNumber,
  label: 'Call',
  config: { customNodeId, parameters: {} },
})

// An outer custom node with a custom-JS step that calls an inner one with a
// transform-array step: neither type is a step of the route itself.
const CUSTOM_NODES = {
  'cn-outer': {
    id: 'cn-outer',
    name: 'Send the digest',
    parameters: [],
    nodes: [
      {
        id: 'o-js',
        type: 'general-custom-js',
        stepNumber: 1,
        label: 'Note it',
        config: {
          code: `function customHandler(previousContext, params) { ${REAL_GLOBAL}.__tqStepsRan.push('custom-js'); return {}; }`,
        },
      },
      call('o-call', 'cn-inner', 2),
    ],
    edges: [{ id: 'oe1', source: 'o-js', target: 'o-call' }],
  },
  'cn-inner': {
    id: 'cn-inner',
    name: 'Shape the rows',
    parameters: [],
    nodes: [
      {
        id: 'i-map',
        type: 'transform-array',
        stepNumber: 1,
        label: 'Shape',
        config: {
          operation: 'map',
          input: [1],
          mapExpression: `${REAL_GLOBAL}.__tqStepsRan.push('transform-array'); return item;`,
        },
      },
    ],
    edges: [],
  },
}

const handlerTypesOf = (route: string): string[] =>
  Array.from(route.matchAll(/^ {2}'([a-z][a-z0-9-]*)': (?:__wrapEmailHandler|\(function)/gm)).map(
    (match) => match[1]
  )

const workflow = (trigger: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: 'wf-job',
  name: 'Nightly digest',
  trigger: { nodeId: 't', scope: 'global', ...trigger },
  nodes: [call('j-call', 'cn-outer')],
  edges: [{ id: 'e1', source: 't', target: 'j-call' }],
  ...extra,
})

describe('a route carries the handlers of the custom nodes it runs', () => {
  it.each([
    [
      'a cron route',
      () =>
        generateCronAPIRoute(
          workflow({
            type: 'event-cron-triggered',
            config: { schedule: '0 * * * *', urlPath: 'cron_x' },
          }) as never,
          CUSTOM_NODES as never
        ),
    ],
    [
      'a webhook route',
      () =>
        generateWebhookWorkflowAPIRoute(
          workflow(
            { type: 'event-webhook-received', config: {} },
            {
              webhookConfig: { httpMethod: 'POST', urlPath: 'hooks/digest' },
            }
          ) as never,
          CUSTOM_NODES as never
        ),
    ],
    [
      'an automation handler',
      () =>
        generateAutomationHandlerModule(
          workflow({
            type: 'event-business-event',
            config: { eventType: 'order-placed' },
          }) as never,
          CUSTOM_NODES as never
        ),
    ],
  ])('%s, for nested custom nodes too', (_route, generate) => {
    expect(handlerTypesOf(generate())).toEqual(
      expect.arrayContaining(['general-custom-node', 'general-custom-js', 'transform-array'])
    )
  })

  it('leaves a custom node’s browser-only steps without a handler, as before', () => {
    const route = generateCronAPIRoute(
      workflow({
        type: 'event-cron-triggered',
        config: { schedule: '0 * * * *', urlPath: 'cron_x' },
      }) as never,
      {
        'cn-outer': {
          ...CUSTOM_NODES['cn-outer'],
          nodes: [
            { id: 'o-go', type: 'navigation-go-to-page', stepNumber: 1, config: { pageId: '/' } },
          ],
        },
      } as never
    )
    expect(handlerTypesOf(route)).not.toContain('navigation-go-to-page')
  })
})

interface GeneratedEntry {
  path: string[]
  files: Array<{ name: string; fileType?: string; content: unknown }>
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

describe('an automation runs the steps of the custom nodes it calls', () => {
  beforeEach(() => {
    scope.__tqStepsRan = []
  })
  afterAll(() => {
    delete scope.__tqStepsRan
  })

  it('runs a nested custom node’s custom-JS and transform-array steps end to end', async () => {
    const structure = {
      uidl: {
        name: 'Store',
        globals: { settings: { title: 'Store', language: 'en' }, env: {} },
        root: {
          name: 'Root',
          stateDefinitions: {
            route: { type: 'string', defaultValue: 'Home', values: [{ value: 'Home' }] },
          },
          node: {
            type: 'element',
            content: { elementType: 'container', children: [] as unknown[] },
          },
        },
        components: {},
        dataSources: { 'ds-1': { id: 'ds-1', type: 'teleport', name: 'Store', config: {} } },
        automations: { dataSourceId: 'ds-1', dataSourceType: 'teleport' },
        workflows: {
          workflows: {
            'wf-job': workflow({
              type: 'event-business-event',
              config: { eventType: 'order-placed' },
            }),
          },
          customNodes: JSON.parse(JSON.stringify(CUSTOM_NODES)),
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
    const handlerPath = Array.from(files.keys()).find((path) =>
      path.startsWith('lib/automations/handlers/')
    ) as string
    const handler = createApp(files)(handlerPath) as {
      run: (event: unknown, context: unknown) => Promise<unknown>
    }

    const sink = console as unknown as Record<string, unknown>
    const warnings: string[] = []
    const saved = sink.warn
    sink.warn = (message: unknown) => warnings.push(String(message))
    try {
      await handler.run({ event: { type: 'order-placed' }, order: { id: 'ord-1' } }, {})
    } finally {
      sink.warn = saved
    }

    expect(warnings.filter((message) => message.includes('No handler'))).toEqual([])
    expect(scope.__tqStepsRan).toEqual(['custom-js', 'transform-array'])
  })
})
