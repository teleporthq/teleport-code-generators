import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { ProjectType, ProjectUIDL, PublisherType } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { packProject } from '../src/index'

/**
 * Regression guard for the "Module not found: Can't resolve 'framer-motion'"
 * class of bug.
 *
 * `packProject` calls `cleanPlugins()` and rebuilds the Next project-plugin list
 * from scratch. That list used to be hand-duplicated from
 * createNextProjectGenerator, and the two drifted: the npm-backed widget
 * primitives (motion / qr-code / …) were dropped from packProject, so the
 * generated project shipped `components/tq-motion.js` (which imports
 * framer-motion) WITHOUT adding framer-motion to package.json — `next build`
 * then failed.
 *
 * Unlike the motion end2end test in teleport-project-generator-next (which goes
 * through createNextProjectGenerator directly), this test exercises the real
 * `packProject` entry point — the one the GUI/worker publish path uses — so a
 * future regression that drops a widget plugin from packProject is caught here.
 */
const outputPath = join(__dirname, 'packproject-widget-deps-tmp')
const projectSlug = 'motion-widget-app'

const MOTION_ELEMENT_NODE = {
  type: 'element',
  content: {
    elementType: 'motion-node',
    name: 'motion',
    attrs: {
      preset: { type: 'static', content: 'slide-up' },
      trigger: { type: 'static', content: 'in-view' },
    },
    children: [
      {
        type: 'element',
        content: {
          elementType: 'container',
          attrs: { id: { type: 'static', content: 'motion-inner-child' } },
          children: [] as unknown[],
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

afterAll(() => {
  rmSync(outputPath, { recursive: true, force: true })
})

describe('packProject registers npm deps for the widget primitives it emits', () => {
  it('adds framer-motion (and bumps react to 18) when the UIDL uses a motion node', async () => {
    const { success } = await packProject(buildUidlWithMotion(), {
      projectType: ProjectType.NEXT,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath, projectSlug },
    })
    expect(success).toBeTruthy()

    const projectRoot = join(outputPath, projectSlug)

    // The wrapper that imports framer-motion was emitted...
    const motionWrapper = join(projectRoot, 'components', 'tq-motion.js')
    expect(existsSync(motionWrapper)).toBe(true)
    expect(readFileSync(motionWrapper, 'utf8')).toContain("from 'framer-motion'")

    // ...so its dependency MUST be declared, otherwise `next build` cannot resolve it.
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
    expect(pkg.dependencies['framer-motion']).toBe('^11.18.0')
    expect(pkg.dependencies.react).toBe('^18.3.1')
    expect(pkg.dependencies['react-dom']).toBe('^18.3.1')
  })
})
