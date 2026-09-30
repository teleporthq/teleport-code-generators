import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'

// Every server segment descriptor a page, a custom node runner or a global
// workflow ships carries `stateKeys`: the page state the segment (and the
// custom nodes it calls) can read. The client runtime prunes the request to
// it. A client segment carries none — it never leaves the browser.

const TRIGGER_ID = 'trigger-1'

const buildWorkflow = (): any => ({
  id: 'wf-1',
  name: 'Country Load',
  trigger: {
    type: 'event-page-loaded',
    nodeId: TRIGGER_ID,
    scope: 'page',
    config: { pageId: 'page-1' },
  },
  nodes: [
    {
      id: 'call',
      type: 'general-custom-node',
      config: { customNodeId: 'cn-resolve', parameters: [] },
      executionEnv: 'client',
      stepNumber: 1,
      label: 'Resolve',
    },
    {
      id: 'query',
      type: 'data-raw-query',
      config: {
        dataSourceId: 'ds',
        query: 'SELECT 1',
        params: [
          '{{state.countryCode}}',
          { type: 'workflowContext', nodeId: 'call', path: ['call', 'id'] },
        ],
      },
      executionEnv: 'server',
      stepNumber: 2,
      label: 'Query',
    },
    {
      id: 'write',
      type: 'state-update-local-state',
      config: {
        property: 'rows',
        value: { type: 'workflowContext', nodeId: 'query', path: ['query', 'rows'] },
      },
      executionEnv: 'client',
      stepNumber: 3,
      label: 'Write',
    },
  ],
  edges: [
    { id: 'e1', source: TRIGGER_ID, target: 'call' },
    { id: 'e2', source: 'call', target: 'query' },
    { id: 'e3', source: 'query', target: 'write' },
  ],
})

const customNodes: Record<string, any> = {
  'cn-resolve': {
    id: 'cn-resolve',
    name: 'Resolve',
    parameters: [],
    nodes: [
      {
        id: 'inner-query',
        type: 'data-raw-query',
        label: 'Inner',
        config: { dataSourceId: 'ds', query: 'SELECT 1', params: ['{{Current User.id}}'] },
        executionEnv: 'server',
        stepNumber: 0,
      },
    ],
    edges: [],
  },
}

const buildStructure = (workflow: any): any => ({
  uidl: {
    name: 'Page',
    outputOptions: { pageId: 'page-1', fileName: 'page-1' },
    node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
    stateDefinitions: { rows: { type: 'array', defaultValue: [] } },
  },
  chunks: [
    {
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
    },
  ],
  options: { workflows: { workflows: { 'wf-1': workflow }, customNodes } },
  dependencies: {},
})

const pageModuleCode = async (workflow: any): Promise<string> => {
  const structure = buildStructure(workflow)
  await createNextWorkflowPlugin({ isPage: true })(structure)
  const chunk = (structure.chunks as any[]).find((c: any) => c.name === 'workflow-module')
  if (!chunk) {
    throw new Error('workflow-module chunk not emitted')
  }
  return String(chunk.content)
}

const segmentDescriptors = (code: string): Array<Record<string, unknown>> => {
  const match = code.match(/segments:\s*(\[[\s\S]*?\]),\n\s*nodes:/)
  if (!match) {
    throw new Error('segments literal not found')
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`return ${match[1]};`)() as Array<Record<string, unknown>>
}

describe('server segment descriptors carry the page state they read', () => {
  it('a page workflow: the segment names its own tokens and those of the custom node it calls', async () => {
    const segments = segmentDescriptors(await pageModuleCode(buildWorkflow()))
    const server = segments.filter((s) => s.env === 'server')
    const client = segments.filter((s) => s.env === 'client')
    expect(server).toHaveLength(1)
    expect(server[0].stateKeys).toEqual(['countryCode'])
    expect(client.length).toBeGreaterThan(0)
    for (const seg of client) {
      expect(seg).not.toHaveProperty('stateKeys')
    }
  })

  it('a page workflow whose server segment calls the custom node carries what the node reads', async () => {
    const workflow = buildWorkflow()
    // Move the call next to the query: the call node's env is decided by its
    // handler, so make it a server-side custom-js that names the custom node
    // through a nested config the walk still reaches.
    workflow.nodes[1].config.params.push({
      type: 'workflowContext',
      nodeId: 'call',
      path: ['call', '__stateValues', 'cartId'],
    })
    const segments = segmentDescriptors(await pageModuleCode(workflow))
    const server = segments.find((s) => s.env === 'server') as Record<string, unknown>
    expect(server.stateKeys).toEqual(['cartId', 'countryCode'])
  })

  it('a custom node runner: each inner server segment names what it reads', () => {
    const plugin = new NextWorkflowProjectPlugin() as unknown as {
      generateCustomNodesFile: (
        nodes: Record<string, unknown>,
        urls: Record<string, Record<string, string>>
      ) => string
    }
    const source = plugin.generateCustomNodesFile(customNodes, {
      'cn-resolve': { 'server-1': '/api/workflows/resolve-seg-1' },
    })
    expect(source).toContain('"stateKeys":["currentUser"]')
  })

  it('a global workflow: its server segments name what they read', () => {
    const plugin = new NextWorkflowProjectPlugin() as unknown as {
      generateGlobalWorkflowsHook: (workflows: unknown[], nodes: Record<string, unknown>) => string
    }
    const workflow = buildWorkflow()
    workflow.trigger = {
      type: 'event-custom-triggered',
      nodeId: TRIGGER_ID,
      scope: 'global',
      config: { eventName: 'ping' },
    }
    const source = plugin.generateGlobalWorkflowsHook([workflow], customNodes)
    expect(source).toContain('"stateKeys":["countryCode"]')
  })
})
