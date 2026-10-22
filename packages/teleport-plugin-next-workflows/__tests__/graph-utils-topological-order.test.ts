import {
  getTopologicalOrder,
  getNeverRunTogether,
  collectWorkflowContextNodeIds,
} from '../src/graph-utils'
import type { UIDLWorkflowNode, UIDLWorkflowEdge } from '@teleporthq/teleport-types'

const node = (
  id: string,
  type: string,
  stepNumber: number,
  config: Record<string, unknown> = {}
): UIDLWorkflowNode => ({
  id,
  type,
  label: id,
  config,
  executionEnv: type === 'data-create-item' || type.startsWith('data-') ? 'server' : 'client',
  stepNumber,
})

const wfCtx = (nodeId: string) => ({
  type: 'workflowContext',
  nodeId,
  path: [nodeId, 'value'],
})

describe('collectWorkflowContextNodeIds', () => {
  it('finds workflowContext node ids nested in arrays and objects', () => {
    const config = {
      columnMappings: [
        { column: 'title', value: wfCtx('get-title') },
        { column: 'type_field', value: wfCtx('get-type') },
      ],
      filters: [{ field: 'id', value: '{{Current Page Entity.id}}' }],
    }
    const out = new Set<string>()
    collectWorkflowContextNodeIds(config, out)
    expect(Array.from(out).sort()).toEqual(['get-title', 'get-type'])
  })
})

describe('getTopologicalOrder — implicit workflowContext dependencies', () => {
  it('orders a state-get BEFORE the data-create that reads it via columnMappings (no explicit edge)', () => {
    // Reproduces run 0a5f554e: the create references get-state-type only through
    // its config; there is NO explicit edge between them.
    const nodes = [
      node('trig', 'event-form-submitted', 0),
      node('insert-title', 'data-create-item', 0, {
        tableName: 'titles',
        columnMappings: [{ column: 'type_field', value: wfCtx('get-state-type') }],
      }),
      node('get-state-type', 'state-get-local-state', 3, { property: 'typeField' }),
    ]
    const edges: UIDLWorkflowEdge[] = [{ id: 'e1', source: 'trig', target: 'get-state-type' }]

    const order = getTopologicalOrder(nodes, edges)
    expect(order.indexOf('get-state-type')).toBeLessThan(order.indexOf('insert-title'))
  })

  it('does not reorder a correctly wired linear workflow', () => {
    const nodes = [
      node('trig', 'event-element-clicked', 0),
      node('get', 'state-get-local-state', 1, { property: 'q' }),
      node('sel', 'data-select', 2, {
        tableName: 't',
        filters: [{ field: 'q', value: wfCtx('get') }],
      }),
      node('upd', 'state-update-local-state', 3, { property: 'rows' }),
    ]
    const edges: UIDLWorkflowEdge[] = [
      { id: 'e1', source: 'trig', target: 'get' },
      { id: 'e2', source: 'get', target: 'sel' },
      { id: 'e3', source: 'sel', target: 'upd' },
    ]
    expect(getTopologicalOrder(nodes, edges)).toEqual(['trig', 'get', 'sel', 'upd'])
  })

  it('ignores a workflowContext ref to a control-flow (loop) node', () => {
    // A node reading a loop's currentItem must NOT be forced after the loop via a
    // synthetic data edge (loop bodies are handled by dedicated edge handles).
    const nodes = [
      node('trig', 'event-element-clicked', 0),
      node('reader', 'data-create-item', 1, {
        tableName: 't',
        columnMappings: [
          {
            column: 'x',
            value: { type: 'workflowContext', nodeId: 'loop', path: ['loop', 'currentItem'] },
          },
        ],
      }),
      node('loop', 'general-loop', 5, {}),
    ]
    const edges: UIDLWorkflowEdge[] = [{ id: 'e1', source: 'trig', target: 'reader' }]
    // No virtual edge loop->reader is added, so reader (step 1) stays before loop (step 5).
    const order = getTopologicalOrder(nodes, edges)
    expect(order.indexOf('reader')).toBeLessThan(order.indexOf('loop'))
  })

  it('tolerates self / unknown refs without crashing', () => {
    const nodes = [
      node('trig', 'event-element-clicked', 0),
      node('a', 'data-select', 1, {
        filters: [{ value: wfCtx('a') }, { value: wfCtx('ghost') }],
      }),
    ]
    const edges: UIDLWorkflowEdge[] = [{ id: 'e1', source: 'trig', target: 'a' }]
    expect(() => getTopologicalOrder(nodes, edges)).not.toThrow()
    expect(getTopologicalOrder(nodes, edges)).toEqual(['trig', 'a'])
  })
})

const edge = (source: string, target: string, sourceHandle?: string, targetHandle?: string) => ({
  id: `${source}->${target}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
  ...(targetHandle ? { targetHandle } : {}),
})

// The segment splitter's view: data steps on the server, browser steps on the
// client, an if-statement wherever the step before it ran.
const sideOf = (n: UIDLWorkflowNode) =>
  n.type === 'general-if-statement' ? null : n.type.startsWith('data-') ? 'server' : 'client'

describe('getTopologicalOrder — loop back edges', () => {
  it('a loop is not held up by the edge that sends its body back for the next item', () => {
    // Counted as a dependency, the back edge left the loop waiting forever and
    // everything from the loop on was ordered by step alone, so `join` (step 4,
    // also reached by the short path) ran before `long2` (step 5) it waits for.
    const nodes = [
      node('start', 'state-get-local-state', 1),
      node('loop', 'general-loop', 2),
      node('body', 'data-create-item', 3),
      node('after', 'general-custom-js', 3),
      node('long1', 'general-custom-js', 4),
      node('long2', 'general-custom-js', 5),
      node('join', 'data-update-item', 4),
    ]
    const edges: UIDLWorkflowEdge[] = [
      edge('start', 'loop'),
      edge('loop', 'body', 'loop', 'loop-body-in'),
      edge('body', 'loop', 'loop-body-out', 'loop-back'),
      edge('loop', 'after', 'exit'),
      edge('after', 'long1'),
      edge('long1', 'long2'),
      edge('long2', 'join'),
      edge('after', 'join'),
    ]
    const order = getTopologicalOrder(nodes, edges)
    expect(order.indexOf('loop')).toBeLessThan(order.indexOf('body'))
    expect(order.indexOf('loop')).toBeLessThan(order.indexOf('after'))
    expect(order.indexOf('long2')).toBeLessThan(order.indexOf('join'))
  })
})

describe('getTopologicalOrder — staying on one side', () => {
  // fetch → gate ─true→ save → gate2 ─true→ email
  //              └false→ toast      └false→ reset
  // The false edges come first, so by step alone each refusal step runs
  // between two server steps of the main chain.
  const nodes = [
    node('fetch', 'data-raw-query', 1),
    node('gate', 'general-if-statement', 2),
    node('toast', 'toast-show', 3),
    node('save', 'data-create-item', 3),
    node('gate2', 'general-if-statement', 4),
    node('reset', 'state-update-local-state', 5),
    node('email', 'data-raw-query', 5),
  ]
  const edges: UIDLWorkflowEdge[] = [
    edge('fetch', 'gate'),
    edge('gate', 'toast', 'false'),
    edge('gate', 'save', 'true'),
    edge('save', 'gate2'),
    edge('gate2', 'reset', 'false'),
    edge('gate2', 'email', 'true'),
  ]

  it('orders by step alone without the splitter', () => {
    expect(getTopologicalOrder(nodes, edges)).toEqual([
      'fetch',
      'gate',
      'toast',
      'save',
      'gate2',
      'reset',
      'email',
    ])
  })

  it('lets the main chain stay on the server ahead of the refusal branches it never runs with', () => {
    expect(getTopologicalOrder(nodes, edges, sideOf)).toEqual([
      'fetch',
      'gate',
      'save',
      'gate2',
      'email',
      'toast',
      'reset',
    ])
  })

  it('keeps the order of steps that both run (a fan-out is not a branch)', () => {
    const fanOut = [
      node('fetch', 'data-raw-query', 1),
      node('notify', 'toast-show', 2),
      node('save', 'data-create-item', 2),
    ]
    const fanOutEdges: UIDLWorkflowEdge[] = [edge('fetch', 'notify'), edge('fetch', 'save')]
    expect(getTopologicalOrder(fanOut, fanOutEdges, sideOf)).toEqual(['fetch', 'notify', 'save'])
  })
})

describe('getNeverRunTogether', () => {
  it('pairs the nodes of different branches of one if-statement or switch, nothing else', () => {
    const nodes = [
      node('gate', 'general-if-statement', 1),
      node('a1', 'data-select', 2),
      node('a2', 'data-select', 3),
      node('b1', 'toast-show', 2),
      node('switch', 'general-switch', 4),
      node('c1', 'data-select', 5),
      node('c2', 'data-select', 5),
      node('loop', 'general-loop', 6),
      node('bodyGate', 'general-if-statement', 7),
      node('x', 'data-create-item', 8),
      node('y', 'toast-show', 8),
      node('z', 'data-select', 7),
    ]
    const edges: UIDLWorkflowEdge[] = [
      edge('gate', 'a1', 'true'),
      edge('a1', 'a2'),
      edge('gate', 'b1', 'false'),
      edge('a2', 'switch'),
      {
        id: 'switch->c1',
        source: 'switch',
        target: 'c1',
        sourceHandle: 'switch',
        data: { caseId: 'x' },
      },
      edge('switch', 'c2', 'default'),
      edge('c1', 'loop'),
      edge('loop', 'bodyGate', 'loop', 'loop-body-in'),
      edge('bodyGate', 'x', 'true'),
      edge('bodyGate', 'y', 'false'),
      edge('x', 'loop', 'loop-body-out', 'loop-back'),
      edge('loop', 'z', 'exit'),
    ]
    const neverRunTogether = getNeverRunTogether(nodes, edges)
    expect(neverRunTogether('a2', 'b1')).toBe(true)
    expect(neverRunTogether('b1', 'z')).toBe(true)
    expect(neverRunTogether('c1', 'c2')).toBe(true)
    expect(neverRunTogether('a1', 'a2')).toBe(false)
    expect(neverRunTogether('a1', 'c1')).toBe(false)
    // The back edge is not followed: the step after the loop is on neither
    // branch of the if-statement inside the loop body.
    expect(neverRunTogether('z', 'y')).toBe(false)
  })
})
