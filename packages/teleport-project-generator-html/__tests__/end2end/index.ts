import uidlSample from '../../../../examples/uidl-samples/simple-html.json'
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
import { createHTMLProjectGenerator } from '../../src'
import HTMLTemplate from '../../src/project-template'
import { FileType } from '@teleporthq/teleport-types'

describe('Html Project Generator', () => {
  const generator = createHTMLProjectGenerator()

  it('runs without crasing', async () => {
    const { name, files, subFolders } = await generator.generateProject(uidlSample, HTMLTemplate)
    const pages = subFolders[0]?.subFolders.find((folder) => folder.name === 'pages')
    const aboutPage = pages.files.find(
      (page) => page.name === 'about' && page.fileType === FileType.HTML
    )

    expect(name).toBe('teleport-project-html')
    expect(files.length).toBe(1)
    expect(files[0].content).toContain('start')
    expect(subFolders.length).toBe(1)
    expect(aboutPage.content).toContain('head')
    expect(aboutPage.content).toContain('html')
  })

  it('run withut crashing and appends entry things into single index.html', async () => {
    const singularGenerator = createHTMLProjectGenerator({ individualEntyFile: false })
    const { name, files, subFolders } = await singularGenerator.generateProject(
      uidlSample,
      HTMLTemplate
    )
    const pages = subFolders[0]?.subFolders.find((folder) => folder.name === 'pages')
    const aboutPage = pages.files.find(
      (page) => page.name === 'about' && page.fileType === FileType.HTML
    )

    expect(name).toBe('teleport-project-html')
    expect(files.length).toBe(1)
    expect(subFolders.length).toBe(2)
    expect(aboutPage.content).not.toContain('head')
    expect(aboutPage.content).not.toContain('html')
  })

  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample, HTMLTemplate)
    await expect(result).rejects.toThrow(Error)
  })
})
