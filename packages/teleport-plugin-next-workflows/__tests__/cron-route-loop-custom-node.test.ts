import { generateCronAPIRoute } from '../src/api-route-generator'
import { loadServerRuntime } from './_helpers/load-server-runtime'
import { withEnv } from './_helpers/fake-fetch'

/**
 * A custom node inside a loop body of a scheduled workflow runs once per item.
 * Its handler only hands back a marker; the route must then call the custom
 * node itself, as it does for a top-level one. Before, the marker was stored
 * and nothing ran: the store-billing run never sent one of its emails.
 */

const LOOP_ID = 'loop-1'
const CUSTOM_ID = 'send-1'

const workflow: any = {
  id: 'wf-billing',
  name: 'Store Billing',
  trigger: {
    type: 'event-cron-triggered',
    nodeId: 't',
    scope: 'global',
    config: { schedule: '5 * * * *', urlPath: 'cron_billing' },
  },
  nodes: [
    {
      id: LOOP_ID,
      type: 'general-loop',
      config: {
        loopType: 'forEach',
        collection: [{ email: 'a@shop.test' }, { email: 'b@shop.test' }],
        itemVariable: 'item',
      },
      stepNumber: 1,
      label: 'Loop Over Each Billing Email',
    },
    {
      id: CUSTOM_ID,
      type: 'general-custom-node',
      config: {
        customNodeId: 'cn-email',
        parameters: {
          to: { type: 'workflowContext', nodeId: LOOP_ID, path: [LOOP_ID, 'currentItem', 'email'] },
        },
      },
      stepNumber: 2,
      label: 'Send Subscription Lifecycle Email',
    },
  ],
  edges: [
    { id: 'e1', source: 't', target: LOOP_ID },
    {
      id: 'e2',
      source: LOOP_ID,
      target: CUSTOM_ID,
      sourceHandle: 'loop',
      targetHandle: 'loop-body-in',
    },
    {
      id: 'e3',
      source: CUSTOM_ID,
      target: LOOP_ID,
      sourceHandle: 'loop-body-out',
      targetHandle: 'loop-back',
    },
  ],
}

const customNodes: any = {
  'cn-email': { id: 'cn-email', name: 'Send Subscription Lifecycle Email', nodes: [], edges: [] },
}

describe('generated cron route — custom node in a loop body', () => {
  it('runs the custom node for every item, with that item bound', async () => {
    const sent: unknown[] = []
    const runtime = { exports: loadServerRuntime() }
    const requireShim = (id: string) => {
      if (id.endsWith('/utils/workflows/server-runtime')) {
        return runtime.exports
      }
      if (id.endsWith('/utils/workflows/custom-nodes')) {
        return {
          'cn-email': async (_context: unknown, parameters: unknown) => {
            sent.push(parameters)
            return { sent: true }
          },
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(id)
    }
    const module = { exports: null as any }
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', generateCronAPIRoute(workflow, customNodes))(
      module,
      {},
      requireShim
    )

    const reply = { status: 0, body: null as any }
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
      url: '/api/workflows/cron_billing',
      headers: { host: 'shop.test', 'x-forwarded-proto': 'https' },
      body: {},
    }
    await withEnv({ TELEPORT_CRON_ALLOW_UNSIGNED: 'true', TELEPORT_CRON_SECRET: undefined }, () =>
      module.exports(req, res)
    )

    expect(reply.status).toBe(200)
    expect(sent).toEqual([{ to: 'a@shop.test' }, { to: 'b@shop.test' }])
  })
})
