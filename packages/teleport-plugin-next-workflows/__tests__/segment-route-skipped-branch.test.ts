import { generateServerSegmentAPIRoute } from '../src/api-route-generator'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'

/**
 * A server segment never runs a node of an if-statement branch it did not
 * take — an if-statement there included. It used to evaluate those before
 * checking the skip list, and hand their `{ result }`s back: a custom node
 * answers the output of the last node it ran, so the email senders of
 * teleport-gui (one "is it this email?" → send → "was it accepted?" → report
 * branch per purpose, all in one server segment) answered `{ result: false }`
 * instead of their report, and every caller read "not sent" whatever happened.
 */

const purpose = { type: 'workflowContext', nodeId: 'read', path: ['read', 'purpose'] }

const ifNode = (id: string, stepNumber: number, leftValue: unknown, rightValue: unknown) => ({
  id,
  type: 'general-if-statement',
  label: id,
  config: { conditionType: 'simple-comparison', leftValue, operator: '===', rightValue },
  executionEnv: 'server',
  stepNumber,
})

const segment = {
  id: 'server-1',
  env: 'server',
  nodeIds: ['isA', 'acceptedA', 'isB', 'acceptedB'],
  nodes: [
    ifNode('isA', 1, purpose, 'a'),
    ifNode('acceptedA', 2, 'yes', 'yes'),
    ifNode('isB', 2, purpose, 'b'),
    // Numbered after the branch that runs: the one an answer used to pick.
    ifNode('acceptedB', 3, 'yes', 'yes'),
  ],
  edges: [
    { id: 'e1', source: 'isA', target: 'acceptedA', sourceHandle: 'true' },
    { id: 'e2', source: 'isA', target: 'isB', sourceHandle: 'false' },
    { id: 'e3', source: 'isB', target: 'acceptedB', sourceHandle: 'true' },
  ],
} as unknown as WorkflowSegment

async function runSegment(incoming: Record<string, unknown>): Promise<Record<string, any>> {
  const runtime = loadServerRuntime()
  const requireShim = (id: string) => {
    if (id.endsWith('/utils/workflows/server-runtime')) {
      return runtime
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id)
  }
  const module = { exports: null as any }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', generateServerSegmentAPIRoute(segment, 'Sender'))(
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
    setHeader: () => undefined,
  }
  await module.exports(
    {
      method: 'POST',
      url: '/api/workflows/sender-seg-1',
      headers: { host: 'shop.test', 'x-forwarded-proto': 'https' },
      body: { context: incoming },
    },
    res
  )
  expect(reply.status).toBe(200)
  return reply.body.results
}

describe('generated server segment route — a branch not taken', () => {
  it('answers the branch it took, and nothing of the one it skipped', async () => {
    const results = await runSegment({ read: { purpose: 'a' } })
    expect(results.isA).toEqual({ result: true })
    expect(results.acceptedA).toEqual({ result: true })
    expect(results).not.toHaveProperty('isB')
    expect(results).not.toHaveProperty('acceptedB')
    expect(results.__skippedNodes).toMatchObject({ isB: true, acceptedB: true })
  })

  it('runs the other branch when that one is taken', async () => {
    const results = await runSegment({ read: { purpose: 'b' } })
    expect(results.isB).toEqual({ result: true })
    expect(results.acceptedB).toEqual({ result: true })
    expect(results).not.toHaveProperty('acceptedA')
  })
})
