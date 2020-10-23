import uidlSample from '../../../../examples/test-samples/project-sample.json'
import uidlSampleWithGlobalStyleSheet from '../../../../examples/test-samples/project-with-import-global-styles.json'
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
import template from './mocks'
import { createStencilProjectGenerator } from '../../src'

describe('Preact Project Generator', () => {
  const generator = createStencilProjectGenerator()

  it('runs without crashing', async () => {
    const outputFolder = await generator.generateProject(uidlSample, template)
    const assetsPath = generator.getAssetsPath()

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(outputFolder.name).toBe('stencil')
    expect(outputFolder.files[1].name).toBe('package')

    const srcFolder = outputFolder.subFolders[0]
    const rootFiles = srcFolder.subFolders[0].files

    expect(outputFolder.files.length).toBe(2)
    expect(srcFolder.files[0].name).toBe('index')
    expect(srcFolder.files[0].fileType).toBe('html')
    expect(srcFolder.files[0].content).toContain('<script type="module" src="/build/app.esm.js">')
    expect(rootFiles[0].name).toBe('app-root')
    expect(rootFiles[0].fileType).toBe('tsx')
    expect(srcFolder.subFolders[0].name).toBe('components')
  })

  it('runs without crashing with global style sheet and added to stencil config', async () => {
    const outputFolder = await generator.generateProject(uidlSampleWithGlobalStyleSheet, template)
    const assetsPath = generator.getAssetsPath()

    const srcFolder = outputFolder.subFolders[0]
    const rootFiles = srcFolder.subFolders[0].files
    const stencilConfig = outputFolder.files[0]

    expect(assetsPath).toBeDefined()
    expect(outputFolder.files.length).toBe(2)
    expect(outputFolder.name).toBe(template.name)
    expect(outputFolder.name).toBe('stencil')
    expect(outputFolder.files[1].name).toBe('package')
    expect(stencilConfig.name).toBe('stencil.config')
    expect(stencilConfig.fileType).toBe('ts')

    expect(srcFolder.files[0].name).toBe('style')
    expect(srcFolder.files[0].fileType).toBe('css')
    expect(srcFolder.files[1].name).toBe('index')
    expect(srcFolder.files[1].fileType).toBe('html')
    expect(srcFolder.files[1].content).toContain('<script type="module" src="/build/app.esm.js">')
    expect(rootFiles[0].name).toBe('app-root')
    expect(rootFiles[0].fileType).toBe('tsx')
    expect(srcFolder.subFolders[0].name).toBe('components')
  })

  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample, template)

    await expect(result).rejects.toThrow(Error)
  })
})
