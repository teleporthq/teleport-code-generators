// A page keeps its instance when a navigation lands on the page already on
// screen (a link to the current URL, another record of the same dynamic route,
// another query string), so a trigger that fires when the page appears —
// page-loaded, element-visible, component-loaded — ran only on the first
// arrival. Such pages are wrapped in `remountOnPageArrival`, which starts them
// fresh on every arrival; pages whose workflows only answer interactions keep
// their plain export.

import generator from '@babel/generator'
import * as types from '@babel/types'
import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'

const PAGE_ID = 'page-dashboard'
const ROOT_ID = 'thq_container_root'

const workflow = (type: string, scope: string, config: Record<string, unknown>) => ({
  id: `wf-${type}`,
  name: type,
  trigger: { type, nodeId: 'trigger-1', scope, config },
  nodes: [
    {
      id: 'update-1',
      type: 'state-update-local-state',
      config: { property: 'isLoading', value: false },
      stepNumber: 1,
      label: 'Update',
    },
  ],
  edges: [{ id: 'e1', source: 'trigger-1', target: 'update-1' }],
})

const jsxComponentChunk = (rootId: string) => ({
  type: 'AST',
  name: 'jsx-component',
  content: types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('Dashboard'),
      types.arrowFunctionExpression(
        [types.identifier('props')],
        types.blockStatement([
          types.returnStatement(
            types.jsxElement(
              types.jsxOpeningElement(types.jsxIdentifier('div'), [
                types.jsxAttribute(types.jsxIdentifier('id'), types.stringLiteral(rootId)),
              ]),
              types.jsxClosingElement(types.jsxIdentifier('div')),
              []
            )
          ),
        ])
      )
    ),
  ]),
})

interface RunOptions {
  isPage?: boolean
  rootId?: string
  pageNode?: unknown
  projectComponents?: Record<string, unknown>
}

const run = async (
  workflows: Array<ReturnType<typeof workflow>>,
  {
    isPage = true,
    rootId = ROOT_ID,
    pageNode = { type: 'element', content: { elementType: 'container' } },
    projectComponents,
  }: RunOptions = {}
) => {
  const structure: any = {
    uidl: {
      name: 'Dashboard',
      node: pageNode,
      stateDefinitions: { isLoading: { type: 'boolean', defaultValue: true } },
      outputOptions: { pageId: PAGE_ID, folderPath: [] },
    },
    chunks: [
      jsxComponentChunk(rootId),
      {
        type: 'AST',
        name: 'export',
        content: types.exportDefaultDeclaration(types.identifier('Dashboard')),
      },
    ],
    options: {
      workflows: {
        workflows: workflows.reduce(
          (byId: Record<string, unknown>, wf) => ({ ...byId, [wf.id]: wf }),
          {}
        ),
        customNodes: {},
      },
      pagesPath: ['pages'],
      extractedResources: {},
      projectComponents,
    },
    dependencies: {},
  }
  await createNextWorkflowPlugin({ isPage })(structure)
  const exportChunk = structure.chunks.find((chunk: any) => chunk.name === 'export')
  const moduleChunk = structure.chunks.find((chunk: any) => chunk.name === 'workflow-module')
  return {
    exportCode: generator(exportChunk.content).code,
    moduleCode: moduleChunk ? String(moduleChunk.content) : '',
    dependencies: structure.dependencies,
    extractedResources: structure.options.extractedResources,
  }
}

const BANNER_ID = 'thq_container_banner'

/** An instance of a project component, as local dependencies are resolved for pages. */
const componentInstance = (name: string) => ({
  type: 'element',
  content: { elementType: 'component', semanticType: name, dependency: { type: 'local' } },
})

const pageRendering = (componentName: string) => ({
  type: 'element',
  content: { elementType: 'container', children: [componentInstance(componentName)] },
})

const bannerComponent = () => ({
  name: 'Banner',
  node: {
    type: 'element',
    content: { elementType: 'container', attrs: { id: { type: 'static', content: BANNER_ID } } },
  },
})

const WRAPPED_EXPORT = 'export default remountOnPageArrival(Dashboard);'
const PLAIN_EXPORT = 'export default Dashboard;'

describe('workflow plugin — remount on page arrival', () => {
  it('wraps a page whose workflow runs when the page loads', async () => {
    const result = await run([workflow('event-page-loaded', 'page', { pageId: PAGE_ID })])

    expect(result.exportCode).toBe(WRAPPED_EXPORT)
    expect(result.dependencies.remountOnPageArrival).toEqual({
      type: 'local',
      path: '../utils/page-arrival',
    })
    expect(result.extractedResources['utils/page-arrival']).toBeDefined()
  })

  it('wraps a page whose workflow runs when its root element becomes visible', async () => {
    const result = await run([
      workflow('event-element-visible', 'element', { elementHtmlId: ROOT_ID, once: true }),
    ])

    expect(result.exportCode).toBe(WRAPPED_EXPORT)
  })

  it('leaves the page alone when the visible element is rendered elsewhere', async () => {
    const result = await run(
      [workflow('event-element-visible', 'element', { elementHtmlId: ROOT_ID, once: true })],
      { rootId: 'thq_container_other' }
    )

    expect(result.exportCode).toBe(PLAIN_EXPORT)
    expect(result.dependencies.remountOnPageArrival).toBeUndefined()
    expect(result.extractedResources).toEqual({})
  })

  it('leaves the page alone when its workflows only answer interactions', async () => {
    const result = await run([
      workflow('event-element-clicked', 'element', { elementHtmlId: ROOT_ID }),
      workflow('event-interval', 'page', { pageId: PAGE_ID, intervalMs: 1000 }),
    ])

    expect(result.moduleCode).not.toBe('')
    expect(result.exportCode).toBe(PLAIN_EXPORT)
  })

  it('never wraps a component', async () => {
    const result = await run(
      [workflow('event-component-loaded', 'component', { componentName: 'Dashboard' })],
      { isPage: false }
    )

    expect(result.moduleCode).toContain('Component loaded')
    expect(result.exportCode).toBe(PLAIN_EXPORT)
  })

  it('wraps a page that renders a component running a workflow when its element is visible', async () => {
    const result = await run(
      [workflow('event-element-visible', 'element', { elementHtmlId: BANNER_ID, once: true })],
      { pageNode: pageRendering('Banner'), projectComponents: { Banner: bannerComponent() } }
    )

    expect(result.moduleCode).toBe('')
    expect(result.exportCode).toBe(WRAPPED_EXPORT)
  })

  it('finds the component through the components it is nested in', async () => {
    const result = await run(
      [workflow('event-element-visible', 'element', { elementHtmlId: BANNER_ID, once: true })],
      {
        pageNode: pageRendering('Layout'),
        projectComponents: {
          Layout: { name: 'Layout', node: componentInstance('Banner') },
          Banner: bannerComponent(),
        },
      }
    )

    expect(result.exportCode).toBe(WRAPPED_EXPORT)
  })

  it('wraps a page that renders a component running a workflow when it loads', async () => {
    const result = await run(
      [workflow('event-component-loaded', 'component', { componentName: 'Banner' })],
      { pageNode: pageRendering('Banner'), projectComponents: { Banner: bannerComponent() } }
    )

    expect(result.exportCode).toBe(WRAPPED_EXPORT)
  })

  it('leaves the page alone when no rendered component observes the element', async () => {
    const result = await run(
      [
        workflow('event-element-visible', 'element', {
          elementHtmlId: 'thq_elsewhere',
          once: true,
        }),
      ],
      { pageNode: pageRendering('Banner'), projectComponents: { Banner: bannerComponent() } }
    )

    expect(result.exportCode).toBe(PLAIN_EXPORT)
  })

  it('cancels a delayed page-loaded run together with the other triggers', async () => {
    const result = await run([
      workflow('event-page-loaded', 'page', { pageId: PAGE_ID, delay: 500 }),
    ])

    expect(result.moduleCode).toContain(
      'const __delay_wf_event_page_loaded = setTimeout(function() { __execWf(__wfConfig_wf_event_page_loaded'
    )
    expect(result.moduleCode).toContain(
      'cleanups.push(function() { clearTimeout(__delay_wf_event_page_loaded); });'
    )
  })
})
