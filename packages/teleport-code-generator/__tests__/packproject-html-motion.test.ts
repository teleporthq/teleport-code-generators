import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { ProjectType, ProjectUIDL, PublisherType } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/uidl-samples/tests.json'
import { packProject } from '../src/index'

/**
 * The HTML download goes through `packProject`, which clears the generator's
 * plugins and lists the HTML ones by hand. A behaviour plugin that is only
 * registered on the generator factory never runs for a real download, so the
 * motion runtime is checked here, on the path the editor's download uses.
 */
const outputPath = join(__dirname, 'packproject-html-motion-tmp')
const projectSlug = 'motion-html-site'

const SCENE = {
  type: 'element',
  content: {
    elementType: 'scroll-scene-node',
    name: 'story',
    attrs: { sceneLength: { type: 'static', content: '300vh' } },
    children: [
      {
        type: 'element',
        content: {
          elementType: 'container',
          attrs: { 'data-scroll-bind': { type: 'static', content: 'rise-in' } },
          children: [] as unknown[],
        },
      },
    ],
  },
}

afterAll(() => {
  rmSync(outputPath, { recursive: true, force: true })
})

describe('packProject, HTML: a downloaded site plays its motion', () => {
  it('writes the runtime file next to the stylesheet, links it from the pages and carries the page transition', async () => {
    const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
    const firstPage = (uidl.root.node.content.children || [])[0] as {
      content: { node: { content: { children: unknown[] } } }
    }
    firstPage.content.node.content.children.push(SCENE)
    ;(uidl.globals.settings as Record<string, unknown>).pageTransition = {
      preset: 'slide-left',
      duration: 0.3,
      easing: 'ease-out',
    }

    const { success } = await packProject(uidl, {
      projectType: ProjectType.HTML,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath, projectSlug },
    })
    expect(success).toBeTruthy()

    const root = join(outputPath, projectSlug)
    expect(existsSync(join(root, 'tq-motion.js'))).toBe(true)
    const home = readFileSync(join(root, 'index.html'), 'utf8')
    expect(home).toContain('data-scene-stage="true"')
    expect(home).toContain('<script defer src="./tq-motion.js"></script>')
    const css = readFileSync(join(root, 'style.css'), 'utf8')
    expect(css).toContain('position: sticky !important;')
    // the site's page transition travels too, with the back-button script in the page head
    expect(css).toContain('@view-transition')
    expect(home).toContain("root.setAttribute('data-tq-nav', 'back')")
  })
})
