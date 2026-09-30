import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'
import { generateCronAPIRoute, generateWebhookWorkflowAPIRoute } from '../src/api-route-generator'
import { generateSharedRuntimeUtilsCode } from '../src'

/**
 * Every custom node used to land in `utils/workflows/custom-nodes.js`, which
 * every page or component calling ANY custom node imports. The admin's
 * "Admin Product Options" node (~110 KB of option-editor code) therefore
 * shipped to every storefront page with an add-to-cart button, on every
 * e-commerce store with a generated admin, options or not.
 *
 * A node marked `clientModule: 'admin'` now goes to `custom-nodes-admin.js`,
 * which only the pages whose workflows call it import. A project without
 * marked nodes is generated exactly as before.
 */

const script = (marker: string) =>
  `function customHandler(previousContext, params) { var __opeAct_${marker} = 1; return { ran: "${marker}" }; }`

const customJsNode = (id: string, marker: string) => ({
  id,
  type: 'general-custom-js',
  label: id,
  config: { code: script(marker), context: 'client' },
  executionEnv: 'client',
  stepNumber: 0,
})

const callNode = (id: string, customNodeId: string) => ({
  id,
  type: 'general-custom-node',
  label: id,
  config: { customNodeId, parameters: [] as unknown[] },
  stepNumber: 1,
})

const buildCustomNodes = (): Record<string, any> => ({
  'cn-shared': {
    id: 'cn-shared',
    name: 'Add Product To Cart Logic',
    parameters: [],
    nodes: [
      {
        id: 'shared-step',
        type: 'general-custom-js',
        label: 'Shared',
        config: {
          code: 'function customHandler(p, q) { return { ran: "shared-only" }; }',
          context: 'client',
        },
        executionEnv: 'client',
        stepNumber: 0,
      },
    ],
    edges: [],
  },
  'cn-admin': {
    id: 'cn-admin',
    name: 'Admin Product Options',
    clientModule: 'admin',
    parameters: [],
    nodes: [customJsNode('admin-step', 'admin')],
    edges: [],
  },
})

const pageWorkflow = (id: string, customNodeId: string) => ({
  id,
  name: id,
  trigger: {
    type: 'event-page-loaded',
    scope: 'page',
    nodeId: `${id}-t`,
    config: { pageId: 'page-1' },
  },
  nodes: [callNode(`${id}-call`, customNodeId)],
  edges: [{ id: `${id}-e`, source: `${id}-t`, target: `${id}-call` }],
  usedInNodes: {},
})

const projectStructure = (customNodes: Record<string, any>): any => ({
  uidl: {
    name: 'Store',
    globals: { settings: { title: 'Store', language: 'en' }, env: {} },
    root: {
      name: 'Root',
      stateDefinitions: {
        route: { type: 'string', defaultValue: 'Home', values: [{ value: 'Home' }] },
      },
      node: { type: 'element', content: { elementType: 'container', children: [] } },
    },
    components: {},
    workflows: {
      workflows: { 'wf-cart': pageWorkflow('wf-cart', 'cn-shared') },
      customNodes,
    },
  },
  strategy: { pages: { options: {} } },
  files: new Map(),
  dependencies: {},
  devDependencies: {},
})

const generatedFiles = async (customNodes: Record<string, any>) => {
  const structure = projectStructure(customNodes)
  await new NextWorkflowProjectPlugin().runAfter(structure)
  const fileContent = (key: string): string | undefined => {
    const entry = structure.files.get(key)
    return entry ? String(entry.files[0].content) : undefined
  }
  const adminEntry = structure.files.get('workflow-custom-nodes-admin')
  return {
    shared: fileContent('workflow-custom-nodes') as string,
    admin: fileContent('workflow-custom-nodes-admin'),
    adminName: adminEntry ? adminEntry.files[0].name : undefined,
  }
}

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

const generatePage = async (workflow: any, customNodes: Record<string, any>) => {
  const structure: any = {
    uidl: {
      name: 'Page',
      outputOptions: { pageId: 'page-1', fileName: 'page-1', folderPath: [] },
      node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
      stateDefinitions: {},
    },
    chunks: [jsxComponentChunk()],
    options: { workflows: { workflows: { [workflow.id]: workflow }, customNodes } },
    dependencies: {},
  }
  await createNextWorkflowPlugin({ isPage: true })(structure)
  const chunk = (structure.chunks as any[]).find((c: any) => c.name === 'workflow-module')
  return {
    dependencies: structure.dependencies as Record<string, { path: string }>,
    code: chunk ? String(chunk.content) : '',
  }
}

/** Evaluates the generated modules the way webpack / Node would link them. */
const bootModules = (sources: Record<string, string>) => {
  const utils: { exports: Record<string, unknown> } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', generateSharedRuntimeUtilsCode())(utils, utils.exports)
  const cache: Record<string, Record<string, unknown>> = {}
  const load = (id: string): Record<string, unknown> => {
    if (id === './runtime-utils') {
      return utils.exports
    }
    if (!cache[id]) {
      const mod: { exports: Record<string, unknown> } = { exports: {} }
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      new Function('module', 'exports', 'require', sources[id])(mod, mod.exports, load)
      cache[id] = mod.exports
    }
    return cache[id]
  }
  return load
}

const handlers = {
  'general-custom-js': async (config: { code?: string }) => {
    const match = /ran: "([^"]+)"/.exec((config && config.code) || '')
    return { ran: match ? match[1] : 'unknown' }
  },
  'general-custom-node': async (config: { customNodeId?: string }) => ({
    __customNode: true,
    customNodeId: config.customNodeId,
    parameters: {},
  }),
}

describe('custom nodes only the admin calls get their own client module', () => {
  it('keeps a marked node out of the shared custom-nodes.js and emits it in custom-nodes-admin.js', async () => {
    const files = await generatedFiles(buildCustomNodes())

    expect(files.shared).not.toContain('__opeAct_')
    expect(files.shared).not.toContain("__customNodeRegistry['cn-admin']")
    expect(files.shared).toContain("__customNodeRegistry['cn-shared']")

    expect(files.adminName).toBe('custom-nodes-admin')
    expect(files.admin).toContain('__opeAct_admin')
    expect(files.admin).toContain("__customNodeRegistry['cn-admin']")
    expect(files.admin).not.toContain("__customNodeRegistry['cn-shared'] =")
  })

  it('an admin node that calls a shared node still resolves it through the merged registry', async () => {
    const customNodes = buildCustomNodes()
    customNodes['cn-admin'].nodes = [callNode('admin-calls-shared', 'cn-shared')]
    const files = await generatedFiles(customNodes)
    const load = bootModules({
      './custom-nodes': files.shared,
      './custom-nodes-admin': files.admin as string,
    })

    const admin = load('./custom-nodes-admin') as Record<string, any>
    expect(Object.keys(admin).sort()).toEqual(['cn-admin', 'cn-shared'])
    expect(Object.keys(load('./custom-nodes'))).toEqual(['cn-shared'])
    await expect(admin['cn-admin']({}, {}, handlers)).resolves.toEqual({ ran: 'shared-only' })
  })

  it('a marked node that a shared node calls stays in the shared module', async () => {
    const customNodes = buildCustomNodes()
    customNodes['cn-shared'].nodes = [callNode('shared-calls-admin', 'cn-admin')]
    const files = await generatedFiles(customNodes)

    expect(files.admin).toBeUndefined()
    expect(files.shared).toContain("__customNodeRegistry['cn-admin']")
    const load = bootModules({ './custom-nodes': files.shared })
    const shared = load('./custom-nodes') as Record<string, any>
    await expect(shared['cn-shared']({}, {}, handlers)).resolves.toEqual({ ran: 'admin' })
  })

  it('a project without marked nodes gets the one shared module it always had', async () => {
    const customNodes = buildCustomNodes()
    delete customNodes['cn-admin'].clientModule
    const files = await generatedFiles(customNodes)

    expect(files.admin).toBeUndefined()
    const plugin = new NextWorkflowProjectPlugin() as unknown as {
      generateCustomNodesFile: (
        nodes: Record<string, unknown>,
        urls: Record<string, Record<string, string>>
      ) => string
    }
    expect(files.shared).toBe(plugin.generateCustomNodesFile(customNodes, {}))
    expect(files.shared).toContain("__customNodeRegistry['cn-admin']")
    expect(files.shared).toContain('var __customNodeRegistry = {};')
    expect(files.shared).not.toContain('custom-nodes-admin')
  })

  it('only the page that calls a marked node imports the admin module', async () => {
    const customNodes = buildCustomNodes()

    const storefront = await generatePage(pageWorkflow('wf-cart', 'cn-shared'), customNodes)
    expect(storefront.dependencies.workflowCustomNodes.path).toBe('../utils/workflows/custom-nodes')
    expect(storefront.dependencies).not.toHaveProperty('workflowCustomNodesAdmin')
    expect(storefront.code).not.toContain('workflowCustomNodesAdmin')
    expect(storefront.code).toContain('{ customNodes: workflowCustomNodes }')

    const admin = await generatePage(pageWorkflow('wf-options', 'cn-admin'), customNodes)
    expect(admin.dependencies.workflowCustomNodes.path).toBe('../utils/workflows/custom-nodes')
    expect(admin.dependencies.workflowCustomNodesAdmin.path).toBe(
      '../utils/workflows/custom-nodes-admin'
    )
    expect(admin.code).toContain(
      '{ customNodes: Object.assign({}, workflowCustomNodes, workflowCustomNodesAdmin) }'
    )
  })

  it('a page reaching a marked node through another marked node imports the admin module', async () => {
    const customNodes = buildCustomNodes()
    customNodes['cn-admin-outer'] = {
      id: 'cn-admin-outer',
      name: 'Admin Outer',
      clientModule: 'admin',
      parameters: [],
      nodes: [callNode('outer-calls-admin', 'cn-admin')],
      edges: [],
    }
    const page = await generatePage(pageWorkflow('wf-outer', 'cn-admin-outer'), customNodes)
    expect(page.dependencies.workflowCustomNodesAdmin.path).toBe(
      '../utils/workflows/custom-nodes-admin'
    )
  })

  it('a server route that calls a marked node also requires the admin module', () => {
    const customNodes = buildCustomNodes()
    const cron = (customNodeId: string) =>
      generateCronAPIRoute(
        {
          ...pageWorkflow('wf-cron', customNodeId),
          trigger: { type: 'event-cron', nodeId: 'wf-cron-t', config: { schedule: '0 * * * *' } },
        } as any,
        customNodes
      )
    expect(cron('cn-shared')).toContain("require('../../../utils/workflows/custom-nodes')")
    expect(cron('cn-shared')).not.toContain('custom-nodes-admin')
    expect(cron('cn-admin')).toContain(
      "__customNodes = Object.assign({}, __customNodes, require('../../../utils/workflows/custom-nodes-admin'))"
    )

    const webhook = generateWebhookWorkflowAPIRoute(
      {
        ...pageWorkflow('wf-hook', 'cn-admin'),
        trigger: { type: 'event-webhook-received', nodeId: 'wf-hook-t', config: {} },
        webhookConfig: { urlPath: 'hooks/options', httpMethod: 'POST' },
      } as any,
      customNodes
    )
    expect(webhook).toMatch(/require\('(\.\.\/)+\.\.\/utils\/workflows\/custom-nodes-admin'\)/)
  })
})
