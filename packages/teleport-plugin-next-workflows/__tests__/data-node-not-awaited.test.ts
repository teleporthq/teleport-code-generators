import {
  generateSharedRuntimeUtilsCode,
  generateClientRuntimeCode,
  generateServerSegmentAPIRoute,
  splitIntoSegments,
} from '../src'
import { redactServerNodeConfig } from '../src/segment-splitter'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { isFireAndForgetNode, isFireAndForgetSegment } from '../src/await-result'
import type { WorkflowSegment } from '../src/types'

// A data node always talks to the database over the network. The workflow
// editor lets the author opt OUT of awaiting one (`config.awaitResult: false`),
// which is what makes "add to favourites" feel instant: the insert still runs,
// but the click handler no longer blocks on a full round trip.
//
// The contract this file pins down:
//   1. the workflow does not wait for the query;
//   2. the node's context entry is `null` — never a partial or stale value;
//   3. a failure cannot abort the workflow (it is logged, not thrown);
//   4. the server route STILL settles the query before it responds, because a
//      serverless function may be frozen the instant it replies;
//   5. the client dispatches an all-fire-and-forget SEGMENT without awaiting the
//      round trip, which is where the latency the visitor feels actually goes.

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
  isFireAndForgetNode: (node: unknown) => boolean
  registerPendingNodePromise: (context: Record<string, unknown>, p: Promise<unknown>) => unknown
  settlePendingNodePromises: (context: Record<string, unknown>) => Promise<void>
}

function loadSharedRuntime(): SharedUtils {
  const src = generateSharedRuntimeUtilsCode()
  const wrapper: { exports: Record<string, unknown> } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', src)(wrapper, wrapper.exports)
  return wrapper.exports as unknown as SharedUtils
}

const deferred = () => {
  let resolve: (value?: unknown) => void = () => undefined
  let reject: (reason?: unknown) => void = () => undefined
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res as (value?: unknown) => void
    reject = rej
  })
  return { promise, resolve, reject }
}

const dataNode = (id: string, awaitResult?: boolean) => ({
  id,
  type: 'data-create-item',
  label: 'Save Row',
  stepNumber: 1,
  config: {
    dataSourceId: 'ds-1',
    tableName: 'teleport_favourites',
    ...(awaitResult === undefined ? {} : { awaitResult }),
  },
})

describe('isFireAndForgetNode — classification', () => {
  it('only opts out on an explicit false', () => {
    expect(isFireAndForgetNode(dataNode('n1', false) as never)).toBe(true)
    expect(isFireAndForgetNode(dataNode('n1', true) as never)).toBe(false)
    expect(isFireAndForgetNode(dataNode('n1') as never)).toBe(false)
  })

  it('ignores the flag on non-data node types', () => {
    // Node replacement copies config across types; a stray flag must not turn
    // an unrelated node fire-and-forget.
    const stray = {
      id: 'x',
      type: 'general-custom-js',
      label: 'Script',
      stepNumber: 1,
      config: { code: 'return {}', awaitResult: false },
    }
    expect(isFireAndForgetNode(stray as never)).toBe(false)
  })

  it('covers every data node type', () => {
    for (const type of [
      'data-select',
      'data-count',
      'data-raw-query',
      'data-create-item',
      'data-update-item',
      'data-delete-item',
    ]) {
      const node = { id: 'n', type, label: type, stepNumber: 1, config: { awaitResult: false } }
      expect(isFireAndForgetNode(node as never)).toBe(true)
    }
  })

  it('is mirrored inside the generated runtime', () => {
    const utils = loadSharedRuntime()
    expect(utils.isFireAndForgetNode(dataNode('n1', false))).toBe(true)
    expect(utils.isFireAndForgetNode(dataNode('n1'))).toBe(false)
  })
})

describe('executeNodes — a non-awaited data node does not block the chain', () => {
  it('continues to the next node while the query is still in flight', async () => {
    const utils = loadSharedRuntime()
    const gate = deferred()
    const order: string[] = []

    const nodes = [
      dataNode('write', false),
      { id: 'after', type: 'toast-show', label: 'Toast', stepNumber: 2, config: {} },
    ]
    const edges = [{ id: 'e1', source: 'write', target: 'after' }]

    const handlers = {
      'data-create-item': async () => {
        order.push('write:start')
        await gate.promise
        order.push('write:finish')
        return { id: 'row-1' }
      },
      'toast-show': async () => {
        order.push('toast')
        return { shown: true }
      },
    }

    const context: Record<string, unknown> = { __pendingNodePromises: [] }
    await utils.executeNodes(nodes, edges, context, handlers, {}, null, 'exec-1')

    // The toast ran BEFORE the insert finished — that is the whole point.
    expect(order).toEqual(['write:start', 'toast'])
    // And the node published null, not a half-finished result.
    expect(context.write).toBeNull()
    expect(context.after).toEqual({ shown: true })

    gate.resolve()
    await utils.settlePendingNodePromises(context)
    expect(order).toEqual(['write:start', 'toast', 'write:finish'])
  })

  it('still awaits the same node when the flag is absent', async () => {
    const utils = loadSharedRuntime()
    const order: string[] = []
    const nodes = [
      dataNode('write'),
      { id: 'after', type: 'toast-show', label: 'Toast', stepNumber: 2, config: {} },
    ]
    const edges = [{ id: 'e1', source: 'write', target: 'after' }]
    const handlers = {
      'data-create-item': async () => {
        await Promise.resolve()
        order.push('write:finish')
        return { id: 'row-1' }
      },
      'toast-show': async () => {
        order.push('toast')
        return { shown: true }
      },
    }

    const context: Record<string, unknown> = { __pendingNodePromises: [] }
    await utils.executeNodes(nodes, edges, context, handlers, {}, null, 'exec-2')

    expect(order).toEqual(['write:finish', 'toast'])
    expect(context.write).toEqual({ id: 'row-1' })
  })

  it('a downstream binding to the non-awaited node resolves to null', async () => {
    const utils = loadSharedRuntime()
    let seen: unknown = 'untouched'

    const nodes = [
      dataNode('write', false),
      {
        id: 'reader',
        type: 'toast-show',
        label: 'Toast',
        stepNumber: 2,
        config: {
          message: { type: 'workflowContext', nodeId: 'write', path: ['write', 'id'] },
        },
      },
    ]
    const edges = [{ id: 'e1', source: 'write', target: 'reader' }]
    const handlers = {
      'data-create-item': async () => ({ id: 'row-1' }),
      'toast-show': async (config: { message?: unknown }) => {
        seen = config.message
        return { shown: true }
      },
    }

    const context: Record<string, unknown> = { __pendingNodePromises: [] }
    await utils.executeNodes(nodes, edges, context, handlers, {}, null, 'exec-3')
    // `undefined` (not the written id) — the reference had nothing to drill.
    expect(seen).toBeUndefined()
  })
})

describe('executeNodes — a non-awaited failure cannot abort the workflow', () => {
  const silenceConsole = () => {
    // tslint:disable-next-line:no-console
    const original = console.error
    // tslint:disable-next-line:no-console
    console.error = () => undefined
    return () => {
      // tslint:disable-next-line:no-console
      console.error = original
    }
  }

  it('swallows a rejected handler and keeps going', async () => {
    const utils = loadSharedRuntime()
    const restore = silenceConsole()
    try {
      const nodes = [
        dataNode('write', false),
        { id: 'after', type: 'toast-show', label: 'Toast', stepNumber: 2, config: {} },
      ]
      const edges = [{ id: 'e1', source: 'write', target: 'after' }]
      const handlers = {
        'data-create-item': async () => {
          throw new Error('connection refused')
        },
        'toast-show': async () => ({ shown: true }),
      }

      const context: Record<string, unknown> = { __pendingNodePromises: [] }
      await expect(
        utils.executeNodes(nodes, edges, context, handlers, {}, null, 'exec-4')
      ).resolves.toBeUndefined()
      expect(context.write).toBeNull()
      expect(context.after).toEqual({ shown: true })
      // Draining must not reject either — the promise absorbed the failure.
      await expect(utils.settlePendingNodePromises(context)).resolves.toBeUndefined()
    } finally {
      restore()
    }
  })

  it('swallows an { error } result instead of throwing it as fatal', async () => {
    const utils = loadSharedRuntime()
    const restore = silenceConsole()
    try {
      const nodes = [dataNode('write', false)]
      const handlers = {
        'data-create-item': async () => ({ error: 'insert failed' }),
      }
      const context: Record<string, unknown> = { __pendingNodePromises: [] }
      await expect(
        utils.executeNodes(nodes, [], context, handlers, {}, null, 'exec-5')
      ).resolves.toBeUndefined()
      expect(context.write).toBeNull()
      await utils.settlePendingNodePromises(context)
    } finally {
      restore()
    }
  })
})

describe('settlePendingNodePromises', () => {
  it('is a no-op with nothing in flight', async () => {
    const utils = loadSharedRuntime()
    await expect(utils.settlePendingNodePromises({})).resolves.toBeUndefined()
    await expect(
      utils.settlePendingNodePromises({ __pendingNodePromises: [] })
    ).resolves.toBeUndefined()
  })

  it('drains work queued while an earlier promise was settling', async () => {
    const utils = loadSharedRuntime()
    const context: Record<string, unknown> = { __pendingNodePromises: [] }
    const done: string[] = []

    const second = () =>
      utils.registerPendingNodePromise(
        context,
        Promise.resolve().then(() => {
          done.push('second')
        })
      )

    utils.registerPendingNodePromise(
      context,
      Promise.resolve().then(() => {
        done.push('first')
        second()
      })
    )

    await utils.settlePendingNodePromises(context)
    expect(done).toEqual(['first', 'second'])
    expect(context.__pendingNodePromises).toEqual([])
  })
})

// ─── Segment classification ──────────────────────────────────────────────────

const buildWorkflow = (writeAwaitResult?: boolean) =>
  ({
    id: 'wf-1',
    name: 'Toggle Favourite',
    trigger: {
      type: 'event-element-clicked',
      nodeId: 'trigger',
      scope: 'element',
      config: { nodeId: 'heart-btn' },
    },
    nodes: [
      {
        id: 'state',
        type: 'state-update-global-state',
        label: 'Optimistic update',
        config: { property: 'favs', value: [] },
        executionEnv: 'client',
        stepNumber: 1,
      },
      {
        id: 'write',
        type: 'data-create-item',
        label: 'Add To Favourites Table',
        config: {
          dataSourceId: 'ds-1',
          tableName: 'teleport_favourites',
          columnMappings: [{ column: 'entity_id', value: 'x' }],
          ...(writeAwaitResult === undefined ? {} : { awaitResult: writeAwaitResult }),
        },
        executionEnv: 'server',
        stepNumber: 2,
      },
    ],
    edges: [{ id: 'e1', source: 'state', target: 'write' }],
  } as never)

describe('segment classification', () => {
  it('marks a segment whose every node is fire-and-forget', () => {
    const segments = splitIntoSegments(buildWorkflow(false))
    const server = segments.filter((s) => s.env === 'server')
    expect(server.length).toBe(1)
    expect(isFireAndForgetSegment(server[0])).toBe(true)
  })

  it('does not mark the same segment when the write is awaited', () => {
    const segments = splitIntoSegments(buildWorkflow())
    const server = segments.filter((s) => s.env === 'server')
    expect(server.length).toBe(1)
    expect(isFireAndForgetSegment(server[0])).toBe(false)
  })

  it('does not mark a MIXED segment — one awaited node keeps the whole trip blocking', () => {
    const mixed: WorkflowSegment = {
      id: 'server-1',
      env: 'server',
      nodeIds: ['a', 'b'],
      nodes: [
        {
          id: 'a',
          type: 'data-select',
          label: 'Read',
          config: { awaitResult: false },
          executionEnv: 'server',
          stepNumber: 1,
        },
        {
          id: 'b',
          type: 'data-select',
          label: 'Read 2',
          config: {},
          executionEnv: 'server',
          stepNumber: 2,
        },
      ],
      edges: [],
    }
    expect(isFireAndForgetSegment(mixed)).toBe(false)
  })

  it('never marks a client segment', () => {
    const clientSeg: WorkflowSegment = {
      id: 'client-1',
      env: 'client',
      nodeIds: [],
      nodes: [],
      edges: [],
    }
    expect(isFireAndForgetSegment(clientSeg)).toBe(false)
  })
})

describe('client config redaction', () => {
  it('keeps awaitResult but drops the query/table/mappings', () => {
    const config = {
      dataSourceId: 'ds-1',
      tableName: 'teleport_favourites',
      query: 'SELECT secret FROM t',
      columnMappings: [{ column: 'entity_id', value: 'x' }],
      awaitResult: false,
    }
    const redacted = redactServerNodeConfig(config, 'server')
    expect(redacted).toEqual({ awaitResult: false })
  })

  it('leaves a client-side node config untouched', () => {
    const config = { property: 'favs', awaitResult: false }
    expect(redactServerNodeConfig(config, 'client')).toBe(config)
  })
})

// ─── Generated routes ────────────────────────────────────────────────────────

const buildServerSegment = (awaitResult?: boolean): WorkflowSegment => ({
  id: 'server-1',
  env: 'server',
  nodeIds: ['write'],
  nodes: [
    {
      id: 'write',
      type: 'data-create-item',
      label: 'Add To Favourites Table',
      config: {
        dataSourceId: 'ds-1',
        tableName: 'teleport_favourites',
        ...(awaitResult === undefined ? {} : { awaitResult }),
      },
      executionEnv: 'server',
      stepNumber: 1,
    },
  ],
  edges: [],
})

describe('generated server segment route', () => {
  const route = generateServerSegmentAPIRoute(buildServerSegment(false), 'Toggle Favourite')

  it('dispatches a fire-and-forget node instead of awaiting it', () => {
    expect(route).toContain('utils.isFireAndForgetNode(node)')
    expect(route).toContain('utils.startFireAndForgetNode(node, handler, resolved, context)')
    expect(route).toContain('context[node.id] = null;')
  })

  it('settles in-flight queries BEFORE responding (the platform can freeze us)', () => {
    expect(route).toContain('await utils.settlePendingNodePromises(context);')
    const settleAt = route.indexOf('await utils.settlePendingNodePromises(context);')
    const respondAt = route.indexOf('res.status(200).json({ success: true, results: context });')
    expect(settleAt).toBeGreaterThan(-1)
    expect(respondAt).toBeGreaterThan(settleAt)
  })

  it('never ships the in-flight promise list back to the client', () => {
    expect(route).toContain('delete context.__pendingNodePromises;')
  })

  it('drains even when the segment throws', () => {
    expect(route).toContain(
      'if (__wfContext) { await utils.settlePendingNodePromises(__wfContext); }'
    )
  })

  it('applies the same treatment inside loop bodies and parallel branches', () => {
    expect(route).toContain('utils.isFireAndForgetNode(bNode)')
    expect(route).toContain('utils.isFireAndForgetNode(pNode)')
  })
})

describe('generated client runtime', () => {
  const client = generateClientRuntimeCode()

  it('dispatches an all-fire-and-forget segment without awaiting the round trip', () => {
    expect(client).toContain('if (segIsFireAndForget) {')
    expect(client).toContain('callServerSegment(ffUrl, context).catch(')
    // The nodes still get their null entries so downstream reads are defined.
    expect(client).toContain('context[seg.nodes[ffi].id] = null;')
  })

  it('upgrades a mixed segment to fire-and-forget when the awaited nodes were branch-skipped', () => {
    // Static flag first, then the dynamic check over the LIVE (non-skipped)
    // nodes — a mixed segment whose awaited nodes sit on a branch that was
    // not taken has only fire-and-forget work left to do.
    expect(client).toContain(
      'var segLiveNodes = seg.nodes.filter(function(n) { return !(context.__skippedNodes && context.__skippedNodes[n.id]); });'
    )
    expect(client).toContain('var segIsFireAndForget = seg.fireAndForget ||')
    expect(client).toContain('segLiveNodes.every(utils.isFireAndForgetNode)')
  })

  it('keeps awaiting a normal server segment', () => {
    expect(client).toContain('const serverResults = await callServerSegment(url, context);')
  })

  it('never serializes the in-flight promise list to the server', () => {
    expect(client).toContain("if (key === '__pendingNodePromises') continue;")
  })
})

// ─── Generated custom node, end to end ───────────────────────────────────────

describe('generated custom node — the "Remove From Favourites Logic" shape', () => {
  // Mirrors what teleport-gui's favourites builder emits:
  //   Extract Params (client-js) → Delete From Favourites Table (data, NOT
  //   awaited) → Get Favourites State → Filter → Update Favourites State
  // The delete is the only server node, so it becomes its own fire-and-forget
  // segment and the click never waits for the database.
  const customNodes = {
    'cn-remove': {
      id: 'cn-remove',
      name: 'Remove From Favourites Logic',
      parameters: [],
      nodes: [
        {
          id: 'extract',
          type: 'general-custom-js',
          label: 'Extract Remove Params',
          config: {
            code: 'function customHandler(p, q) { return { entityId: "e1" } }',
            context: 'client',
          },
          executionEnv: 'client',
          stepNumber: 1,
        },
        {
          id: 'delete',
          type: 'data-delete-item',
          label: 'Delete From Favourites Table',
          config: { dataSourceId: 'ds-1', tableName: 'teleport_favourites', awaitResult: false },
          executionEnv: 'server',
          stepNumber: 2,
        },
        {
          id: 'update',
          type: 'state-update-global-state',
          label: 'Update Favourites Global State',
          config: { property: 'teleportProductFavourites', value: [] },
          executionEnv: 'client',
          stepNumber: 3,
        },
      ],
      edges: [
        { id: 'e1', source: 'extract', target: 'delete' },
        { id: 'e2', source: 'delete', target: 'update' },
      ],
    },
  }

  interface BootedCustomNode {
    run: (
      outerContext: Record<string, unknown>,
      parameters: Record<string, unknown>,
      handlers: Record<string, unknown>
    ) => Promise<unknown>
    segmentCalls: string[]
    resolveSegment: () => void
  }

  const bootCustomNode = (): BootedCustomNode => {
    const plugin = new NextWorkflowProjectPlugin() as unknown as {
      generateCustomNodesFile: (
        nodes: Record<string, unknown>,
        urls: Record<string, Record<string, string>>
      ) => string
    }
    const source = plugin.generateCustomNodesFile(customNodes, {
      'cn-remove': { 'server-1': '/api/workflows/remove-seg-1' },
    })

    // runtime-utils REPLACES module.exports wholesale, so read it back off the
    // module object rather than the `exports` alias.
    const utilsModule: { exports: Record<string, unknown> } = { exports: {} }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('module', 'exports', generateSharedRuntimeUtilsCode())(
      utilsModule,
      utilsModule.exports
    )
    const utilsExports = utilsModule.exports

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
      id === './runtime-utils' ? utilsExports : id === './runtime' ? runtimeStub : {}

    const moduleStub: { exports: Record<string, unknown> } = { exports: {} }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('module', 'exports', 'require', source)(
      moduleStub,
      moduleStub.exports,
      requireStub
    )

    const registry = moduleStub.exports as Record<string, BootedCustomNode['run']>
    return { run: registry['cn-remove'], segmentCalls, resolveSegment: releaseSegment }
  }

  it('returns before the delete round trip completes, and returns the LAST awaited node', async () => {
    const booted = bootCustomNode()
    const handlers = {
      'general-custom-js': async () => ({ entityId: 'e1' }),
      'state-update-global-state': async () => ({
        success: true,
        property: 'teleportProductFavourites',
      }),
    }

    // Never released — if the custom node awaited the segment this would hang.
    const result = (await booted.run({}, {}, handlers)) as Record<string, unknown>

    expect(booted.segmentCalls).toEqual(['/api/workflows/remove-seg-1'])
    // NOT the fire-and-forget node's null: the state update is the last node
    // whose result the custom node may hand back to its caller.
    expect(result).toEqual({ success: true, property: 'teleportProductFavourites' })

    booted.resolveSegment()
  })

  it('publishes null under the non-awaited node so downstream reads are defined', async () => {
    const booted = bootCustomNode()
    const seen: Record<string, unknown> = {}
    const handlers = {
      'general-custom-js': async () => ({ entityId: 'e1' }),
      'state-update-global-state': async (_config: unknown, context: Record<string, unknown>) => {
        seen.delete = context.delete
        seen.hasKey = Object.prototype.hasOwnProperty.call(context, 'delete')
        return { success: true }
      },
    }

    await booted.run({}, {}, handlers)
    expect(seen.hasKey).toBe(true)
    expect(seen.delete).toBeNull()

    booted.resolveSegment()
  })
})
