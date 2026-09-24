import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'

/**
 * `runBefore` rewrites every `navigation-go-to-page` node's `config.pageId`
 * from a UIDL page id to the real Next.js route. It used to walk only
 * `workflows.workflows`, so the same node inside a shared CUSTOM NODE reached
 * the generated `custom-nodes.js` still holding the raw page id.
 *
 * The runtime then fell through to `targetPage.staticUrl`, which is the
 * mapper's best guess: it is `/home` for the home page even though Next serves
 * it at `/`, and it keeps pointing at a page that has since been deleted. Both
 * end on a 404, and only when the navigation came from a custom node.
 */

const goToPage = (id: string, pageId: string, targetPage?: Record<string, unknown>) => ({
  id,
  type: 'navigation-go-to-page',
  config: { pageId, ...(targetPage ? { targetPage } : {}) },
})

const structure = (uidl: unknown): any => ({
  uidl,
  strategy: { pages: { options: {} } },
  files: new Map(),
  dependencies: {},
  devDependencies: {},
})

const projectUidl = (): any => ({
  name: 'Store',
  globals: { settings: { title: 'Store' }, env: {} },
  root: {
    name: 'Root',
    stateDefinitions: {
      route: {
        type: 'string',
        defaultValue: 'Home',
        values: [
          { value: 'Home', pageId: 'TQ_home' },
          { value: 'products-list', pageId: 'TQ_products', pageOptions: { navLink: '/menu' } },
          { value: '404 - Not Found', pageOptions: { fallback: true } },
        ],
      },
    },
    node: { type: 'element', content: { elementType: 'container', children: [] } },
  },
  components: {},
  workflows: {
    workflows: {
      wf1: {
        id: 'wf1',
        name: 'Go home',
        trigger: { type: 'event-element-clicked', scope: 'page', nodeId: 't1' },
        nodes: [goToPage('n1', 'TQ_home', { pageId: 'TQ_home', staticUrl: '/home' })],
        edges: [],
      },
    },
    customNodes: {
      cn1: {
        id: 'cn1',
        name: 'Require login',
        nodes: [
          goToPage('n2', 'TQ_home', { pageId: 'TQ_home', staticUrl: '/home' }),
          goToPage('n3', 'TQ_products', { pageId: 'TQ_products', staticUrl: '/products-list' }),
        ],
        edges: [],
      },
    },
  },
})

describe('runBefore — navigation-go-to-page page ids inside custom nodes', () => {
  it('rewrites custom-node page ids to the real route, like workflow nodes', async () => {
    const uidl = projectUidl()
    await new NextWorkflowProjectPlugin().runBefore(structure(uidl))

    const customNodes = uidl.workflows.customNodes.cn1.nodes
    // The home page's staticUrl is '/home', but Next serves it at '/'. Leaving
    // the raw id made the runtime prefer staticUrl and 404.
    expect(customNodes[0].config.pageId).toBe('/')
    expect(customNodes[1].config.pageId).toBe('/menu')
    // Unchanged behaviour for the workflow that already worked.
    expect(uidl.workflows.workflows.wf1.nodes[0].config.pageId).toBe('/')
  })

  // The reported scenario: every page was deleted while e-commerce stayed on,
  // so the route map is empty and the custom node still points at a page id
  // that resolves to nothing. It gets the same default-route treatment a
  // workflow node has always had, instead of shipping the raw id.
  it('sends a custom-node reference to a deleted page to the default route', async () => {
    const uidl = projectUidl()
    uidl.root.stateDefinitions.route = {
      type: 'string',
      defaultValue: '404 - Not Found',
      values: [{ value: '404 - Not Found', pageOptions: { fallback: true } }],
    }
    uidl.workflows.customNodes.cn1.nodes = [goToPage('n4', 'TQ_deleted')]
    await new NextWorkflowProjectPlugin().runBefore(structure(uidl))

    expect(uidl.workflows.customNodes.cn1.nodes[0].config.pageId).toBe('/')
  })

  it('does not throw for a project that has custom nodes but no workflows', async () => {
    const uidl = projectUidl()
    delete uidl.workflows.workflows
    await expect(new NextWorkflowProjectPlugin().runBefore(structure(uidl))).resolves.toBeDefined()
    expect(uidl.workflows.customNodes.cn1.nodes[0].config.pageId).toBe('/')
  })
})
