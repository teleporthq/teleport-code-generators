// `event-chapter-reached` is a LIFECYCLE trigger bound to ONE element (a
// scroll-scene chapter): it listens for the `tq-chapter-reached` event the
// published TqScrollScene dispatches on the chapter, so it follows the same
// rules as element-visible — DOM id lookup, and pruned from every page whose
// JSX does not render the chapter.

import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'

const HTML_ID = 'thq_chapter_pricing'
const NODE_ID = 'TQ__chapterPricing'

const chapterWorkflow = (config: Record<string, unknown>) => ({
  id: 'wf-chapter-pricing',
  name: 'Load pricing on chapter',
  trigger: {
    type: 'event-chapter-reached',
    nodeId: 'trigger-chapter',
    scope: 'element',
    config,
  },
  nodes: [
    {
      id: 'update-1',
      type: 'state-update-local-state',
      config: { property: 'pricingLoaded', value: true },
      stepNumber: 1,
      label: 'Mark loaded',
    },
  ],
  edges: [{ id: 'e1', source: 'trigger-chapter', target: 'update-1' }],
})

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
                argument: {
                  type: 'JSXElement',
                  openingElement: {
                    type: 'JSXOpeningElement',
                    name: { type: 'JSXIdentifier', name: 'div' },
                    attributes: elementId
                      ? [
                          {
                            type: 'JSXAttribute',
                            name: { type: 'JSXIdentifier', name: 'id' },
                            value: { type: 'StringLiteral', value: elementId },
                          },
                        ]
                      : [],
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
      name: 'Story',
      node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
      stateDefinitions: { pricingLoaded: { type: 'boolean', defaultValue: false } },
    },
    chunks: [jsxWithElementId(renderedElementId)],
    options: { workflows: { workflows: { [workflow.id]: workflow }, customNodes: {} } },
    dependencies: {},
  }
  await plugin(structure)
  const moduleChunk = (structure.chunks as any[]).find((c: any) => c.name === 'workflow-module')
  return moduleChunk ? String(moduleChunk.content) : null
}

describe('event-chapter-reached — generated listener', () => {
  const module = (config: Record<string, unknown>, rendered: string | null = HTML_ID) =>
    getWorkflowModule(chapterWorkflow(config), rendered)

  it('listens on the chapter DOM id for the scene announcement', async () => {
    const code = await module({ nodeId: NODE_ID, elementHtmlId: HTML_ID })
    expect(code).not.toBeNull()
    expect(code).toContain(`document.getElementById('${HTML_ID}')`)
    expect(code).toContain("addEventListener('tq-chapter-reached'")
    expect(code).toContain(`elementId: '${HTML_ID}'`)
    expect(code).toContain('chapterIndex: detail.chapterIndex')
    expect(code).not.toContain(NODE_ID)
  })

  it('listens on the chapter root and ignores announcements bubbling from a nested scene', async () => {
    const code = await module({ nodeId: NODE_ID, elementHtmlId: HTML_ID })
    expect(code).toContain(".closest('[data-scene-stage] > *, [data-scene-track] > *')")
    expect(code).toMatch(/if \(event\.target !== __chRoot_\w+\) \{ return; \}/)
  })

  it('fires once by default and detaches after the first announcement', async () => {
    const code = await module({ nodeId: NODE_ID, elementHtmlId: HTML_ID })
    expect(code).toMatch(
      /__chRoot_\w+\.removeEventListener\('tq-chapter-reached', __chH_\w+\);\n\s+__chFire_/
    )
    expect(code).toMatch(/if \(!__chStamp_\w+\) \{/)
  })

  it('keeps listening when the author asked for every time', async () => {
    const code = await module({ nodeId: NODE_ID, elementHtmlId: HTML_ID, once: false })
    expect(code).not.toMatch(
      /__chRoot_\w+\.removeEventListener\('tq-chapter-reached', __chH_\w+\);\n\s+__chFire_/
    )
    expect(code).not.toMatch(/if \(!__chStamp_\w+\) \{/)
    expect(code).toContain("addEventListener('tq-chapter-reached'")
  })

  it('reads the stamped chapter and count when it attaches after the announcement', async () => {
    const code = await module({ nodeId: NODE_ID, elementHtmlId: HTML_ID })
    expect(code).toContain("getAttribute('data-chapter-active')")
    expect(code).toContain("getAttribute('data-chapter-count')")
  })

  it('is pruned from a page that does not render the chapter', async () => {
    const code = await module({ nodeId: NODE_ID, elementHtmlId: HTML_ID }, 'some_other_element')
    expect(code === null || !code.includes('tq-chapter-reached')).toBe(true)
  })
})
