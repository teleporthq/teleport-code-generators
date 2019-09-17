// @ts-ignore
import uidlSample from '../../../../examples/test-samples/project-sample.json'
// @ts-ignore
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
// @ts-ignore
import template from './template-definition.json'
import { createAngularProjectGenerator } from '../../src'
import { FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

describe('React Next Project Generator', () => {
  const generator = createAngularProjectGenerator()

  it('runs without crashing', async () => {
    const outputFolder = await generator.generateProject(uidlSample, template)
    const assetsPath = generator.getAssetsPath()

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(outputFolder.files[0].name).toBe('package')

    const srcFolder = outputFolder.subFolders[0]
    const appFolder = srcFolder.subFolders[0]
    const pagesFolder = appFolder.subFolders[0]
    const componentsFolder = appFolder.subFolders[1]

    expect(srcFolder.files[0].fileType).toBe(FILE_TYPE.HTML)
    expect(srcFolder.files[0].content).toBeDefined()
    expect(appFolder.files[0].name).toBe('app.module')
    expect(appFolder.files[0].fileType).toBe(FILE_TYPE.TS)
    expect(appFolder.files[0].content).toBeDefined()
    expect(componentsFolder.name).toBe('components')
    expect(componentsFolder.files[0].name).toBe('components.module')
    expect(componentsFolder.files[0].content).toBeDefined()
    expect(componentsFolder.subFolders.length).toBeGreaterThan(0)
    expect(pagesFolder.name).toBe('pages')
    expect(pagesFolder.subFolders.length).toBeGreaterThan(0)
  })

  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample, template)

    await expect(result).rejects.toThrow(Error)
  })
})
