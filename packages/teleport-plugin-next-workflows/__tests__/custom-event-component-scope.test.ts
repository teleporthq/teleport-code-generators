// A custom-event workflow bound to a component must be emitted INTO that
// component, not into the global workflow module.
//
// This is what makes the AI chat's dictation work: the transcript arrives as a
// custom event, and the workflow that consumes it writes `chatInputValue` — a
// component-local state. A global workflow is emitted into a module that owns no
// state setters, so that write would warn and no-op, and the field would never
// fill in. The routing below is the guarantee that cannot happen.

import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'

const customEventWorkflow = (config: Record<string, unknown>, scope: string) => ({
  id: 'wf-dictation-result',
  name: 'Insert Dictated Chat Text',
  trigger: {
    type: 'event-custom-triggered',
    nodeId: 'trigger-custom-event',
    scope,
    config,
  },
  nodes: [
    {
      id: 'update-1',
      type: 'state-update-local-state',
      config: {
        property: 'chatInputValue',
        value: {
          type: 'workflowContext',
          nodeId: 'trigger-custom-event',
          path: ['trigger-custom-event', 'eventData', 'text'],
        },
      },
      stepNumber: 1,
      label: 'Store Dictated Text',
    },
  ],
  edges: [{ id: 'e1', source: 'trigger-custom-event', target: 'update-1' }],
})

// `any` because the chunk is a hand-written Babel AST fragment, not a value
// produced by @babel/types' builders.
const jsxComponentChunk = (): any => ({
  type: 'chunk-type-ast',
  name: 'jsx-component',
  content: {
    type: 'VariableDeclaration',
    declarations: [
      {
        type: 'VariableDeclarator',
        init: {
          type: 'ArrowFunctionExpression',
          body: { type: 'BlockStatement', body: [{ type: 'ReturnStatement', argument: null }] },
        },
      },
    ],
  },
})

const getWorkflowModule = async (
  uidl: Record<string, unknown>,
  workflow: any,
  isPage: boolean
): Promise<string | null> => {
  const plugin = createNextWorkflowPlugin({ isPage })
  const structure: any = {
    uidl: {
      node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
      stateDefinitions: { chatInputValue: { type: 'string', defaultValue: '' } },
      ...uidl,
    },
    chunks: [jsxComponentChunk()],
    options: {
      workflows: { workflows: { [workflow.id]: workflow }, customNodes: {} },
    },
    dependencies: {},
  }
  await plugin(structure)
  const moduleChunk = (structure.chunks as any[]).find((c: any) => c.name === 'workflow-module')
  return moduleChunk ? String(moduleChunk.content) : null
}

describe('component-scoped custom-event workflows', () => {
  it('registers the listener inside the component it is bound to', async () => {
    const code = await getWorkflowModule(
      { name: 'ai-assistant-chat' },
      customEventWorkflow(
        {
          eventName: 'ai-chat-dictation-result',
          componentId: 'TQ_chat',
          componentName: 'ai-assistant-chat',
        },
        'component'
      ),
      false
    )
    expect(code).not.toBeNull()
    expect(code).toContain('workflow:custom:ai-chat-dictation-result')
    // Registered on mount and torn down on unmount, like every other
    // component-scoped listener.
    expect(code).toContain('removeEventListener')
  })

  it('does NOT leak into an unrelated component', async () => {
    const code = await getWorkflowModule(
      { name: 'Footer' },
      customEventWorkflow(
        {
          eventName: 'ai-chat-dictation-result',
          componentId: 'TQ_chat',
          componentName: 'ai-assistant-chat',
        },
        'component'
      ),
      false
    )
    expect(code).toBeNull()
  })

  it('does NOT leak into pages', async () => {
    const code = await getWorkflowModule(
      { name: 'ai-assistant-chat', outputOptions: { pageId: 'page-1', fileName: 'home' } },
      customEventWorkflow(
        {
          eventName: 'ai-chat-dictation-result',
          componentId: 'TQ_chat',
          componentName: 'ai-assistant-chat',
        },
        'component'
      ),
      true
    )
    expect(code).toBeNull()
  })

  it('leaves an unbound (global-scoped) custom-event workflow out of the component', async () => {
    const code = await getWorkflowModule(
      { name: 'ai-assistant-chat' },
      customEventWorkflow({ eventName: 'order-placed' }, 'global'),
      false
    )
    expect(code).toBeNull()
  })
})
