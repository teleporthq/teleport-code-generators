// An interval bound to a component runs INSIDE that component: its timer lives
// in the component's own effect, where the component's state setters are, and
// stops when the component is torn down. A page-scoped interval can do neither
// for a component — its writes to component state are skipped — which is why
// "switch the photo every 5 seconds" inside a component never worked.

import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'

const rotationWorkflow = (scope: 'component' | 'page', config: Record<string, unknown>) => ({
  id: 'wf-rotation',
  name: 'Photo Rotation',
  trigger: {
    type: 'event-interval',
    nodeId: 'trigger-interval',
    scope,
    config: { intervalMs: 5000, autoStart: true, ...config },
  },
  nodes: [
    {
      id: 'advance',
      type: 'state-update-local-state',
      config: { property: 'currentIndex', value: 1 },
      stepNumber: 1,
      label: 'Advance',
    },
  ],
  edges: [{ id: 'e1', source: 'trigger-interval', target: 'advance' }],
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

const getWorkflowModule = async (
  uidl: Record<string, unknown>,
  workflow: any,
  isPage: boolean
): Promise<string | null> => {
  const plugin = createNextWorkflowPlugin({ isPage })
  const structure: any = {
    uidl: {
      node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
      stateDefinitions: { currentIndex: { type: 'number', defaultValue: 0 } },
      ...uidl,
    },
    chunks: [jsxComponentChunk()],
    options: { workflows: { workflows: { [workflow.id]: workflow }, customNodes: {} } },
    dependencies: {},
  }
  await plugin(structure)
  const moduleChunk = structure.chunks.find((c: any) => c.name === 'workflow-module')
  return moduleChunk ? String(moduleChunk.content) : null
}

describe('an interval bound to a component', () => {
  const bound = { componentId: 'TQ_oneOfOne', componentName: 'One of One' }

  it('is generated into that component, with its timer and its teardown', async () => {
    const code = await getWorkflowModule(
      { name: 'OneOfOne' },
      rotationWorkflow('component', bound),
      false
    )

    expect(code).not.toBeNull()
    expect(code).toContain('Interval 5000ms')
    expect(code).toContain('__iv_start_wf_rotation();')
    expect(code).toContain('__iv_stop_wf_rotation();')
    // The component's own handler factory, the one given its state setters.
    expect(code).toContain('function __createWorkflowHandlers(stateSetters')
  })

  it('is generated into no page and no other component', async () => {
    const intoPage = await getWorkflowModule(
      { name: 'Home', outputOptions: { pageId: 'page-1', fileName: 'home' } },
      rotationWorkflow('component', bound),
      true
    )
    const intoOther = await getWorkflowModule(
      { name: 'Footer' },
      rotationWorkflow('component', bound),
      false
    )

    expect(intoPage).toBeNull()
    expect(intoOther).toBeNull()
  })

  it('leaves a page interval where it was: in its page, never in a component', async () => {
    const intoPage = await getWorkflowModule(
      { name: 'Home', outputOptions: { pageId: 'page-1', fileName: 'home' } },
      rotationWorkflow('page', { pageId: 'page-1' }),
      true
    )
    const intoComponent = await getWorkflowModule(
      { name: 'OneOfOne' },
      rotationWorkflow('page', { pageId: 'page-1' }),
      false
    )

    expect(intoPage).toContain('Interval 5000ms')
    expect(intoComponent).toBeNull()
  })
})
