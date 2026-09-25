import { ALL_STATE_KEYS, collectSegmentStateKeys } from '../src/segment-context-needs'
import type { UIDLCustomWorkflowNode, UIDLWorkflowNode } from '@teleporthq/teleport-types'

// The page state a server segment may read is decided at generation time from
// the ways a server node can reach `__stateValues`. These pin each way, and
// that a custom-JS node — whose handler never exposes the bag — adds nothing.

const node = (id: string, type: string, config: Record<string, unknown>): UIDLWorkflowNode =>
  ({ id, type, config, stepNumber: 1, label: id } as unknown as UIDLWorkflowNode)

const ref = (nodeId: string, path: string[]) => ({ type: 'workflowContext', nodeId, path })

describe('collectSegmentStateKeys', () => {
  it('names nothing for nodes that read no page state', () => {
    const nodes = [
      node('q', 'data-raw-query', {
        query: 'SELECT 1',
        params: [ref('trigger', ['trigger', 'formData', 'email'])],
      }),
      node('js', 'general-custom-js', {
        code: 'function customHandler(params) { return { state: params[0] } }',
      }),
    ]
    expect(collectSegmentStateKeys(nodes, {})).toEqual([])
  })

  it('reads the state a whole-string template token names, wherever it sits in the config', () => {
    const nodes = [
      node('q', 'data-raw-query', {
        query: 'SELECT 1',
        params: ['{{state.countryCode}}', { nested: { deeper: '{{ state.cart.items }}' } }],
      }),
    ]
    expect(collectSegmentStateKeys(nodes, {})).toEqual(['cart', 'countryCode'])
  })

  it('reads currentUser for the {{Current User.id}} tokens', () => {
    expect(
      collectSegmentStateKeys([node('q', 'data-select', { filters: ['{{Current User.id}}'] })], {})
    ).toEqual(['currentUser'])
    expect(
      collectSegmentStateKeys([node('q', 'data-select', { filters: ['{{ currentUser.id }}'] })], {})
    ).toEqual(['currentUser'])
  })

  it('reads the state a context reference walks into through the bag', () => {
    const nodes = [
      node('q', 'data-select', {
        filters: [{ field: 'id', value: ref('trigger', ['trigger', '__stateValues', 'orderId']) }],
      }),
    ]
    expect(collectSegmentStateKeys(nodes, {})).toEqual(['orderId'])
  })

  it('keeps the whole bag for a reference that stops at the bag', () => {
    const nodes = [
      node('q', 'data-select', { value: ref('trigger', ['trigger', '__stateValues']) }),
    ]
    expect(collectSegmentStateKeys(nodes, {})).toBe(ALL_STATE_KEYS)
  })

  it('keeps the whole bag for an expression that may read it', () => {
    const nodes = [
      node('gate', 'general-if-statement', {
        conditionType: 'expression',
        condition: 'context.__stateValues.total > 10',
      }),
    ]
    expect(collectSegmentStateKeys(nodes, {})).toBe(ALL_STATE_KEYS)
  })

  it('follows a custom node call into its inner nodes, once, cycles included', () => {
    const customNodes: Record<string, UIDLCustomWorkflowNode> = {
      'cn-a': {
        id: 'cn-a',
        name: 'A',
        nodes: [
          node('inner', 'data-raw-query', { query: 'SELECT 1', params: ['{{state.locale}}'] }),
          node('again', 'general-custom-node', { customNodeId: 'cn-b' }),
        ],
        edges: [],
      } as unknown as UIDLCustomWorkflowNode,
      'cn-b': {
        id: 'cn-b',
        name: 'B',
        nodes: [
          node('back', 'general-custom-node', { customNodeId: 'cn-a' }),
          node('deep', 'data-raw-query', { query: 'SELECT 1', params: ['{{state.currency}}'] }),
        ],
        edges: [],
      } as unknown as UIDLCustomWorkflowNode,
    }
    const nodes = [node('call', 'general-custom-node', { customNodeId: 'cn-a', parameters: [] })]
    expect(collectSegmentStateKeys(nodes, customNodes)).toEqual(['currency', 'locale'])
  })

  it('ignores a custom node the index does not hold', () => {
    const nodes = [node('call', 'general-custom-node', { customNodeId: 'missing' })]
    expect(collectSegmentStateKeys(nodes, {})).toEqual([])
    expect(collectSegmentStateKeys(nodes, undefined)).toEqual([])
  })
})
