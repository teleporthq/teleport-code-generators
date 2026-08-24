import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

// A Scroll Scene with a scrub video inside — mirrors what the GUI's
// scrollVideoNodeToUIDL emits (elementType 'scroll-video-node', camelCase
// props, no children).
const SCENE_WITH_VIDEO_NODE = {
  type: 'element',
  content: {
    elementType: 'scroll-scene-node',
    name: 'scene',
    attrs: {
      sceneLength: { type: 'static', content: '400vh' },
      pin: { type: 'static', content: true },
    },
    children: [
      {
        type: 'element',
        content: {
          elementType: 'scroll-video-node',
          name: 'scrub-clip',
          attrs: {
            src: { type: 'static', content: 'https://cdn.example.com/scrub.mp4' },
            poster: { type: 'static', content: 'https://cdn.example.com/poster.jpg' },
            windowStart: { type: 'static', content: 25 },
            windowEnd: { type: 'static', content: 75 },
            smoothing: { type: 'static', content: 0.2 },
          },
          children: [],
        },
      },
    ],
  },
}

const buildUidl = (): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  const indexPage = (uidl.root.node.content.children || []).find(
    (child) =>
      child.type === 'conditional' && (child.content as { value?: string }).value === 'index'
  )
  const pageElement = (indexPage as { content: { node: { content: { children: unknown[] } } } })
    .content.node.content
  pageElement.children.push(SCENE_WITH_VIDEO_NODE)
  return uidl
}

const findFile = (folder: GeneratedFolder, folderName: string, fileName: string) =>
  folder.subFolders
    .find((sub) => sub.name === folderName)
    ?.files.find((file) => file.name === fileName)

describe('Next generator with a Scroll Video element', () => {
  const generator = createNextProjectGenerator()

  it('renders <TqScrollVideo> with its camelCase props on the page', async () => {
    const outputFolder = await generator.generateProject(buildUidl(), template)

    const indexPage = findFile(outputFolder, 'pages', 'index')
    expect(indexPage?.content).toContain('TqScrollVideo')
    expect(indexPage?.content).toContain('https://cdn.example.com/scrub.mp4')
    expect(indexPage?.content).toContain('windowStart')
  })

  it('emits the pure-DOM tq-scroll-video wrapper with the scrub runtime', async () => {
    const outputFolder = await generator.generateProject(buildUidl(), template)

    const wrapper = findFile(outputFolder, 'components', 'tq-scroll-video')
    expect(wrapper).toBeDefined()
    const content = wrapper?.content as string
    // No animation library — plain DOM scrubbing.
    expect(content).not.toContain('framer-motion')
    // Scene discovery + pin inference.
    expect(content).toContain("closest('[data-scene-track]')")
    expect(content).toContain("position === 'sticky'")
    // Seek machinery: metadata replay, reduced motion, inline muted playback.
    expect(content).toContain('loadedmetadata')
    expect(content).toContain('prefers-reduced-motion')
    expect(content).toContain('playsInline')
    expect(content).toContain('currentTime')
    expect(content).toContain('export default TqScrollVideo')
  })

  it('the wrapper carries NO inline position — the authored backdrop class must win', async () => {
    const outputFolder = await generator.generateProject(buildUidl(), template)

    const wrapper = findFile(outputFolder, 'components', 'tq-scroll-video')
    const content = wrapper?.content as string
    // A scene BACKGROUND is position:absolute + inset:0 via its generated CSS
    // class. Inline style beats class, so an inline position here collapsed
    // the backdrop to a 0px-tall in-flow div: the video was in the JSX, the
    // URL served, and the page showed nothing. contain:'layout' alone keeps
    // the wrapper the containing block for the absolute <video> inside it.
    expect(content).toContain("style={{ overflow: 'hidden', ...(style || {}), contain: 'layout' }}")
    expect(content).not.toContain("position: 'relative'")
  })

  it('the scene wrapper stamps data-scene-track so the video can find it', async () => {
    const outputFolder = await generator.generateProject(buildUidl(), template)

    const scene = findFile(outputFolder, 'components', 'tq-scroll-scene')
    expect(scene?.content).toContain('data-scene-track')
  })
})
