/* tslint:disable:function-constructor no-any */
import * as http from 'http'
import { AddressInfo } from 'net'
import * as nodePath from 'path'
import * as vm from 'vm'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { generateHandlerFunction } from '../src/api-route-generator'
import { withEnv } from './_helpers/fake-fetch'

/**
 * A scheduled workflow on a published site failed every run with HTTP 500
 * "Failed to parse URL from /api/data/<id>/raw-query": its data step called the
 * site's own data API by a relative address, which a browser resolves against
 * the page and Node's fetch refuses. A server job has no page, so each route
 * that runs one hands its steps the absolute origin (`context.__baseUrl`).
 *
 * Every kind of server job is run here as the deployment runs it — the
 * generated files, Node's own fetch, and a real HTTP server standing in for the
 * site — so a relative self-call fails exactly as it did in production.
 */

const DS = 'ds-store'
const ref = (nodeId: string, path: string[]) => ({ type: 'workflowContext', nodeId, path })

const CART_ROWS = [{ cart_id: 'cart-1', email: 'a@shop.test' }]

/** The predefined "Abandoned Cart Reminder", reduced to its database steps. */
const CART_REMINDER = {
  id: 'wf-cart-reminder',
  name: 'Abandoned Cart Reminder',
  trigger: {
    type: 'event-cron-triggered',
    nodeId: 't',
    scope: 'global',
    config: { schedule: '0 * * * *', urlPath: 'cron_cartreminder' },
  },
  nodes: [
    {
      id: 'scan',
      type: 'data-raw-query',
      label: 'Scan Abandoned Carts',
      config: {
        dataSourceId: DS,
        query:
          'SELECT c.id AS cart_id FROM teleport_cart c WHERE c.updated_at < NOW() - make_interval(hours => $1::int)',
        params: ['2'],
      },
      stepNumber: 1,
    },
    {
      id: 'loop',
      type: 'general-loop',
      label: 'Loop Over Each Abandoned Cart',
      config: { loopType: 'forEach', collection: ref('scan', ['result']), itemVariable: 'cart' },
      stepNumber: 2,
    },
    {
      id: 'record',
      type: 'data-create-item',
      label: 'Record Abandoned Cart',
      config: {
        dataSourceId: DS,
        tableName: 'teleport_abandoned_carts',
        columnMappings: [{ column: 'cart_id', value: ref('loop', ['currentItem', 'cart_id']) }],
      },
      stepNumber: 3,
    },
  ],
  edges: [
    { id: 'e1', source: 't', target: 'scan' },
    { id: 'e2', source: 'scan', target: 'loop' },
    {
      id: 'e3',
      source: 'loop',
      target: 'record',
      sourceHandle: 'loop',
      targetHandle: 'loop-body-in',
    },
    {
      id: 'e4',
      source: 'record',
      target: 'loop',
      sourceHandle: 'loop-body-out',
      targetHandle: 'loop-back',
    },
  ],
}

/** A shared step the store's jobs call: its database read runs in its own server segment route. */
const RELEASE_NODE = {
  id: 'cn-release',
  name: 'Release Expired Holds',
  parameters: [] as unknown[],
  nodes: [
    {
      id: 'release-query',
      type: 'data-raw-query',
      label: 'Release Expired Holds',
      config: { dataSourceId: DS, query: "UPDATE teleport_orders SET status = 'expired'" },
      stepNumber: 0,
    },
  ],
  edges: [] as unknown[],
}

const callRelease = (id: string, stepNumber: number) => ({
  id,
  type: 'general-custom-node',
  label: 'Release Expired Holds',
  config: { customNodeId: 'cn-release', parameters: [] as unknown[] },
  stepNumber,
})

const RELEASE_CRON = {
  id: 'wf-release',
  name: 'Release Abandoned Checkouts',
  trigger: {
    type: 'event-cron-triggered',
    nodeId: 't',
    scope: 'global',
    config: { schedule: '*/15 * * * *', urlPath: 'cron_release' },
  },
  nodes: [callRelease('release-call', 1)],
  edges: [{ id: 'r1', source: 't', target: 'release-call' }],
}

const SYNC_WEBHOOK = {
  id: 'wf-sync',
  name: 'Inventory Sync',
  trigger: { type: 'event-webhook-received', nodeId: 't', scope: 'global', config: {} },
  webhookConfig: { urlPath: 'webhooks/inventory-sync', httpMethod: 'POST' },
  nodes: [
    {
      id: 'sync-query',
      type: 'data-raw-query',
      label: 'Read Stock',
      config: { dataSourceId: DS, query: 'SELECT id, stock FROM teleport_products' },
      stepNumber: 1,
    },
  ],
  edges: [{ id: 's1', source: 't', target: 'sync-query' }],
}

const ORDER_AUTOMATION = {
  id: 'wf-order-placed',
  name: 'When an order is placed',
  trigger: { type: 'event-business-event', nodeId: 't', scope: 'global', config: {} },
  nodes: [
    {
      id: 'auto-query',
      type: 'data-raw-query',
      label: 'Read The Order',
      config: { dataSourceId: DS, query: 'SELECT id FROM teleport_orders LIMIT 1' },
      stepNumber: 1,
    },
  ],
  edges: [{ id: 'a1', source: 't', target: 'auto-query' }],
}

const ENV: Record<string, string | undefined> = {
  NEXTAUTH_SECRET: 'app-secret',
  NEXTAUTH_URL: undefined,
  TELEPORT_CRON_ALLOW_UNSIGNED: 'true',
  TELEPORT_CRON_SECRET: undefined,
  VERCEL: undefined,
  VERCEL_AUTOMATION_BYPASS_SECRET: undefined,
}

const generateFiles = async (): Promise<Map<string, string>> => {
  const structure: any = {
    uidl: {
      name: 'Store',
      globals: { settings: { title: 'Store', language: 'en' }, env: { NEXTAUTH_SECRET: 'k' } },
      root: {
        name: 'Root',
        stateDefinitions: {
          route: { type: 'string', defaultValue: 'Home', values: [{ value: 'Home' }] },
        },
        node: { type: 'element', content: { elementType: 'container', children: [] } },
      },
      components: {},
      dataSources: { [DS]: { id: DS, type: 'teleport', name: 'Store', config: {} } },
      workflows: {
        workflows: JSON.parse(
          JSON.stringify({
            [CART_REMINDER.id]: CART_REMINDER,
            [RELEASE_CRON.id]: RELEASE_CRON,
            [SYNC_WEBHOOK.id]: SYNC_WEBHOOK,
          })
        ),
        customNodes: JSON.parse(JSON.stringify({ [RELEASE_NODE.id]: RELEASE_NODE })),
      },
    },
    strategy: { pages: { options: {} } },
    files: new Map(),
    dependencies: {},
    devDependencies: {},
  }
  await new NextWorkflowProjectPlugin().runAfter(structure)
  const files = new Map<string, string>()
  for (const entry of structure.files.values()) {
    for (const file of entry.files) {
      files.set(
        [...entry.path, `${file.name}.${file.fileType || 'js'}`].join('/'),
        String(file.content)
      )
    }
  }
  files.set(
    'lib/automations/handlers/wf-order-placed.js',
    generateHandlerFunction(JSON.parse(JSON.stringify(ORDER_AUTOMATION)), {
      [RELEASE_NODE.id]: RELEASE_NODE,
    } as any)
  )
  return files
}

interface Reply {
  status: number
  body: any
}

interface Site {
  origin: string
  /** Every request the site received: its path and the Host it was sent to. */
  received: Array<{ path: string; host: string }>
  call: (routeFile: string, body?: unknown) => Promise<Reply>
  load: (path: string) => any
}

/**
 * The generated files served by a real HTTP server: the data API answers with
 * rows, and a call to one of the site's own workflow routes runs that route.
 */
const startSite = async (files: Map<string, string>): Promise<Site & { close: () => void }> => {
  let origin = ''
  const received: Site['received'] = []
  const cache = new Map<string, { exports: any }>()
  const overrides: Record<string, unknown> = {
    'lib/automations/store.js': {
      appBaseUrl: () => origin,
      saveWait: async (): Promise<void> => undefined,
    },
  }

  const load = (path: string): any => {
    if (Object.prototype.hasOwnProperty.call(overrides, path)) {
      return overrides[path]
    }
    const cached = cache.get(path)
    if (cached) {
      return cached.exports
    }
    const source = files.get(path)
    if (source === undefined) {
      throw new Error(`Cannot find module '${path}'`)
    }
    const module = { exports: {} as any }
    cache.set(path, module)
    const dir = nodePath.posix.dirname(path)
    const localRequire = (id: string): unknown => {
      if (id.startsWith('.')) {
        const joined = nodePath.posix.normalize(nodePath.posix.join(dir, id))
        const found = [joined, `${joined}.js`, `${joined}/index.js`].find(
          (candidate) =>
            files.has(candidate) || Object.prototype.hasOwnProperty.call(overrides, candidate)
        )
        return load(found || `${joined}.js`)
      }
      if (id === 'next-auth/jwt') {
        return { getToken: async (): Promise<null> => null }
      }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(id)
    }
    new Function('module', 'exports', 'require', source)(module, module.exports, localRequire)
    return module.exports
  }

  const run = async (
    routeFile: string,
    headers: Record<string, string | string[] | undefined>,
    body: unknown
  ): Promise<Reply> => {
    const reply: Reply = { status: 200, body: null }
    const res: any = {
      setHeader: (): any => res,
      status(code: number) {
        reply.status = code
        return res
      },
      json(payload: unknown) {
        reply.body = payload
        return res
      },
      end() {
        return res
      },
    }
    const handler = load(routeFile)
    await (handler.default || handler)(
      {
        method: 'POST',
        url: '/' + routeFile.replace(/^pages\//, '').replace(/\.js$/, ''),
        query: {},
        headers,
        body,
      },
      res
    )
    return reply
  }

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', async () => {
      const path = new URL(req.url || '/', 'http://site').pathname
      received.push({ path, host: String(req.headers.host) })
      const text = Buffer.concat(chunks).toString('utf8')
      const body = text ? JSON.parse(text) : undefined
      let reply: Reply = { status: 404, body: { error: 'not found' } }
      if (/^\/api\/data\/[^/]+\/[^/]+$/.test(path)) {
        reply = { status: 200, body: { success: true, rows: CART_ROWS, data: CART_ROWS[0] } }
      } else if (files.has(`pages${path}.js`)) {
        reply = await run(`pages${path}.js`, req.headers, body)
      }
      res.statusCode = reply.status
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(reply.body))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  origin = `http://127.0.0.1:${port}`

  return {
    origin,
    received,
    load,
    call: (routeFile, body = {}) =>
      run(routeFile, { host: `127.0.0.1:${port}`, 'content-type': 'application/json' }, body),
    close: () => server.close(),
  }
}

// Node's own fetch (undici), as the deployment has it: the one that refuses a
// relative address. Jest's sandbox has no global fetch of its own.
const nodeFetch = vm.runInThisContext('fetch')

const silenced = async <T>(run: () => Promise<T>): Promise<T> => {
  const sink = console as unknown as Record<string, unknown>
  const levels = ['warn', 'error', 'log', 'info']
  const saved = levels.map((level) => sink[level])
  levels.forEach((level) => {
    sink[level] = (): undefined => undefined
  })
  try {
    return await run()
  } finally {
    levels.forEach((level, index) => {
      sink[level] = saved[index]
    })
  }
}

const onSite = async <T>(run: (site: Site) => Promise<T>): Promise<T> => {
  const site = await startSite(await generateFiles())
  const scope = globalThis as any
  const previous = scope.fetch
  scope.fetch = nodeFetch
  try {
    return await withEnv(ENV, () => silenced(() => run(site)))
  } finally {
    scope.fetch = previous
    site.close()
  }
}

/** The paths the site received, each asserted to have come to its own address. */
const selfCalls = (site: Site): string[] => {
  const host = new URL(site.origin).host
  site.received.forEach((call) => expect(call.host).toBe(host))
  return site.received.map((call) => call.path)
}

const webhookDelivery = (payload: unknown) => Buffer.from(JSON.stringify(payload))

describe("a server job calls the site's own routes by their absolute address", () => {
  it('a scheduled workflow reads with a raw query, then records each row', async () => {
    await onSite(async (site) => {
      const reply = await site.call('pages/api/workflows/cron_cartreminder.js')

      expect(reply).toEqual({ status: 200, body: expect.objectContaining({ success: true }) })
      expect(selfCalls(site)).toEqual([`/api/data/${DS}/raw-query`, `/api/data/${DS}/create`])
    })
  })

  it("a scheduled workflow runs a shared step whose query is in that step's own route", async () => {
    await onSite(async (site) => {
      const reply = await site.call('pages/api/workflows/cron_release.js')

      expect(reply).toEqual({ status: 200, body: expect.objectContaining({ success: true }) })
      const [segmentRoute, ...rest] = selfCalls(site)
      expect(segmentRoute).toMatch(/^\/api\/workflows\/release-expired-holds-/)
      expect(rest).toEqual([`/api/data/${DS}/raw-query`])
    })
  })

  it('a webhook reads with a raw query', async () => {
    await onSite(async (site) => {
      const reply = await site.call(
        'pages/api/webhooks/inventory-sync.js',
        webhookDelivery({ event: 'stock' })
      )

      expect(reply).toEqual({ status: 200, body: { received: true } })
      expect(selfCalls(site)).toEqual([`/api/data/${DS}/raw-query`])
    })
  })

  it('an automation reads with a raw query', async () => {
    await onSite(async (site) => {
      const handler = site.load('lib/automations/handlers/wf-order-placed.js')
      await handler.run({ event: { id: 'e1', type: 'order-placed' }, order: { id: 'o1' } }, {})

      expect(selfCalls(site)).toEqual([`/api/data/${DS}/raw-query`])
    })
  })
})
