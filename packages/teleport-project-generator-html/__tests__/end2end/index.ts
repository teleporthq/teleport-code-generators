import uidlSample from '../../../../examples/uidl-samples/project.json'
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
import projectWithSlot from '../../../../examples/test-samples/project-with-slot.json'
import { createHTMLProjectGenerator, pluginCloneGlobals, pluginHomeReplace } from '../../src'
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

  it('run withut crashing and appends entry things into single index.html', async () => {
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
    expect(indexFile?.content).toContain(`app-component-image1`)
    expect(indexFile?.content).toContain(`app-component-image2`)
    expect(cssFile).toBeDefined()
    expect(cssFile?.content).toContain(`.app-component-image2`)
    expect(cssFile?.content).toContain(`.app-component-image1`)
  })
})
