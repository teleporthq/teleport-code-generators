// @ts-ignore
import uidlSample from '../../../../examples/test-samples/project-sample.json'
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
import template from './template-definition.json'
import { createGatsbyProjectGenerator } from '../../src'
import { FileType, ReactStyleVariation } from '@teleporthq/teleport-types'

describe('Gatsby Project Generator', () => {
  const generator = createGatsbyProjectGenerator()

  it('runs without crashing', async () => {
    const outputFolder = await generator.generateProject(uidlSample, template)
    const assetsPath = generator.getAssetsPath()

    const srcFolder = outputFolder.subFolders[0]
    const pagesFolder = srcFolder.subFolders[1]
    const componentsFolder = srcFolder.subFolders[2]

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(outputFolder.files[0].name).toBe('package')
    expect(srcFolder.files[0].name).toBe('html')
    expect(srcFolder.files[0].fileType).toBe(FileType.JS)
    expect(srcFolder.files[0].content).toBeDefined()
    expect(pagesFolder.name).toBe('pages')
    expect(pagesFolder.files.length).toBeGreaterThan(0)
    expect(componentsFolder.files.length).toBeGreaterThan(0)
    expect(componentsFolder.name).toBe('components')
  })

  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample, template)

    await expect(result).rejects.toThrow(Error)
  })

  it('throws error when conifg file is not found with custom framework config', async () => {
    const generatorGatsbyStyledComponents = createGatsbyProjectGenerator({
      variation: ReactStyleVariation.StyledComponents,
    })
    const result = generatorGatsbyStyledComponents.generateProject(invalidUidlSample, template)

    await expect(result).rejects.toThrow(Error)
  })
})
