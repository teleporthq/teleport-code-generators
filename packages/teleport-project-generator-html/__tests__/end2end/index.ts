import uidlSample from '../../../../examples/uidl-samples/tests.json'
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
import projectWithSlot from '../../../../examples/test-samples/project-with-slot.json'
import {
  createHTMLProjectGenerator,
  pluginCloneGlobals,
  pluginHomeReplace,
  pluginSnapIntoView,
  pluginScrollRail,
} from '../../src'
import HTMLTemplate from '../../src/project-template'
import { FileType } from '@teleporthq/teleport-types'

describe('Html Project Generator', () => {
  it('runs without crasing', async () => {
    const generator = createHTMLProjectGenerator()
    generator.addPlugin(pluginHomeReplace)
    generator.addPlugin(pluginCloneGlobals)

    generator.setAssets({
      mappings: {
        'kitten.png': '',
      },
      identifier: 'playground_assets',
      prefix: 'public',
    })
    const { name, files, subFolders } = await generator.generateProject(uidlSample, HTMLTemplate)
    const aboutPage = files.find((page) => page.name === 'about' && page.fileType === FileType.HTML)
    const aboutCSS = files.find((page) => page.name === 'about' && page.fileType === FileType.CSS)

    expect(name).toBe('teleport-project-html')
    expect(files.length).toBe(8)
    expect(subFolders.length).toBe(1)
    expect(aboutPage).toBeDefined()
    expect(aboutPage?.content).toContain('head')
    expect(aboutPage?.content).toContain('html')
    expect(aboutPage?.content).toContain('public/playground_assets/kitten.png')
    expect(aboutCSS?.content).toContain('public/playground_assets/kitten.png')
  })

  it('run without crashing and appends entry things into single index.html', async () => {
    const singularGenerator = createHTMLProjectGenerator()
    singularGenerator.addPlugin(pluginHomeReplace)

    singularGenerator.setAssets({
      mappings: {
        'kitten.png': '',
      },
      identifier: 'playground_assets',
      prefix: 'public',
    })
    const { name, files, subFolders } = await singularGenerator.generateProject(
      uidlSample,
      HTMLTemplate
    )
    const aboutPage = files.find((page) => page.name === 'about' && page.fileType === FileType.HTML)
    const aboutCSS = files.find((page) => page.name === 'about' && page.fileType === FileType.CSS)

    expect(name).toBe('teleport-project-html')
    expect(files.length).toBe(9)
    expect(subFolders.length).toBe(1)
    expect(aboutPage?.content).not.toContain('<head>')
    expect(aboutPage?.content).not.toContain('<html>')
    expect(aboutPage?.content).toContain('public/playground_assets/kitten.png')
    expect(aboutCSS?.content).toContain('public/playground_assets/kitten.png')
  })

  it('creates a next project and generates the named-slot for passing components', async () => {
    const generator = createHTMLProjectGenerator()
    const { subFolders, files } = await generator.generateProject(uidlSample)
    const components = subFolders.find((folder) => folder.name === 'components')
    const heroComponent = components?.files.find(
      (file) => file.name === 'hero' && file.fileType === FileType.HTML
    )
    const indexFile = files.find((file) => file.name === 'index' && file.fileType === FileType.HTML)

    expect(heroComponent).toBeDefined()
    expect(indexFile?.content).toContain(`This is amazing, because this is a named-slot`)
  })

  it('Snap into view: the native snap rule ships only when an element opts in', async () => {
    const plain = createHTMLProjectGenerator()
    plain.addPlugin(pluginSnapIntoView)
    const untouched = await plain.generateProject(uidlSample, HTMLTemplate)
    untouched.files.forEach((file) => expect(file.content).not.toContain('scroll-snap-type'))

    const uidl = JSON.parse(JSON.stringify(uidlSample))
    const about = uidl.root.node.content.children.find(
      (child: { content: { value?: string } }) => child.content.value === 'About'
    )
    about.content.node.content.attrs = {
      ...(about.content.node.content.attrs || {}),
      'data-snap-into-view': { type: 'static', content: 'firm' },
    }
    const generator = createHTMLProjectGenerator()
    generator.addPlugin(pluginSnapIntoView)
    const snapped = await generator.generateProject(uidl, HTMLTemplate)

    const globalCss = snapped.files.find(
      (file) => file.name === 'style' && file.fileType === FileType.CSS
    )
    const aboutPage = snapped.files.find(
      (file) => file.name === 'about' && file.fileType === FileType.HTML
    )
    const rulesCarrier = globalCss ? globalCss.content : aboutPage?.content || ''
    expect(rulesCarrier).toContain('scroll-snap-type: y proximity')
    expect(rulesCarrier).toContain('[data-snap-into-view="firm"]')
    expect(rulesCarrier).toContain('[data-snap-into-view="gentle"]')
    expect(rulesCarrier).not.toContain('mandatory')
    expect(aboutPage?.content).toContain('data-snap-into-view="firm"')
  })

  it('Scroll rail: CSS in the global stylesheet, the wheel script per page, only when used', async () => {
    const plain = createHTMLProjectGenerator()
    plain.addPlugin(pluginScrollRail)
    const untouched = await plain.generateProject(uidlSample, HTMLTemplate)
    untouched.files.forEach((file) => {
      expect(file.content).not.toContain('scroll-snap-type: x')
      expect(file.content).not.toContain('data-scroll-rail-wheel')
    })

    const uidl = JSON.parse(JSON.stringify(uidlSample))
    const about = uidl.root.node.content.children.find(
      (child: { content: { value?: string } }) => child.content.value === 'About'
    )
    about.content.node.content.attrs = {
      ...(about.content.node.content.attrs || {}),
      'data-scroll-rail-snap': { type: 'static', content: 'gentle' },
      'data-scroll-rail-wheel': { type: 'static', content: 'true' },
    }
    const generator = createHTMLProjectGenerator()
    generator.addPlugin(pluginScrollRail)
    const railed = await generator.generateProject(uidl, HTMLTemplate)

    const globalCss = railed.files.find(
      (file) => file.name === 'style' && file.fileType === FileType.CSS
    )
    const aboutPage = railed.files.find(
      (file) => file.name === 'about' && file.fileType === FileType.HTML
    )
    const rulesCarrier = globalCss ? globalCss.content : aboutPage?.content || ''
    expect(rulesCarrier).toContain('scroll-snap-type: x proximity')
    expect(rulesCarrier).toContain('scroll-snap-align: start')
    expect(aboutPage?.content).toContain('data-scroll-rail-snap="gentle"')
    expect(aboutPage?.content).toContain("addEventListener('wheel'")
  })

  it('throws error when invalid UIDL sample is used', async () => {
    const generator = createHTMLProjectGenerator()
    const result = generator.generateProject(invalidUidlSample, HTMLTemplate)
    await expect(result).rejects.toThrow(Error)
  })
})

describe('Unwinds the slot inside the component when used in page', () => {
  it('runs without crashing', async () => {
    const generator = createHTMLProjectGenerator()
    generator.addPlugin(pluginHomeReplace)
    generator.addPlugin(pluginCloneGlobals)

    generator.setAssets({
      mappings: {},
      identifier: 'playground_assets',
    })
    const result = await generator.generateProject(projectWithSlot, HTMLTemplate)
    const indexFile = result.files.find(
      (file) => file.name === 'index' && file.fileType === FileType.HTML
    )
    const cssFile = result.files.find(
      (file) => file.name === 'index' && file.fileType === FileType.CSS
    )

    expect(indexFile).toBeDefined()
    expect(indexFile?.content).toContain(`app-component-image`)
    expect(indexFile?.content).toContain(`app-component-image1`)
    expect(cssFile).toBeDefined()
    expect(cssFile?.content).toContain(`.app-component-image`)
    expect(cssFile?.content).toContain(`.app-component-image1`)
  })
})
