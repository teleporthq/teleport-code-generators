import * as crypto from 'crypto'
import { generateCronAPIRoute } from '../src/api-route-generator'
import { loadServerRuntime } from './_helpers/load-server-runtime'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { FetchCall, withEnv, withFetch } from './_helpers/fake-fetch'

/**
 * The generated cron route EXECUTED: it runs its workflow only for a request
 * crons-worker signed with the project's key (or Vercel Cron's bearer, or a
 * local run that opted out), and answers 401 without running anything else.
 */

interface Reply {
  status: number
  body: any
}

const ROUTE_PATH = '/api/workflows/cron_nightly'
const KEY = 'k'.repeat(64)

// One data node: it calls the deployment's own /api/data route, so a test can
// see whether the workflow ran, on which origin, and with which credentials.
const workflow: any = {
  id: 'wf-cron',
  name: 'Nightly count',
  trigger: {
    type: 'event-cron-triggered',
    nodeId: 't',
    scope: 'global',
    config: { schedule: '0 * * * *', urlPath: 'cron_nightly' },
  },
  nodes: [
    {
      id: 'count',
      type: 'data-count',
      config: { dataSourceId: 'ds-1', tableName: 'orders', filters: [] },
      stepNumber: 1,
      label: 'Count orders',
    },
  ],
  edges: [{ id: 'e1', source: 't', target: 'count' }],
}

const loadRoute = (source: string) => {
  const runtime = { exports: loadServerRuntime() }
  const requireShim = (id: string) => {
    if (id.endsWith('/utils/workflows/server-runtime')) {
      return runtime.exports
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id)
  }
  const module = { exports: null as any }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', source)(module, {}, requireShim)
  return module.exports as (req: unknown, res: unknown) => Promise<void>
}

const handler = loadRoute(generateCronAPIRoute(workflow))

const sign = (
  key: string,
  { timestamp = String(Math.floor(Date.now() / 1000)), path = ROUTE_PATH } = {}
): Record<string, string> => ({
  'x-teleport-cron-id': 'cron-1',
  'x-teleport-project-id': 'project-1',
  'x-teleport-cron-execution-id': 'exec-1',
  'x-teleport-cron-timestamp': timestamp,
  'x-teleport-cron-signature':
    'v1=' +
    crypto
      .createHmac('sha256', key)
      .update(`v1:${timestamp}:project-1:cron-1:exec-1:${path}`)
      .digest('hex'),
})

const NO_KEYS: Record<string, string | undefined> = {
  TELEPORT_CRON_SECRET: undefined,
  TELEPORT_CRON_SECRET_PREVIOUS: undefined,
  CRON_SECRET: undefined,
  TELEPORT_CRON_ALLOW_UNSIGNED: undefined,
  VERCEL_AUTOMATION_BYPASS_SECRET: undefined,
}

const run = async (
  headers: Record<string, string>,
  env: Record<string, string | undefined> = { TELEPORT_CRON_SECRET: KEY },
  url = ROUTE_PATH
): Promise<{ reply: Reply; calls: FetchCall[] }> => {
  const reply: Reply = { status: 0, body: null }
  const res = {
    status(code: number) {
      reply.status = code
      return {
        json(payload: unknown) {
          reply.body = payload
        },
      }
    },
  }
  const req = {
    method: 'POST',
    url,
    headers: { host: 'shop.test', 'x-forwarded-proto': 'https', ...headers },
    body: {},
  }
  const calls = await withEnv({ ...NO_KEYS, ...env }, () =>
    withFetch(
      () => ({ status: 200, body: { count: 3 } }),
      async (recorded) => {
        await handler(req, res)
        return recorded
      }
    )
  )
  return { reply, calls }
}

const expectRefused = ({ reply, calls }: { reply: Reply; calls: FetchCall[] }) => {
  expect(reply).toEqual({ status: 401, body: { error: 'Unauthorized' } })
  expect(calls).toEqual([])
}

describe('generated cron route — request verification', () => {
  it('runs a request signed with the deployed key, on the origin it was requested on', async () => {
    const { reply, calls } = await run(sign(KEY), {
      TELEPORT_CRON_SECRET: KEY,
      VERCEL_AUTOMATION_BYPASS_SECRET: 'bypass-1',
    })

    expect(reply.status).toBe(200)
    expect(reply.body.success).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://shop.test/api/data/ds-1/count')
    // A deployment behind Vercel protection can call its own data routes.
    expect(calls[0].headers['x-vercel-protection-bypass']).toBe('bypass-1')
  })

  it('signs the path without its query string', async () => {
    const { reply } = await run(sign(KEY), undefined, `${ROUTE_PATH}?source=cron`)
    expect(reply.status).toBe(200)
  })

  it('refuses a signature made with another key', async () => {
    expectRefused(await run(sign('another-key')))
  })

  it('refuses a timestamp outside the five-minute window, either side', async () => {
    const now = Math.floor(Date.now() / 1000)
    expectRefused(await run(sign(KEY, { timestamp: String(now - 301) })))
    expectRefused(await run(sign(KEY, { timestamp: String(now + 301) })))
    expectRefused(await run(sign(KEY, { timestamp: 'soon' })))
  })

  it('refuses a signature made for another route', async () => {
    expectRefused(await run(sign(KEY, { path: '/api/workflows/cron_other' })))
  })

  it('refuses a request missing any signed header', async () => {
    for (const header of Object.keys(sign(KEY))) {
      const headers = sign(KEY)
      delete headers[header]
      expectRefused(await run(headers))
    }
  })

  it('refuses a signed id that was changed after signing', async () => {
    expectRefused(await run({ ...sign(KEY), 'x-teleport-cron-id': 'cron-2' }))
  })

  it('accepts the previous key while a rotation is under way', async () => {
    const { reply } = await run(sign('old-key'), {
      TELEPORT_CRON_SECRET: KEY,
      TELEPORT_CRON_SECRET_PREVIOUS: 'old-key',
    })
    expect(reply.status).toBe(200)
  })

  it('never verifies against an unset key, even a signature made with the empty one', async () => {
    expectRefused(await run(sign(''), { TELEPORT_CRON_SECRET: '' }))
  })

  it("accepts Vercel Cron's bearer only when CRON_SECRET is set and matches", async () => {
    const accepted = await run(
      { authorization: 'Bearer vercel-key' },
      { CRON_SECRET: 'vercel-key' }
    )
    expect(accepted.reply.status).toBe(200)
    expect(accepted.calls).toHaveLength(1)

    expectRefused(await run({ authorization: 'Bearer wrong' }, { CRON_SECRET: 'vercel-key' }))
    expectRefused(await run({ authorization: 'Bearer ' }, {}))
    expectRefused(await run({ authorization: 'Bearer undefined' }, {}))
  })

  it('runs an unsigned request only when the local-run flag is exactly "true"', async () => {
    expectRefused(await run({}))
    expectRefused(await run({}, { TELEPORT_CRON_ALLOW_UNSIGNED: '1' }))

    const { reply, calls } = await run({}, { TELEPORT_CRON_ALLOW_UNSIGNED: 'true' })
    expect(reply.status).toBe(200)
    expect(calls).toHaveLength(1)
  })
})

describe('cron routes and the generated .env', () => {
  const generate = async (workflows: Record<string, any>) => {
    const structure: any = {
      uidl: {
        name: 'Store',
        globals: { settings: { title: 'Store', language: 'en' }, env: {} },
        root: {
          name: 'Root',
          stateDefinitions: {
            route: { type: 'string', defaultValue: 'Home', values: [{ value: 'Home' }] },
          },
          node: { type: 'element', content: { elementType: 'container', children: [] } },
        },
        components: {},
        workflows: { workflows },
      },
      strategy: { pages: { options: {} } },
      files: new Map(),
      dependencies: {},
      devDependencies: {},
    }
    await new NextWorkflowProjectPlugin().runAfter(structure)
    return structure
  }

  it('declares TELEPORT_CRON_SECRET, empty, for the deploy to fill', async () => {
    const structure = await generate({ [workflow.id]: workflow })

    expect(structure.uidl.globals.env.TELEPORT_CRON_SECRET).toBe('')
    expect(structure.files.has(`workflow-cron-${workflow.id}`)).toBe(true)
  })

  it('emits the server runtime and handlers a cron route requires, even with no other server work', async () => {
    const structure = await generate({ [workflow.id]: workflow })
    const cronRoute = structure.files.get(`workflow-cron-${workflow.id}`)!.files[0]
      .content as string

    expect(cronRoute).toContain("require('../../../utils/workflows/server-runtime')")
    expect(structure.files.has('workflow-server-runtime')).toBe(true)
  })

  it('declares nothing for an app without a cron route', async () => {
    const structure = await generate({})

    expect('TELEPORT_CRON_SECRET' in structure.uidl.globals.env).toBe(false)
  })
})
