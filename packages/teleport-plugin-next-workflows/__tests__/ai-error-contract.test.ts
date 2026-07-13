// Regression guard for "AI provider/auth failures treated as success".
//
// Every AI node handler (src/nodes/ai/*) signals failure with
// `{ error: true, message, code }` — a BOOLEAN error flag — while the executor
// error gates only tested `typeof result.error === 'string'`. A missing
// OPENAI key therefore sailed through as a successful node result and the
// pipeline limped into a downstream NOT NULL 500 (e.g. persisting a NULL chat
// answer). The gates now treat `result.error === true` as fatal too, via the
// shared isFatalNodeResult / fatalNodeResultMessage runtime helpers.

import { generateSharedRuntimeUtilsCode } from '../src/executor-generator'
import {
  generateServerSegmentAPIRoute,
  generateStreamingServerSegmentAPIRoute,
} from '../src/api-route-generator'
import type { WorkflowSegment } from '../src/types'

type UtilsModule = {
  isFatalNodeResult: (result: unknown) => boolean
  fatalNodeResultMessage: (result: Record<string, unknown>) => string
  executeNodes: (
    nodes: unknown[],
    edges: unknown[],
    context: Record<string, unknown>,
    nodeHandlers: Record<string, unknown>,
    workflowConfig: unknown,
    callServerSegment: unknown,
    executionId: string
  ) => Promise<void>
}

function loadUtils(): UtilsModule {
  const utilsModule = { exports: {} as unknown as UtilsModule }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', generateSharedRuntimeUtilsCode())(
    utilsModule,
    utilsModule.exports,
    () => ({})
  )
  return utilsModule.exports
}

describe('isFatalNodeResult — error contract normalization', () => {
  const utils = loadUtils()

  it('treats the AI-node contract { error: true, message, code } as fatal', () => {
    expect(
      utils.isFatalNodeResult({ error: true, message: 'No API key', code: 'authentication_error' })
    ).toBeTruthy()
  })

  it('keeps the legacy string-error contract fatal', () => {
    expect(utils.isFatalNodeResult({ error: 'boom' })).toBeTruthy()
    expect(utils.isFatalNodeResult({ success: false })).toBeTruthy()
  })

  it('does not flag successful results', () => {
    expect(utils.isFatalNodeResult({ result: 'ok' })).toBeFalsy()
    expect(utils.isFatalNodeResult({ error: false })).toBeFalsy()
    expect(utils.isFatalNodeResult({ error: '' })).toBeFalsy()
    expect(utils.isFatalNodeResult(null)).toBeFalsy()
    expect(utils.isFatalNodeResult(undefined)).toBeFalsy()
  })

  it('surfaces the AI-node message when error is boolean', () => {
    expect(
      utils.fatalNodeResultMessage({ error: true, message: 'Incorrect API key provided' })
    ).toBe('Incorrect API key provided')
    expect(utils.fatalNodeResultMessage({ error: 'raw string error' })).toBe('raw string error')
    expect(utils.fatalNodeResultMessage({ success: false })).toBe('Node execution failed')
  })
})

describe('executeNodes halts on { error: true } and never reaches downstream nodes', () => {
  const utils = loadUtils()

  const nodes = [
    { id: 'ai-1', type: 'ai-custom-prompt', config: {}, stepNumber: 1 },
    { id: 'persist-1', type: 'data-create-item', config: {}, stepNumber: 2 },
  ]
  const edges = [{ id: 'e1', source: 'ai-1', target: 'persist-1' }]

  it('throws with the provider message and skips the downstream persist node', async () => {
    const persistCalls: unknown[] = []
    const handlers = {
      'ai-custom-prompt': async () => ({
        error: true,
        message: 'AI provider authentication failed',
        code: 'authentication_error',
      }),
      'data-create-item': async () => {
        persistCalls.push('persist')
        return { success: true }
      },
    }

    await expect(
      utils.executeNodes(nodes, edges, {}, handlers, { nodes, edges }, null, 'exec-1')
    ).rejects.toThrow('AI provider authentication failed')
    expect(persistCalls).toHaveLength(0)
  })

  it('still runs downstream nodes for successful AI results', async () => {
    const persistCalls: unknown[] = []
    const handlers = {
      'ai-custom-prompt': async () => ({ response: 'hello', model: 'gpt-4o' }),
      'data-create-item': async () => {
        persistCalls.push('persist')
        return { success: true }
      },
    }

    await utils.executeNodes(nodes, edges, {}, handlers, { nodes, edges }, null, 'exec-2')
    expect(persistCalls).toHaveLength(1)
  })
})

describe('generated server routes gate node results through the shared helpers', () => {
  const segment: WorkflowSegment = {
    id: 'server-1',
    env: 'server',
    nodeIds: ['ai-1'],
    nodes: [
      {
        id: 'ai-1',
        type: 'ai-custom-prompt',
        config: { prompt: 'hi', streaming: true },
        stepNumber: 1,
      } as never,
    ],
    edges: [],
  }

  it('non-streaming segment route uses isFatalNodeResult', () => {
    const route = generateServerSegmentAPIRoute(
      { ...segment, nodes: [{ ...segment.nodes[0], config: { prompt: 'hi' } } as never] },
      'Chat'
    )
    expect(route).toContain('utils.isFatalNodeResult(result)')
    expect(route).toContain('utils.fatalNodeResultMessage(result)')
  })

  it('streaming segment route gates the streaming AI result itself before running on-end nodes', () => {
    const route = generateStreamingServerSegmentAPIRoute(segment, 'Chat')
    // Two gates: the streaming AI node's own result + the non-streaming path.
    const occurrences = route.split('utils.isFatalNodeResult(result)').length - 1
    expect(occurrences).toBeGreaterThanOrEqual(2)
  })
})
