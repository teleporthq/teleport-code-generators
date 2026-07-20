// `event-page-loaded` scoping guard: a page-loaded workflow with NO page
// scoping (no pageId, no selectedPages, no allPages) must be SKIPPED, not
// injected into every page. Silent all-pages fan-out masked mis-scoped
// workflows whose state target lives in a component (the setter no-ops on
// pages). Explicit `allPages: true` is the supported way to run everywhere.

import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'

const pageLoadedWorkflow = (config: Record<string, unknown>) => ({
  id: 'wf-page-loaded',
  name: 'Page Init',
  trigger: {
    type: 'event-page-loaded',
    nodeId: 'trigger-page-loaded',
    scope: 'page',
    config,
  },
  nodes: [
    {
      id: 'update-1',
      type: 'state-update-local-state',
      config: { property: 'ready', value: 'true' },
      stepNumber: 1,
      label: 'Set ready',
    },
  ],
  edges: [{ id: 'e1', source: 'trigger-page-loaded', target: 'update-1' }],
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

const getWorkflowModule = async (workflow: any, pageId: string): Promise<string | null> => {
  const plugin = createNextWorkflowPlugin({ isPage: true })
  const structure: any = {
    uidl: {
      name: 'Page',
      outputOptions: { pageId, fileName: pageId },
      node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
      stateDefinitions: { ready: { type: 'string', defaultValue: '' } },
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

describe('event-page-loaded scoping', () => {
  it('SKIPS a workflow with no page scoping at all (empty config)', async () => {
    const code = await getWorkflowModule(pageLoadedWorkflow({}), 'page-1')
    expect(code).toBeNull()
  })

  it('generates into every page when allPages is true', async () => {
    const codeA = await getWorkflowModule(pageLoadedWorkflow({ allPages: true }), 'page-1')
    const codeB = await getWorkflowModule(pageLoadedWorkflow({ allPages: true }), 'page-2')
    expect(codeA).toContain('Page loaded')
    expect(codeB).toContain('Page loaded')
  })

  it('generates only into the matching page when pageId is set', async () => {
    const match = await getWorkflowModule(pageLoadedWorkflow({ pageId: 'page-1' }), 'page-1')
    const mismatch = await getWorkflowModule(pageLoadedWorkflow({ pageId: 'page-1' }), 'page-2')
    expect(match).toContain('Page loaded')
    expect(mismatch).toBeNull()
  })

  it('generates into pages listed in selectedPages', async () => {
    const config = { selectedPages: [{ id: 'page-1' }, { id: 'page-3' }] }
    const inList = await getWorkflowModule(pageLoadedWorkflow(config), 'page-3')
    const notInList = await getWorkflowModule(pageLoadedWorkflow(config), 'page-2')
    expect(inList).toContain('Page loaded')
    expect(notInList).toBeNull()
  })
})
