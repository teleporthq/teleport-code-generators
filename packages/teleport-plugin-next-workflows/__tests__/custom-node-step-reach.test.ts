import { customNodeStepReach } from '../src/public-step-guards'

// The reach the publish judges one custom node's push and file steps by,
// exported for the editor's workflow agents: its own policy, or — server-only —
// its least-guarded caller's, a calling custom node included.

const serverOnly = { requiresAuth: false, allowedRoles: [] as string[], serverOnly: true }
const call = (id: string, customNodeId: string) => ({
  id,
  type: 'general-custom-node',
  config: { customNodeId },
})
const automation = {
  name: 'Paid',
  trigger: { type: 'event-business-event' },
  nodes: [call('a', 'push_node')],
}

describe('customNodeStepReach', () => {
  it('is server code when only an automation calls a server-only node', () => {
    expect(
      customNodeStepReach(
        {
          workflows: { auto: automation },
          customNodes: { push_node: { name: 'Push', nodes: [], protection: serverOnly } },
        },
        'push_node'
      )
    ).toEqual({ access: 'server' })
  })

  it('counts a calling custom node by its own policy, even one no workflow reaches', () => {
    expect(
      customNodeStepReach(
        {
          workflows: { auto: automation },
          customNodes: {
            push_node: { name: 'Push', nodes: [], protection: serverOnly },
            orphan: { name: 'Orphan Copy', nodes: [call('o', 'push_node')] },
          },
        },
        'push_node'
      )
    ).toEqual({ access: 'public' })
  })

  it("answers a node's own gate, with the roles a session admits", () => {
    expect(
      customNodeStepReach(
        {
          customNodes: {
            members: {
              name: 'Members',
              nodes: [],
              protection: { requiresAuth: true, allowedRoles: ['member'] },
            },
          },
        },
        'members'
      )
    ).toEqual({ access: 'session', admits: ['member'] })
  })
})
