import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { generateSharedRuntimeUtilsCode } from '../src'

// End-to-end boot of the generated custom-nodes runtime against the
// resolve-user GRAPH SHAPE (guest half): an outer "returning guest?" gate and,
// on its true branch, the once-per-session "needs row ensure?" gate in front of
// the fire-and-forget users-row re-ensure. The two data-create-item nodes (the
// ensure and the new-guest create) share ONE server segment, so the runtime
// must:
//   1. dispatch that segment WITHOUT awaiting when only the ff ensure is live
//      (first resolution of a returning guest);
//   2. issue NO request at all when BOTH branches' data nodes are skipped
//      (second resolution — the once-per-session gate turned the ensure off);
//   3. still block on the segment when the awaited new-guest create is live.
describe('generated custom node — resolve-user shape, once-per-session ensure skip', () => {
  const script = (ret: string) => `function customHandler(p, q) { return ${ret} }`

  const customNodes = {
    'cn-resolve': {
      id: 'cn-resolve',
      name: 'Resolve-user shape',
      parameters: [],
      nodes: [
        {
          id: 'parse',
          type: 'general-custom-js',
          label: 'Parse Stored Anonymous User',
          config: { code: script('{ marker: "parse" }'), context: 'client' },
          executionEnv: 'client',
          stepNumber: 0,
        },
        {
          id: 'gate-returning',
          type: 'general-if-statement',
          label: 'Returning Guest?',
          config: {
            conditionType: 'simple-comparison',
            leftValue: {
              type: 'workflowContext',
              nodeId: 'parse',
              path: ['parse', 'returning'],
            },
            operator: '===',
            rightValue: true,
          },
          executionEnv: 'client',
          stepNumber: 1,
        },
        {
          id: 'gate-needs-ensure',
          type: 'general-if-statement',
          label: 'Needs Anonymous Row Ensure?',
          config: {
            conditionType: 'simple-comparison',
            leftValue: {
              type: 'workflowContext',
              nodeId: 'parse',
              path: ['parse', 'needsDbEnsure'],
            },
            operator: '===',
            rightValue: true,
          },
          executionEnv: 'client',
          stepNumber: 2,
        },
        {
          id: 'ensure',
          type: 'data-create-item',
          label: 'Ensure Anonymous User Record',
          config: { awaitResult: false },
          executionEnv: 'server',
          stepNumber: 3,
        },
        {
          id: 'create',
          type: 'data-create-item',
          label: 'Create Anonymous User Record',
          config: {},
          executionEnv: 'server',
          stepNumber: 3,
        },
        {
          id: 'return-ensured',
          type: 'general-custom-js',
          label: 'Return Stored (Ensured)',
          config: { code: script('{ branch: "ensured" }'), context: 'client' },
          executionEnv: 'client',
          stepNumber: 4,
        },
        {
          id: 'return-skip',
          type: 'general-custom-js',
          label: 'Return Stored (Row Already Ensured)',
          config: { code: script('{ branch: "skip" }'), context: 'client' },
          executionEnv: 'client',
          stepNumber: 4,
        },
        {
          id: 'return-new',
          type: 'general-custom-js',
          label: 'Return New',
          config: { code: script('{ branch: "new" }'), context: 'client' },
          executionEnv: 'client',
          stepNumber: 4,
        },
      ],
      edges: [
        { id: 'e1', source: 'parse', target: 'gate-returning' },
        { id: 'e2', source: 'gate-returning', target: 'gate-needs-ensure', sourceHandle: 'true' },
        { id: 'e3', source: 'gate-returning', target: 'create', sourceHandle: 'false' },
        { id: 'e4', source: 'gate-needs-ensure', target: 'ensure', sourceHandle: 'true' },
        { id: 'e5', source: 'gate-needs-ensure', target: 'return-skip', sourceHandle: 'false' },
        { id: 'e6', source: 'ensure', target: 'return-ensured' },
        { id: 'e7', source: 'create', target: 'return-new' },
      ],
    },
  }

  interface Booted {
    run: (
      outerContext: Record<string, unknown>,
      parameters: Record<string, unknown>,
      handlers: Record<string, unknown>
    ) => Promise<unknown>
    segmentCalls: string[]
    resolveSegment: () => void
  }

  const bootCustomNode = (): Booted => {
    const plugin = new NextWorkflowProjectPlugin() as unknown as {
      generateCustomNodesFile: (
        nodes: Record<string, unknown>,
        urls: Record<string, Record<string, string>>
      ) => string
    }
    const source = plugin.generateCustomNodesFile(customNodes, {
      'cn-resolve': { 'server-1': '/api/workflows/resolve-seg-1' },
    })

    const utilsModule: { exports: Record<string, unknown> } = { exports: {} }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('module', 'exports', generateSharedRuntimeUtilsCode())(
      utilsModule,
      utilsModule.exports
    )

    const segmentCalls: string[] = []
    let releaseSegment: () => void = () => undefined
    const segmentGate = new Promise<void>((resolve) => {
      releaseSegment = resolve
    })
    const runtimeStub = {
      findStreamingAINodes: () => ({}),
      mergeServerResults: () => undefined,
      callStreamingServerSegment: async () => ({}),
      callServerSegment: async (url: string) => {
        segmentCalls.push(url)
        await segmentGate
        return {}
      },
    }

    const requireStub = (id: string) =>
      id === './runtime-utils' ? utilsModule.exports : id === './runtime' ? runtimeStub : {}

    const moduleStub: { exports: Record<string, unknown> } = { exports: {} }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('module', 'exports', 'require', source)(
      moduleStub,
      moduleStub.exports,
      requireStub
    )

    return {
      run: (moduleStub.exports as Record<string, Booted['run']>)['cn-resolve'],
      segmentCalls,
      resolveSegment: releaseSegment,
    }
  }

  const parseHandler = (returning: boolean, needsDbEnsure: boolean) => ({
    'general-custom-js': async (config: { code?: string }) => {
      const code = (config && config.code) || ''
      if (code.includes('parse')) {
        return { returning, needsDbEnsure }
      }
      if (code.includes('ensured')) {
        return { branch: 'ensured' }
      }
      if (code.includes('skip')) {
        return { branch: 'skip' }
      }
      return { branch: 'new' }
    },
  })

  it('first resolution of a returning guest: ONE dispatch, not awaited', async () => {
    const booted = bootCustomNode()
    // Gate never released — awaiting the segment would hang the test.
    const result = (await booted.run({}, {}, parseHandler(true, true))) as Record<string, unknown>
    expect(booted.segmentCalls).toEqual(['/api/workflows/resolve-seg-1'])
    expect(result).toEqual({ branch: 'ensured' })
    booted.resolveSegment()
  })

  it('second resolution in the same session: ZERO server requests', async () => {
    const booted = bootCustomNode()
    const result = (await booted.run({}, {}, parseHandler(true, false))) as Record<string, unknown>
    expect(booted.segmentCalls).toEqual([])
    expect(result).toEqual({ branch: 'skip' })
  })

  it('a brand-new guest still blocks on the awaited create', async () => {
    const booted = bootCustomNode()
    let settled = false
    const running = booted.run({}, {}, parseHandler(false, true)).then((result) => {
      settled = true
      return result
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(booted.segmentCalls).toEqual(['/api/workflows/resolve-seg-1'])
    expect(settled).toBe(false)
    booted.resolveSegment()
    expect(await running).toEqual({ branch: 'new' })
  })
})
