// @ts-ignore
import uidlSample from '../../../../examples/test-samples/project-sample.json'
// @ts-ignore
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
// @ts-ignore
import template from './template-definition.json'
import { createStencilProjectGenerator } from '../../src'
import { ProjectUIDL } from '@teleporthq/teleport-types'

const projectUIDL = uidlSample as ProjectUIDL

describe('Preact Project Generator', () => {
  const generator = createStencilProjectGenerator()

  it('runs without crashing', async () => {
    const outputFolder = await generator.generateProject(projectUIDL, template)
    const assetsPath = generator.getAssetsPath()

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(outputFolder.files[0].name).toBe('package')

    const srcFolder = outputFolder.subFolders[0]
    const rootFiles = srcFolder.subFolders[0].files

    expect(srcFolder.files[0].name).toBe('index')
    expect(srcFolder.files[0].fileType).toBe('html')
    expect(srcFolder.files[0].content).toContain('<script type="module" src="/build/app.esm.js">')
    expect(rootFiles[0].name).toBe('app-root')
    expect(rootFiles[0].fileType).toBe('tsx')
    expect(srcFolder.subFolders[0].name).toBe('components')
  })

  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample, template)

    await expect(result).rejects.toThrow(Error)
  })
})
