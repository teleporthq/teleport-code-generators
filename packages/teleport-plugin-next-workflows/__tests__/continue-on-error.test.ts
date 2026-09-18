import { generateSharedRuntimeUtilsCode, generateServerSegmentAPIRoute } from '../src'
import type { WorkflowSegment } from '../src/types'

// A node marked `continueOnError` reports a failed RESULT ({ success: false } /
// { error }) under its id instead of aborting the workflow, so the next
// if-statement can read `success` and warn. The default is unchanged: a
// failed result aborts, and so does a handler that throws — with or without
// the flag, because every provider handler reports failure as a result.

interface SharedUtils {
  executeNodes: (
    nodes: unknown[],
    edges: unknown[],
    context: Record<string, unknown>,
    handlers: Record<string, unknown>,
    workflowConfig: unknown,
    callServerSegment: unknown,
    executionId: string
  ) => Promise<void>
  continuesOnError: (node: unknown) => boolean
}

function loadSharedRuntime(): SharedUtils {
  const src = generateSharedRuntimeUtilsCode()
  const wrapper: { exports: Record<string, unknown> } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', src)(wrapper, wrapper.exports)
  return wrapper.exports as unknown as SharedUtils
}

const sendNode = (continueOnError?: boolean) => ({
  id: 'send',
  type: 'email-resend',
  label: 'Send Shipped Email',
  stepNumber: 1,
  config: {
    to: 'jane@example.com',
    ...(continueOnError === undefined ? {} : { continueOnError }),
  },
})
const afterNode = { id: 'after', type: 'toast-show', label: 'Toast', stepNumber: 2, config: {} }
const edges = [{ id: 'e1', source: 'send', target: 'after' }]

describe('continuesOnError — classification', () => {
  it('opts in only on an explicit true', () => {
    const utils = loadSharedRuntime()
    expect(utils.continuesOnError(sendNode(true))).toBe(true)
    expect(utils.continuesOnError(sendNode(false))).toBe(false)
    expect(utils.continuesOnError(sendNode())).toBe(false)
    expect(utils.continuesOnError({ id: 'x', type: 'toast-show' })).toBe(false)
    expect(utils.continuesOnError(null)).toBe(false)
  })
})

describe('executeNodes — a refused result on a continueOnError node', () => {
  const refused = { id: '', success: false, error: 'Domain not verified' }

  it('is published under the node id and the chain goes on', async () => {
    const utils = loadSharedRuntime()
    const ran: string[] = []
    const handlers = {
      'email-resend': async () => refused,
      'toast-show': async () => {
        ran.push('toast')
        return { shown: true }
      },
    }
    const context: Record<string, unknown> = {}
    await utils.executeNodes([sendNode(true), afterNode], edges, context, handlers, {}, null, 'x1')
    expect(context.send).toEqual(refused)
    expect(ran).toEqual(['toast'])
  })

  it('still aborts the chain without the flag', async () => {
    const utils = loadSharedRuntime()
    const ran: string[] = []
    const handlers = {
      'email-resend': async () => refused,
      'toast-show': async () => {
        ran.push('toast')
        return { shown: true }
      },
    }
    const context: Record<string, unknown> = {}
    await expect(
      utils.executeNodes([sendNode(), afterNode], edges, context, handlers, {}, null, 'x2')
    ).rejects.toThrow('Domain not verified')
    expect(ran).toEqual([])
  })

  it('does not swallow a handler that throws', async () => {
    const utils = loadSharedRuntime()
    const handlers = {
      'email-resend': async () => {
        throw new Error('network down')
      },
      'toast-show': async () => ({ shown: true }),
    }
    await expect(
      utils.executeNodes([sendNode(true), afterNode], edges, {}, handlers, {}, null, 'x3')
    ).rejects.toThrow('network down')
  })
})

describe('generated server segment route', () => {
  const segment: WorkflowSegment = {
    id: 'server-1',
    env: 'server',
    nodeIds: ['send'],
    nodes: [{ ...sendNode(true), executionEnv: 'server' }],
    edges: [],
  }
  it('gates its fatal-result check on the same predicate', () => {
    const route = generateServerSegmentAPIRoute(segment, 'Send Shipped Email')
    expect(route).toContain(
      'if (utils.isFatalNodeResult(result) && !utils.continuesOnError(node)) {'
    )
  })
})
