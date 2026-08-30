import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

// A Scroll Scene wrapping a bound chapter — mirrors what the GUI's
// scrollSceneNodeToUIDL emits (elementType 'scroll-scene-node', camelCase
// props, children preserved, data-scroll-bind riding on plain children).
const SCROLL_SCENE_ELEMENT_NODE = {
  type: 'element',
  content: {
    elementType: 'scroll-scene-node',
    name: 'scene',
    attrs: {
      sceneLength: { type: 'static', content: '400vh' },
      pin: { type: 'static', content: true },
      scrub: { type: 'static', content: 0.4 },
    },
    children: [
      {
        type: 'element',
        content: {
          elementType: 'container',
          attrs: {
            id: { type: 'static', content: 'scene-chapter-1' },
            'data-scroll-bind': {
              type: 'static',
              content: '[{"prop":"opacity","at":[0,0.3],"values":[0,1]}]',
            },
          },
          children: [],
        },
      },
      {
        type: 'element',
        content: {
          elementType: 'container',
          attrs: {
            id: { type: 'static', content: 'scene-chapter-2' },
            'data-scroll-bind': { type: 'static', content: 'depth-2' },
          },
          children: [],
        },
      },
    ],
  },
}

const buildUidlWithScene = (): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  const indexPage = (uidl.root.node.content.children || []).find(
    (child) =>
      child.type === 'conditional' && (child.content as { value?: string }).value === 'index'
  )
  const pageElement = (indexPage as { content: { node: { content: { children: unknown[] } } } })
    .content.node.content
  pageElement.children.push(SCROLL_SCENE_ELEMENT_NODE)
  return uidl
}

const findFile = (folder: GeneratedFolder, folderName: string, fileName: string) =>
  folder.subFolders
    .find((sub) => sub.name === folderName)
    ?.files.find((file) => file.name === fileName)

describe('Next generator with a Scroll Scene element', () => {
  const generator = createNextProjectGenerator()

  it('ships the reveal and count lanes in the runtime, with the count rule', async () => {
    const outputFolder = await generator.generateProject(buildUidlWithScene(), template)
    const component = findFile(outputFolder, 'components', 'tq-scroll-scene')
    expect(component?.content).toContain("'clip'")
    expect(component?.content).toContain("'clip-y'")
    expect(component?.content).toContain("'count'")
    expect(component?.content).toContain('clipPath')
    expect(component?.content).toContain("setProperty('--tq-count'")
    expect(component?.content).toContain('[data-scroll-count]::before')
  })

  it('renders <TqScrollScene> wrapping its children with data-scroll-bind intact', async () => {
    const outputFolder = await generator.generateProject(buildUidlWithScene(), template)

    const indexPage = findFile(outputFolder, 'pages', 'index')
    expect(indexPage?.content).toContain('TqScrollScene')
    expect(indexPage?.content).toMatch(
      /<TqScrollScene[\s\S]*scene-chapter-1[\s\S]*<\/TqScrollScene>/
    )
    // The child bindings ride through as plain data attributes — the wrapper
    // reads them by DOM query at runtime, so they must survive codegen.
    expect(indexPage?.content).toContain('data-scroll-bind')
    expect(indexPage?.content).toContain('depth-2')
    expect(indexPage?.content).toContain('sceneLength')
  })

  it('ships the wrapper with the sticky track/stage, lane engine and guardrails', async () => {
    const outputFolder = await generator.generateProject(buildUidlWithScene(), template)
    const component = findFile(outputFolder, 'components', 'tq-scroll-scene')
    const code = component?.content || ''

    expect(code).toContain("from 'framer-motion'")
    expect(code).toContain('useScroll')
    expect(code).toContain('useSpring')
    // Sticky pinning + track sizing. MIN-heights, never exact heights — an
    // exact height let content taller than one screen be painted over by the
    // next section (mirrors the canvas renderer's contract).
    expect(code).toContain("position: 'sticky'")
    expect(code).toContain('minHeight: normalizeSceneLength')
    expect(code).toContain("minHeight: '100vh'")
    expect(code).not.toContain("height: '100vh' }")
    // Chapter layout: the stage centers + same-cell-stacks its children.
    expect(code).toContain("layout === 'chapters'")
    expect(code).toContain('grid-area: 1 / 1')
    // Lanes applied by DOM query + MutationObserver (the Repeater-safe design),
    // never React child introspection.
    expect(code).toContain('querySelectorAll')
    expect(code).toContain('MutationObserver')
    expect(code).not.toContain('React.Children')
    // Presets mirror the canvas lanes module.
    for (const preset of ['depth-1', 'fade-window', 'rail-x', 'zoom-through']) {
      expect(code).toContain(preset)
    }
    // Guardrails: reduced-motion handling and the sticky-killing-overflow warning.
    expect(code).toContain('useReducedMotion')
    expect(code).toContain('disables sticky pinning')
    expect(code).toContain('--scene-progress')
  })

  it('adds framer-motion once and bumps react even when only a scene (no motion) is used', async () => {
    const outputFolder = await generator.generateProject(buildUidlWithScene(), template)
    const packageFile = outputFolder.files.find((file) => file.name === 'package')
    const packageJson = JSON.parse(packageFile?.content || '{}')
    expect(packageJson.dependencies['framer-motion']).toBe('^11.18.0')
    expect(packageJson.dependencies.react).toBe('^18.3.1')
  })

  it("lanes write individual transform props, never the author's `transform`", async () => {
    const outputFolder = await generator.generateProject(buildUidlWithScene(), template)
    const scene = findFile(outputFolder, 'components', 'tq-scroll-scene')
    expect(scene?.content).toContain('element.style.translate')
    expect(scene?.content).toContain('element.style.rotate')
    expect(scene?.content).not.toContain('element.style.transform')
    expect(scene?.content).toContain("perspective: '900px'")
  })

  it('treats overscroll: no rubber-band where honored, html canvas matches the page color', async () => {
    const outputFolder = await generator.generateProject(buildUidlWithScene(), template)
    const scene = findFile(outputFolder, 'components', 'tq-scroll-scene')
    expect(scene?.content).toContain('html { overscroll-behavior-y: none; }')
    expect(scene?.content).toContain('root.style.backgroundColor = bodyBackground')
  })

  it('Scroll rail behaviors ship their controller only when a container opts in', async () => {
    const plain = await generator.generateProject(buildUidlWithScene(), template)
    expect(findFile(plain, 'components', 'tq-scroll-rail')).toBeUndefined()

    const uidl = buildUidlWithScene()
    const indexPage = (uidl.root.node.content.children || []).find(
      (child) =>
        child.type === 'conditional' && (child.content as { value?: string }).value === 'index'
    )
    ;(
      indexPage as { content: { node: { content: { children: unknown[] } } } }
    ).content.node.content.children.push({
      type: 'element',
      content: {
        elementType: 'container',
        name: 'card-rail',
        style: { overflowX: { type: 'static', content: 'auto' } },
        attrs: {
          'data-scroll-rail-snap': { type: 'static', content: 'firm' },
          'data-scroll-rail-wheel': { type: 'static', content: 'true' },
          'data-scroll-rail-scrollbar': { type: 'static', content: 'hidden' },
        },
        children: [],
      },
    })
    const railed = await generator.generateProject(uidl, template)
    const runtime = findFile(railed, 'components', 'tq-scroll-rail')
    expect(runtime?.content).toContain('scroll-snap-type: x mandatory')
    expect(runtime?.content).toContain('scroll-snap-align: start')
    expect(runtime?.content).toContain('::-webkit-scrollbar { display: none; }')
    expect(runtime?.content).toContain("addEventListener('wheel'")
    // A snapping rail steps one item per gesture — a free nudge would be re-snapped at once.
    expect(runtime?.content).toContain("rail.scrollTo({ left: next, behavior: 'smooth' })")
    expect(findFile(railed, 'pages', '_app')?.content).toContain('<TqScrollRail />')
    const page = findFile(railed, 'pages', 'index')?.content || ''
    expect(page).toContain('data-scroll-rail-snap="firm"')
    expect(page).toContain('data-scroll-rail-wheel="true"')
    expect(page).toContain('data-scroll-rail-scrollbar="hidden"')
  })

  it('Snap into view is an element option: the page-level controller ships only when used', async () => {
    const plain = await generator.generateProject(buildUidlWithScene(), template)
    expect(findFile(plain, 'components', 'tq-snap-into-view')).toBeUndefined()

    const uidl = buildUidlWithScene()
    const indexPage = (uidl.root.node.content.children || []).find(
      (child) =>
        child.type === 'conditional' && (child.content as { value?: string }).value === 'index'
    )
    const pageElement = (indexPage as { content: { node: { content: { children: unknown[] } } } })
      .content.node.content
    pageElement.children.push({
      type: 'element',
      content: {
        elementType: 'container',
        name: 'snapping-section',
        attrs: { 'data-snap-into-view': { type: 'static', content: 'true' } },
        children: [],
      },
    })
    const snapped = await generator.generateProject(uidl, template)
    const runtime = findFile(snapped, 'components', 'tq-snap-into-view')
    expect(runtime?.content).toContain('scroll-snap-type: y proximity')
    expect(runtime?.content).toContain("window.scrollBy({ top: delta, behavior: 'smooth' })")
    expect(runtime?.content).not.toContain('mandatory')
    const app = findFile(snapped, 'pages', '_app')
    expect(app?.content).toContain('<TqSnapIntoView />')
    const page = findFile(snapped, 'pages', 'index')
    expect(page?.content).toContain('data-snap-into-view="true"')
    expect(runtime?.content).toContain('firm: 1')
    expect(runtime?.content).toContain('="firm"]')
    expect(runtime?.content).not.toContain('mandatory')

    const firmUidl = buildUidlWithScene()
    const firmIndexPage = (firmUidl.root.node.content.children || []).find(
      (child) =>
        child.type === 'conditional' && (child.content as { value?: string }).value === 'index'
    )
    ;(
      firmIndexPage as { content: { node: { content: { children: unknown[] } } } }
    ).content.node.content.children.push({
      type: 'element',
      content: {
        elementType: 'container',
        name: 'firm-section',
        attrs: { 'data-snap-into-view': { type: 'static', content: 'firm' } },
        children: [],
      },
    })
    const firm = await generator.generateProject(firmUidl, template)
    expect(findFile(firm, 'components', 'tq-snap-into-view')).toBeDefined()
    expect(findFile(firm, 'pages', 'index')?.content).toContain('data-snap-into-view="firm"')
  })
})
