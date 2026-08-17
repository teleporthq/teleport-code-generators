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
    // Sticky pinning + track sizing.
    expect(code).toContain("position: 'sticky'")
    expect(code).toContain('normalizeSceneLength')
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
})
