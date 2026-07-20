// Routing guard for the `'component'` trigger scope: an `event-component-loaded`
// workflow must be generated ONLY into the component it is bound to (matched by
// the emitted component name, with a normalized-compare and componentId
// fallback) — never into pages, never into unrelated components. This is the
// fix for the original bug where a component workflow authored with page scope
// was stripped from the component and silently fanned out to every page.

import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'

const componentLoadedWorkflow = (config: Record<string, unknown>) => ({
  id: 'wf-comp-loaded',
  name: 'Auto-open Sidebar Group',
  trigger: {
    type: 'event-component-loaded',
    nodeId: 'trigger-component-loaded',
    scope: 'component',
    config,
  },
  nodes: [
    {
      id: 'update-1',
      type: 'state-update-local-state',
      config: { property: 'sidebarGroupOpen', value: 'guilds' },
      stepNumber: 1,
      label: 'Set group',
    },
  ],
  edges: [{ id: 'e1', source: 'trigger-component-loaded', target: 'update-1' }],
})

const jsxComponentChunk = () => ({
  type: 'chunk-type-ast',
  name: 'jsx-component',
  content: {
    type: 'VariableDeclaration',
    declarations: [
      {
        type: 'VariableDeclarator',
        init: {
          type: 'ArrowFunctionExpression',
          body: {
            type: 'BlockStatement',
            body: [{ type: 'ReturnStatement', argument: null }],
          },
        },
      },
    ],
  },
})

const buildStructure = (uidl: Record<string, unknown>, workflow: any): any => ({
  uidl: {
    node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
    stateDefinitions: { sidebarGroupOpen: { type: 'string', defaultValue: '' } },
    ...uidl,
  },
  chunks: [jsxComponentChunk()],
  options: {
    workflows: { workflows: { [workflow.id]: workflow }, customNodes: {} },
  },
  dependencies: {},
})

const getWorkflowModule = async (
  uidl: Record<string, unknown>,
  workflow: any,
  isPage: boolean
): Promise<string | null> => {
  const plugin = createNextWorkflowPlugin({ isPage })
  const structure = buildStructure(uidl, workflow)
  await plugin(structure as any)
  const moduleChunk = (structure.chunks as any[]).find((c: any) => c.name === 'workflow-module')
  return moduleChunk ? String(moduleChunk.content) : null
}

describe('component-scope trigger routing', () => {
  it('generates the workflow into the component matching componentName', async () => {
    const code = await getWorkflowModule(
      { name: 'Navigation' },
      componentLoadedWorkflow({ componentId: 'TQ_QmitTH632i', componentName: 'Navigation' }),
      false
    )
    expect(code).not.toBeNull()
    expect(code).toContain('Component loaded')
    expect(code).toContain("componentName: 'Navigation'")
  })

  it('matches case/separator-insensitively (generator may re-case the name)', async () => {
    const code = await getWorkflowModule(
      { name: 'CookieConsent' },
      componentLoadedWorkflow({ componentName: 'Cookie Consent' }),
      false
    )
    expect(code).not.toBeNull()
    expect(code).toContain('Component loaded')
  })

  it('falls back to componentId when the name does not match', async () => {
    const code = await getWorkflowModule(
      { name: 'Navigation', outputOptions: { fileName: 'navigation' } },
      componentLoadedWorkflow({ componentId: 'navigation', componentName: 'Renamed Later' }),
      false
    )
    expect(code).not.toBeNull()
    expect(code).toContain('Component loaded')
  })

  it('does NOT generate into an unrelated component', async () => {
    const code = await getWorkflowModule(
      { name: 'Footer' },
      componentLoadedWorkflow({ componentId: 'TQ_QmitTH632i', componentName: 'Navigation' }),
      false
    )
    expect(code).toBeNull()
  })

  it('does NOT generate into pages', async () => {
    const code = await getWorkflowModule(
      { name: 'Navigation', outputOptions: { pageId: 'page-1', fileName: 'home' } },
      componentLoadedWorkflow({ componentId: 'TQ_QmitTH632i', componentName: 'Navigation' }),
      true
    )
    expect(code).toBeNull()
  })

  it('matches nothing when both componentId and componentName are missing', async () => {
    const code = await getWorkflowModule({ name: 'Navigation' }, componentLoadedWorkflow({}), false)
    expect(code).toBeNull()
  })
})
