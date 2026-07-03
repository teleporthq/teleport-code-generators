import { getTopologicalOrder, collectWorkflowContextNodeIds } from '../src/graph-utils'
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
    expect([...out].sort()).toEqual(['get-title', 'get-type'])
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
