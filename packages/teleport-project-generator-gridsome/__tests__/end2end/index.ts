// @ts-ignore
import uidlSample from '../../../../examples/test-samples/project-sample.json'
// @ts-ignore
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
// @ts-ignore
import template from './template-definition.json'
import { createGridsomeProjectGenerator } from '../../src'

describe('Gridsome Project Generator', () => {
  const generator = createGridsomeProjectGenerator()

  it('runs without crashing', async () => {
    const outputFolder = await generator.generateProject(uidlSample, template)
    const assetsPath = generator.getAssetsPath()

    const srcFolder = outputFolder.subFolders[0]

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(srcFolder.files[0].name).toBe('main')
    expect(srcFolder.files[0].fileType).toBe('js')
  })
  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample, template)

    await expect(result).rejects.toThrow(Error)
  })
})
