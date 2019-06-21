// @ts-ignore
import uidlSample from '../../../../examples/test-samples/project-sample.json'
// @ts-ignore
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
// @ts-ignore
import template from './template-definition.json'
import { createReactBasicGenerator } from '../../src'
import { ProjectUIDL } from '@teleporthq/teleport-types'

const projectUIDL = uidlSample as ProjectUIDL

describe('React Basic Project Generator', () => {
  const generator = createReactBasicGenerator()

  it('runs without crashing', async () => {
    const outputFolder = await generator.generateProject(projectUIDL, template)
    const assetsPath = generator.getAssetsPath()

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(outputFolder.files[0].name).toBe('package')

    const srcFolder = outputFolder.subFolders[0]

    expect(srcFolder.files[0].name).toBe('index')
    expect(srcFolder.files[0].fileType).toBe('js')
    expect(srcFolder.files[1].name).toBe('index')
    expect(srcFolder.files[1].fileType).toBe('html')
    expect(srcFolder.subFolders[0].name).toBe('components')
    expect(srcFolder.subFolders[1].name).toBe('pages')
  })
  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample, template)

    await expect(result).rejects.toThrow(Error)
  })
})
