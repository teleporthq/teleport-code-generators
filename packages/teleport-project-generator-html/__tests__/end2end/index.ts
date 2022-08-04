import uidlSample from '../../../../examples/uidl-samples/project.json'
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
import { createHTMLProjectGenerator } from '../../src'
import HTMLTemplate from '../../src/project-template'
import { FileType } from '@teleporthq/teleport-types'

describe('Html Project Generator', () => {
  const generator = createHTMLProjectGenerator()

  it('runs without crasing', async () => {
    const { name, files, subFolders } = await generator.generateProject(uidlSample, HTMLTemplate)
    const aboutPage = files.find((page) => page.name === 'about' && page.fileType === FileType.HTML)
    const aboutCSS = files.find((page) => page.name === 'about' && page.fileType === FileType.CSS)

    expect(name).toBe('teleport-project-html')
    expect(files.length).toBe(8)
    expect(subFolders.length).toBe(1)
    expect(aboutPage.content).toContain('head')
    expect(aboutPage.content).toContain('html')
    expect(aboutPage.content).toContain('public/playground_assets/kitten.png')
    expect(aboutCSS.content).toContain('public/playground_assets/kitten.png')
  })

  it('run withut crashing and appends entry things into single index.html', async () => {
    const singularGenerator = createHTMLProjectGenerator({ individualEntyFile: false })
    const { name, files, subFolders } = await singularGenerator.generateProject(
      uidlSample,
      HTMLTemplate
    )
    const aboutPage = files.find((page) => page.name === 'about' && page.fileType === FileType.HTML)
    const aboutCSS = files.find((page) => page.name === 'about' && page.fileType === FileType.CSS)

    expect(name).toBe('teleport-project-html')
    expect(files.length).toBe(9)
    expect(subFolders.length).toBe(1)
    expect(aboutPage.content).not.toContain('<head>')
    expect(aboutPage.content).not.toContain('<html>')
    expect(aboutPage.content).toContain('public/playground_assets/kitten.png')
    expect(aboutCSS.content).toContain('public/playground_assets/kitten.png')
  })

  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample, HTMLTemplate)
    await expect(result).rejects.toThrow(Error)
  })
})
