import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

// The production template (react ^17) — the same one the GUI publish path feeds
// into packProject, so the react bump is asserted against real deps.
const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

// A Motion CONTAINER wrapping a child — mirrors what the GUI's motionNodeToUIDL
// emits (elementType 'motion-node', camelCase props, children preserved).
const MOTION_ELEMENT_NODE = {
  type: 'element',
  content: {
    elementType: 'motion-node',
    name: 'motion',
    attrs: {
      preset: { type: 'static', content: 'slide-up' },
      trigger: { type: 'static', content: 'in-view' },
      stagger: { type: 'static', content: 0.08 },
    },
    children: [
      {
        type: 'element',
        content: {
          elementType: 'container',
          attrs: { id: { type: 'static', content: 'motion-inner-child' } },
          children: [],
        },
      },
    ],
  },
}

const buildUidlWithMotion = (): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  const indexPage = (uidl.root.node.content.children || []).find(
    (child) =>
      child.type === 'conditional' && (child.content as { value?: string }).value === 'index'
  )
  const pageElement = (indexPage as { content: { node: { content: { children: unknown[] } } } })
    .content.node.content
  pageElement.children.push(MOTION_ELEMENT_NODE)
  return uidl
}

const findFile = (folder: GeneratedFolder, folderName: string, fileName: string) =>
  folder.subFolders
    .find((sub) => sub.name === folderName)
    ?.files.find((file) => file.name === fileName)

describe('Next generator with a Motion element', () => {
  const generator = createNextProjectGenerator()

  it('renders <TqMotion> wrapping its children, ships the wrapper and bumps react', async () => {
    const outputFolder = await generator.generateProject(buildUidlWithMotion(), template)

    // The page imports and renders TqMotion, wrapping the child (not self-closing).
    const indexPage = findFile(outputFolder, 'pages', 'index')
    expect(indexPage?.content).toContain('TqMotion')
    expect(indexPage?.content).toContain('preset')
    expect(indexPage?.content).toMatch(/<TqMotion[\s\S]*motion-inner-child[\s\S]*<\/TqMotion>/)

    // The local wrapper component is emitted and uses framer-motion.
    const component = findFile(outputFolder, 'components', 'tq-motion')
    expect(component?.content).toContain("from 'framer-motion'")
    expect(component?.content).toContain('{children}')

    // framer-motion is added and react is bumped to 18 (next left on its caret).
    const packageFile = outputFolder.files.find((file) => file.name === 'package')
    const packageJson = JSON.parse(packageFile?.content || '{}')
    expect(packageJson.dependencies['framer-motion']).toBe('^11.18.0')
    expect(packageJson.dependencies.react).toBe('^18.3.1')
    expect(packageJson.dependencies['react-dom']).toBe('^18.3.1')
    expect(packageJson.dependencies.next).toBe('^12.1.10')

    // A root .npmrc (legacy-peer-deps) ships so the React-18 bump survives
    // template deps with React-17-only peer ranges (e.g. dangerous-html embeds).
    const npmrc = outputFolder.files.find((file) => file.name === '.npmrc')
    expect(npmrc?.content).toContain('legacy-peer-deps=true')
  })

  it('scroll trigger interpolates the FULL from/to state (canvas parity), with scrub + offset support', async () => {
    const outputFolder = await generator.generateProject(buildUidlWithMotion(), template)
    const component = findFile(outputFolder, 'components', 'tq-motion')
    const code = component?.content || ''

    // The scroll path writes the whole interpolated state (transform families,
    // opacity, filter) to the element — the historical y-only parallax is gone.
    expect(code).toContain('applyScrollState')
    expect(code).toContain('useMotionValueEvent')
    expect(code).not.toContain('parallaxY')
    expect(code).toMatch(/TRANSFORM_KEYS = \['x', 'y', 'scale', 'rotate'\]/)

    // Scrub smoothing and the scroll-offset windows are wired.
    expect(code).toContain('useSpring')
    expect(code).toContain('SCROLL_OFFSET_RANGES')
    for (const preset of ['pass', 'contained', 'enter', 'exit']) {
      expect(code).toContain(preset)
    }

    // Blur interpolation mirrors the canvas runtime's BLUR_RE handling.
    expect(code).toContain('blur(')
  })

  // A site with a page transition wraps every page in an AnimatePresence with
  // initial={false}, which skips the mount animation of every motion component
  // under it. A row that loops by itself (trigger load, repeat -1) never started
  // on the generated site, and stood parked at its end state (2026-10-03).
  it('starts a load animation from a flag set after mount, so a page transition cannot skip it', async () => {
    const outputFolder = await generator.generateProject(buildUidlWithMotion(), template)
    const component = findFile(outputFolder, 'components', 'tq-motion')
    const code = component?.content || ''

    expect(code).toContain('animate: played ? toVars : fromVars')
    expect(code).toContain(
      'buildAnimProps(trigger, fromVars, toVars, transition, revealed, played)'
    )
    expect(code).not.toContain(
      "case 'load':\n      return { initial: fromVars, animate: toVars, transition }"
    )
  })

  // Vlad, 2026-10-03: for a visitor who asks for less motion a row that slides
  // by itself stands still and can be swiped, so every item stays reachable.
  it('lets a row that slides by itself be swiped when the visitor asks for less motion', async () => {
    const outputFolder = await generator.generateProject(buildUidlWithMotion(), template)
    const code = findFile(outputFolder, 'components', 'tq-motion')?.content || ''

    expect(code).toContain('const letMarqueeSwipe = (track) => {')
    expect(code).toContain("frame.style.overflowX = 'auto'")
    expect(code).toContain(
      'React.useEffect(() => {\n    if (still) {\n      letMarqueeSwipe(ref.current)'
    )
  })

  // The server cannot know that a visitor asks for less motion and renders the
  // animated element with its starting style. A first render that drew the still
  // element instead left that style in place: every entrance stayed invisible for
  // those visitors (2026-10-03, React keeps server markup it disagrees with).
  it('draws the still element for less motion only once the page is mounted', async () => {
    const outputFolder = await generator.generateProject(buildUidlWithMotion(), template)
    const code = findFile(outputFolder, 'components', 'tq-motion')?.content || ''

    expect(code).toContain('React.useEffect(() => setMounted(true), [])')
    expect(code).toContain('const still = mounted && Boolean(shouldReduceMotion)')
    expect(code).toContain(
      'if (still) {\n    return (\n      <div ref={ref} style={wrapperStyle} {...rest}>'
    )
    expect(code).not.toContain('if (shouldReduceMotion) {\n    return (')
  })
})
