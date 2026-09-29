// `event-route-changed` codegen: component-scoped triggers register a
// `Router.events` listener inside the owning component's lifecycle effect
// (with an `.off` cleanup so remounts don't leak listeners); unbound triggers
// are global-scoped and register in the `_app`-mounted global workflows hook,
// which must then import Router itself.

import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'

const routeChangedWorkflow = (scope: string, config: Record<string, unknown>) => ({
  id: 'wf-route-changed',
  name: 'Track Route',
  trigger: {
    type: 'event-route-changed',
    nodeId: 'trigger-route-changed',
    scope,
    config,
  },
  nodes: [
    {
      id: 'update-1',
      type: 'state-update-local-state',
      config: { property: 'currentRoute', value: '' },
      stepNumber: 1,
      label: 'Set route',
    },
  ],
  edges: [{ id: 'e1', source: 'trigger-route-changed', target: 'update-1' }],
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

describe('event-route-changed — component scope', () => {
  it('registers Router.events with an .off cleanup in the component lifecycle', async () => {
    const workflow = routeChangedWorkflow('component', { componentName: 'Navigation' })
    const plugin = createNextWorkflowPlugin({ isPage: false })
    const structure: any = {
      uidl: {
        name: 'Navigation',
        node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
        stateDefinitions: { currentRoute: { type: 'string', defaultValue: '' } },
      },
      chunks: [jsxComponentChunk()],
      options: {
        workflows: { workflows: { [workflow.id]: workflow }, customNodes: {} },
      },
      dependencies: {},
    }
    await plugin(structure)
    const moduleChunk = (structure.chunks as any[]).find((c: any) => c.name === 'workflow-module')
    expect(moduleChunk).toBeDefined()
    const code = String(moduleChunk.content)
    expect(code).toContain("Router.events.on('routeChangeComplete'")
    expect(code).toContain("Router.events.off('routeChangeComplete'")
    expect(code).toContain('cleanups.push')
    expect(code).toContain('previousUrl')
  })
})

describe('event-route-changed — page scope', () => {
  // A page's component stays mounted between two routes of the same page
  // (`/products/a` → `/products/b`); a route change bound to that page runs in
  // its lifecycle effect, next to the page's own state setters.
  const generatePage = async (pageId: string) => {
    const workflow = routeChangedWorkflow('page', { pageId: 'page-product' })
    const plugin = createNextWorkflowPlugin({ isPage: true })
    const structure: any = {
      uidl: {
        name: 'ProductDetails',
        outputOptions: { pageId },
        node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
        stateDefinitions: { currentRoute: { type: 'string', defaultValue: '' } },
      },
      chunks: [jsxComponentChunk()],
      options: {
        workflows: { workflows: { [workflow.id]: workflow }, customNodes: {} },
      },
      dependencies: {},
    }
    await plugin(structure)
    const moduleChunk = (structure.chunks as any[]).find((c: any) => c.name === 'workflow-module')
    return { code: moduleChunk ? String(moduleChunk.content) : '', structure }
  }

  it('registers Router.events with an .off cleanup in its page lifecycle', async () => {
    const { code, structure } = await generatePage('page-product')
    const setup = code.slice(code.indexOf('const setupLifecycleTriggers'))
    expect(setup).toContain("Router.events.on('routeChangeComplete'")
    expect(setup).toContain("Router.events.off('routeChangeComplete'")
    expect(setup).toContain('cleanups.push')
    expect(structure.dependencies.Router).toMatchObject({ path: 'next/router' })
  })

  it('stays out of every other page', async () => {
    const { code } = await generatePage('page-home')
    expect(code).not.toContain("Router.events.on('routeChangeComplete'")
  })
})

describe('event-route-changed — global scope', () => {
  const plugin = new NextWorkflowProjectPlugin()
  // generateGlobalWorkflowsHook is private; call it directly for a unit test.
  const code = (plugin as any).generateGlobalWorkflowsHook([
    routeChangedWorkflow('global', {}),
  ]) as string

  it('registers Router.events with an .off cleanup in the global hook', () => {
    expect(code).toContain("Router.events.on('routeChangeComplete'")
    expect(code).toContain("Router.events.off('routeChangeComplete'")
    expect(code).toContain('previousUrl')
  })

  it('imports Router in the generated global-workflows file', () => {
    expect(code).toContain("import Router from 'next/router';")
  })

  it('does NOT import Router when no route-changed workflow exists', () => {
    const withoutRoute = (plugin as any).generateGlobalWorkflowsHook([
      {
        id: 'wf-other',
        trigger: { type: 'event-user-logged-in', config: {} },
        nodes: [],
        edges: [],
      },
    ]) as string
    expect(withoutRoute).not.toContain("import Router from 'next/router';")
  })
})
