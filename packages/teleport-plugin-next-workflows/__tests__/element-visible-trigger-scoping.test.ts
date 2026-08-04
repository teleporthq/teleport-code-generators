// `event-element-visible` is a LIFECYCLE trigger (IntersectionObserver, no React
// event prop) that is nonetheless bound to ONE element. Two defects followed
// from that, both shipped in run a15472af's cookie-consent banner:
//
//   1. The observer looked the element up by `config.nodeId` — the
//      project-document id (`TQ_…`) — instead of `config.elementHtmlId`, the DOM
//      id the generator actually emits. `getElementById` returned null on every
//      page, so the observer was never constructed and the banner (whose only
//      writer is that workflow) could never appear. 408 dead lookups across 24
//      files.
//
//   2. Having no React prop, it fell into `lifecycleWorkflows`, which were
//      activated unconditionally — bypassing the JSX-presence prune that is the
//      only thing scoping element workflows to a page. One workflow shipped into
//      EVERY generated file, 17 per page, including 404.js and logo.js.

import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'

const HTML_ID = 'thq_container_pu-S'
const NODE_ID = 'TQ__X8oOlJm82'

const elementVisibleWorkflow = (config: Record<string, unknown>) => ({
  id: 'wf-cookie-visible',
  name: 'Cookie Consent Check on Load',
  trigger: {
    type: 'event-element-visible',
    nodeId: 'trigger-element-visible',
    scope: 'element',
    config,
  },
  nodes: [
    {
      id: 'update-1',
      type: 'state-update-local-state',
      config: { property: 'cookieConsentVisible', value: true },
      stepNumber: 1,
      label: 'Show banner',
    },
  ],
  edges: [{ id: 'e1', source: 'trigger-element-visible', target: 'update-1' }],
})

/** A JSX tree whose root element carries `id={HTML_ID}` — i.e. the page that owns it. */
const jsxWithElementId = (elementId: string | null) => ({
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
            body: [
              {
                type: 'ReturnStatement',
                argument: elementId
                  ? {
                      type: 'JSXElement',
                      openingElement: {
                        type: 'JSXOpeningElement',
                        name: { type: 'JSXIdentifier', name: 'div' },
                        attributes: [
                          {
                            type: 'JSXAttribute',
                            name: { type: 'JSXIdentifier', name: 'id' },
                            value: { type: 'StringLiteral', value: elementId },
                          },
                        ],
                      },
                      children: [],
                    }
                  : {
                      type: 'JSXElement',
                      openingElement: {
                        type: 'JSXOpeningElement',
                        name: { type: 'JSXIdentifier', name: 'div' },
                        attributes: [],
                      },
                      children: [],
                    },
              },
            ],
          },
        },
      },
    ],
  },
})

const getWorkflowModule = async (
  workflow: any,
  renderedElementId: string | null
): Promise<string | null> => {
  const plugin = createNextWorkflowPlugin({ isPage: true })
  const structure: any = {
    uidl: {
      name: 'Dashboard',
      node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
      stateDefinitions: { cookieConsentVisible: { type: 'boolean', defaultValue: false } },
    },
    chunks: [jsxWithElementId(renderedElementId)],
    options: { workflows: { workflows: { [workflow.id]: workflow }, customNodes: {} } },
    dependencies: {},
  }
  await plugin(structure)
  const moduleChunk = (structure.chunks as any[]).find((c: any) => c.name === 'workflow-module')
  return moduleChunk ? String(moduleChunk.content) : null
}

describe('event-element-visible — element lookup', () => {
  it('observes the DOM id, not the project-document node id', async () => {
    const code = await getWorkflowModule(
      elementVisibleWorkflow({ nodeId: NODE_ID, elementHtmlId: HTML_ID, once: true }),
      HTML_ID
    )
    expect(code).not.toBeNull()
    expect(code).toContain(`document.getElementById('${HTML_ID}')`)
    expect(code).not.toContain(NODE_ID)
  })

  it('reports the DOM id in the trigger context too', async () => {
    const code = await getWorkflowModule(
      elementVisibleWorkflow({ nodeId: NODE_ID, elementHtmlId: HTML_ID, once: true }),
      HTML_ID
    )
    expect(code).toContain(`elementId: '${HTML_ID}'`)
  })

  it('still falls back to nodeId when no html id was mapped', async () => {
    const code = await getWorkflowModule(
      elementVisibleWorkflow({ nodeId: NODE_ID, once: true }),
      NODE_ID
    )
    expect(code).toContain(`document.getElementById('${NODE_ID}')`)
  })
})

describe('event-element-visible — per-page scoping', () => {
  it('is generated into the page that renders its element', async () => {
    const code = await getWorkflowModule(
      elementVisibleWorkflow({ nodeId: NODE_ID, elementHtmlId: HTML_ID, once: true }),
      HTML_ID
    )
    expect(code).not.toBeNull()
    expect(code).toContain('Element visible')
  })

  it('is NOT generated into a page that does not render its element', async () => {
    // The 404 / logo case: 17 dead observers per file for a banner it never has.
    const code = await getWorkflowModule(
      elementVisibleWorkflow({ nodeId: NODE_ID, elementHtmlId: HTML_ID, once: true }),
      'thq_container_somewhere_else'
    )
    expect(code === null || !code.includes('Element visible')).toBe(true)
  })

  it('stays active when the trigger names no element at all (nothing to prune against)', async () => {
    const code = await getWorkflowModule(
      elementVisibleWorkflow({ once: true }),
      'thq_container_somewhere_else'
    )
    expect(code).not.toBeNull()
    expect(code).toContain('Element visible')
  })

  it('leaves element-less lifecycle workflows (page-loaded) unconditionally active', async () => {
    const pageLoaded = {
      id: 'wf-page-loaded',
      name: 'Init Page',
      // `allPages` because an UNSCOPED page-loaded is deliberately skipped by
      // pre-existing relevance filtering (workflow-component-plugin.ts:2653-2660)
      // — unrelated to element scoping, but it would mask what this asserts.
      trigger: {
        type: 'event-page-loaded',
        nodeId: 't1',
        scope: 'page',
        config: { allPages: true },
      },
      nodes: [
        {
          id: 'update-1',
          type: 'state-update-local-state',
          config: { property: 'cookieConsentVisible', value: true },
          stepNumber: 1,
          label: 'x',
        },
      ],
      edges: [{ id: 'e1', source: 't1', target: 'update-1' }],
    }
    const code = await getWorkflowModule(pageLoaded, 'unrelated-element')
    expect(code).not.toBeNull()
  })
})

// Regression for the product-card `ReferenceError: __wfConfig_… is not defined`
// crash. The per-page prune removed the unmatched element-visible workflow from
// the CONFIG emission (`activeWorkflows`) but NOT from the lifecycle HANDLER
// emission — so the module still contained an IntersectionObserver that resolves
// its target with a DOCUMENT-WIDE `getElementById`, matches the shared cookie
// banner another component rendered, and calls `__execWf(__wfConfig_<id>)` for a
// config that was never declared. The single-workflow "not generated" test above
// can't catch it: with only the unmatched workflow the whole module is empty. The
// bug needs a SECOND, active workflow keeping the module alive — exactly the
// product card, which has real click handlers plus ~23 riding cookie observers.
describe('event-element-visible — config/handler integrity when the module is kept alive', () => {
  // Unconditionally-active (no element target) — stands in for the card's real
  // click workflows: it keeps the workflow module non-empty.
  const keepAliveWorkflow = {
    id: 'wf-keep-alive',
    name: 'Init Card',
    trigger: {
      type: 'event-page-loaded',
      nodeId: 't-alive',
      scope: 'page',
      config: { allPages: true },
    },
    nodes: [
      {
        id: 'a1',
        type: 'state-update-local-state',
        config: { property: 'cookieConsentVisible', value: true },
        stepNumber: 1,
        label: 'x',
      },
    ],
    edges: [{ id: 'ea', source: 't-alive', target: 'a1' }],
  }

  const getModuleForWorkflows = async (
    wfs: any[],
    renderedElementId: string | null
  ): Promise<string | null> => {
    const plugin = createNextWorkflowPlugin({ isPage: true })
    const workflowsMap: Record<string, any> = {}
    for (const wf of wfs) {
      workflowsMap[wf.id] = wf
    }
    const structure: any = {
      uidl: {
        name: 'ProductCard',
        node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
        stateDefinitions: { cookieConsentVisible: { type: 'boolean', defaultValue: false } },
      },
      chunks: [jsxWithElementId(renderedElementId)],
      options: { workflows: { workflows: workflowsMap, customNodes: {} } },
      dependencies: {},
    }
    await plugin(structure)
    const moduleChunk = (structure.chunks as any[]).find((c: any) => c.name === 'workflow-module')
    return moduleChunk ? String(moduleChunk.content) : null
  }

  it('prunes an unmatched element-visible handler even when another workflow keeps the module alive', async () => {
    const cookie = elementVisibleWorkflow({
      nodeId: NODE_ID,
      elementHtmlId: 'thq_not_on_this_card',
      once: true,
    })
    const code = await getModuleForWorkflows([keepAliveWorkflow, cookie], HTML_ID)
    expect(code).not.toBeNull()
    // The keep-alive workflow is present, so the module really is non-empty.
    expect(code).toContain('const __wfConfig_wf_keep_alive =')
    // The unmatched cookie observer must be fully gone: no config, no handler,
    // no reference to its element.
    expect(code).not.toContain('__wfConfig_wf_cookie_visible')
    expect(code).not.toContain('thq_not_on_this_card')
  })

  it('leaves no dangling __wfConfig_ reference (every used config is declared)', async () => {
    const cookie = elementVisibleWorkflow({
      nodeId: NODE_ID,
      elementHtmlId: 'thq_not_on_this_card',
      once: true,
    })
    const code = (await getModuleForWorkflows([keepAliveWorkflow, cookie], HTML_ID)) || ''
    const declared = new Set(
      Array.from(code.matchAll(/const (__wfConfig_[A-Za-z0-9_]+)\s*=/g)).map((m) => m[1])
    )
    const used = new Set(
      Array.from(code.matchAll(/__execWf\(\s*(__wfConfig_[A-Za-z0-9_]+)/g)).map((m) => m[1])
    )
    const dangling = Array.from(used).filter((id) => !declared.has(id))
    expect(dangling).toEqual([])
  })

  it('still emits the element-visible workflow on the card that DOES render its element', async () => {
    const cookie = elementVisibleWorkflow({ nodeId: NODE_ID, elementHtmlId: HTML_ID, once: true })
    const code = await getModuleForWorkflows([keepAliveWorkflow, cookie], HTML_ID)
    expect(code).not.toBeNull()
    expect(code).toContain('Element visible')
    expect(code).toContain('const __wfConfig_wf_cookie_visible =')
  })
})
