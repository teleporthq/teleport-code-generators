// The two "scrolled past a point" triggers. `event-scene-scrolled-past` is a
// LIFECYCLE trigger bound to ONE element (the scroll scene): it listens for
// `tq-scene-point-passed` on the scene's track and is pruned from pages that
// do not render the scene. `event-page-scrolled-past` is page-scoped and
// watches the window's own scroll progress.

import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'

const HTML_ID = 'thq_story_scene'
const NODE_ID = 'TQ__storyScene'

const workflowWith = (trigger: Record<string, unknown>) => ({
  id: 'wf-scrolled-past',
  name: 'Reveal offer',
  trigger: { nodeId: 'trigger-scroll', ...trigger },
  nodes: [
    {
      id: 'update-1',
      type: 'state-update-local-state',
      config: { property: 'offerShown', value: true },
      stepNumber: 1,
      label: 'Show offer',
    },
  ],
  edges: [{ id: 'e1', source: 'trigger-scroll', target: 'update-1' }],
})

const sceneWorkflow = (config: Record<string, unknown>) =>
  workflowWith({ type: 'event-scene-scrolled-past', scope: 'element', config })

const pageWorkflow = (config: Record<string, unknown>) =>
  workflowWith({ type: 'event-page-scrolled-past', scope: 'page', config })

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
      outputOptions: { pageId: 'page_home', fileName: 'page_home' },
      node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
      stateDefinitions: { offerShown: { type: 'boolean', defaultValue: false } },
    },
    chunks: [jsxWithElementId(renderedElementId)],
    options: { workflows: { workflows: { [workflow.id]: workflow }, customNodes: {} } },
    dependencies: {},
  }
  await plugin(structure)
  const moduleChunk = (structure.chunks as any[]).find((c: any) => c.name === 'workflow-module')
  return moduleChunk ? String(moduleChunk.content) : null
}

describe('event-scene-scrolled-past — generated listener', () => {
  const module = (config: Record<string, unknown>, rendered: string | null = HTML_ID) =>
    getWorkflowModule(sceneWorkflow(config), rendered)

  it('listens on the scene track for the point the author picked', async () => {
    const code = await module({ nodeId: NODE_ID, elementHtmlId: HTML_ID, point: 'three-quarters' })
    expect(code).not.toBeNull()
    expect(code).toContain(`document.getElementById('${HTML_ID}')`)
    expect(code).toContain(".closest('[data-scene-track]')")
    expect(code).toContain("addEventListener('tq-scene-point-passed'")
    expect(code).toContain("if (detail.point !== 'three-quarters') { return; }")
    expect(code).toContain(`elementId: '${HTML_ID}', point: 'three-quarters'`)
    expect(code).toMatch(/if \(event\.target !== __spRoot_\w+\) \{ return; \}/)
    expect(code).not.toContain(NODE_ID)
  })

  it('falls back to halfway when no point was set', async () => {
    const code = await module({ nodeId: NODE_ID, elementHtmlId: HTML_ID })
    expect(code).toContain("if (detail.point !== 'half') { return; }")
    expect(code).toMatch(/if \(__spStamp_\w+ >= 2\) \{/)
  })

  it('fires once by default: detaches after the first pass and skips the listener when the stamp already covers it', async () => {
    const code = await module({ nodeId: NODE_ID, elementHtmlId: HTML_ID, point: 'end' })
    expect(code).toMatch(
      /__spRoot_\w+\.removeEventListener\('tq-scene-point-passed', __spH_\w+\);\n\s+__spFire_/
    )
    expect(code).toMatch(/if \(__spStamp_\w+ < 4\) \{/)
  })

  it('keeps listening when the author asked for every time', async () => {
    const code = await module({
      nodeId: NODE_ID,
      elementHtmlId: HTML_ID,
      point: 'quarter',
      once: false,
    })
    expect(code).not.toMatch(
      /__spRoot_\w+\.removeEventListener\('tq-scene-point-passed', __spH_\w+\);\n\s+__spFire_/
    )
    expect(code).not.toMatch(/if \(__spStamp_\w+ < 1\) \{/)
    expect(code).toContain("addEventListener('tq-scene-point-passed'")
  })

  it('reads the stamped furthest point when it attaches after the pass', async () => {
    const code = await module({ nodeId: NODE_ID, elementHtmlId: HTML_ID, point: 'half' })
    expect(code).toContain("getAttribute('data-scene-point')")
    expect(code).toMatch(/if \(__spStamp_\w+ >= 2\) \{\n\s+__spFire_\w+\(0\.5\);/)
  })

  it('is pruned from a page that does not render the scene', async () => {
    const code = await module({ nodeId: NODE_ID, elementHtmlId: HTML_ID }, 'some_other_element')
    expect(code === null || !code.includes('tq-scene-point-passed')).toBe(true)
  })
})

describe('event-page-scrolled-past — generated listener', () => {
  const module = (config: Record<string, unknown>) => getWorkflowModule(pageWorkflow(config), null)

  it('watches the window scroll progress for the point the author picked', async () => {
    const code = await module({ pageId: 'page_home', point: 'three-quarters' })
    expect(code).not.toBeNull()
    expect(code).toContain("window.addEventListener('scroll', __ppOnScroll_")
    expect(code).toContain("window.addEventListener('resize', __ppOnScroll_")
    expect(code).toContain('document.documentElement.scrollHeight - window.innerHeight')
    expect(code).toContain('if (progress < 0.75 - 0.000001)')
    expect(code).toContain("point: 'three-quarters', progress: progress, url: window.location.href")
  })

  it('checks once on attach so an anchor link that opens past the point counts', async () => {
    const code = await module({ pageId: 'page_home', point: 'half' })
    expect(code).toMatch(/cleanups\.push\(__ppStop_\w+\);\n\s+__ppCheck_\w+\(\);/)
  })

  it('stays off every page but the one it watches', async () => {
    const code = await module({ pageId: 'page_pricing', point: 'half' })
    expect(code === null || !code.includes('__ppOnScroll_')).toBe(true)
    const everywhere = await module({ allPages: true, point: 'half' })
    expect(everywhere).toContain('__ppOnScroll_')
  })

  it('treats a page that cannot scroll as fully in view', async () => {
    const code = await module({ pageId: 'page_home', point: 'end' })
    expect(code).toContain('return max <= 0 ? 1 :')
  })

  it('fires once by default and detaches; every time re-arms when the visitor scrolls back up', async () => {
    const once = await module({ pageId: 'page_home', point: 'half' })
    expect(once).toMatch(/__ppPassed_\w+ = true;\n\s+__ppStop_\w+\(\);/)
    const every = await module({ pageId: 'page_home', point: 'half', once: false })
    expect(every).not.toMatch(/__ppPassed_\w+ = true;\n\s+__ppStop_\w+\(\);/)
    expect(every).toMatch(/\{ __ppPassed_\w+ = false; return; \}/)
  })
})
