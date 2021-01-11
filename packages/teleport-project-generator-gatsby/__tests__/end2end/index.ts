import { FileType, ReactStyleVariation } from '@teleporthq/teleport-types'
import uidlSample from '../../../../examples/test-samples/project-sample.json'
import uidlSampleWithExternalDependencies from '../../../../examples/test-samples/project-sample-with-dependency.json'
import uidlSampleWithJustTokens from '../../../../examples/test-samples/project-with-only-tokens.json'
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
import template from './mocks'
import { createGatsbyProjectGenerator } from '../../src'

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

  it('runs without crashing with external dependencies', async () => {
    const outputFolder = await generator.generateProject(
      uidlSampleWithExternalDependencies,
      template
    )
    const assetsPath = generator.getAssetsPath()

    const srcFolder = outputFolder.subFolders[0]
    const pagesFolder = srcFolder.subFolders[1]
    const componentsFolder = srcFolder.subFolders[2]

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(outputFolder.files[0].name).toBe('package')
    expect(outputFolder.files[0].content).toContain(`"antd": "4.5.4"`)
    expect(srcFolder.files[0].name).toBe('html')
    expect(srcFolder.files[0].fileType).toBe(FileType.JS)
    expect(srcFolder.files[0].content).toBeDefined()
    expect(pagesFolder.name).toBe('pages')
    expect(pagesFolder.files.length).toBeGreaterThan(0)
    expect(componentsFolder.files.length).toBeGreaterThan(0)
    expect(componentsFolder.name).toBe('components')

    /*
     * Imports like css imports / or imports which are just inserted,
     * are added in index file in pages
     */
    expect(pagesFolder.files[0].content).toContain(`import 'antd/dist/antd.css'`)
  })

  it('runs without crashing and using only tokens', async () => {
    const result = await generator.generateProject(uidlSampleWithJustTokens, template)
    const srcFolder = result.subFolders.find((folder) => folder.name === 'src')
    const styleSheet = srcFolder.files.find(
      (file) => file.name === 'style.module' && file.fileType === FileType.CSS
    )

    expect(styleSheet).toBeDefined()
    expect(styleSheet.content).toContain(`--greys-500: #595959`)
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

describe('Gatsby Project Generator with Styled Components', () => {
  const generator = createGatsbyProjectGenerator({
    variation: ReactStyleVariation.StyledComponents,
  })

  it('runs without crashing', async () => {
    const outputFolder = await generator.generateProject(uidlSample, template)
    const assetsPath = generator.getAssetsPath()

    const srcFolder = outputFolder.subFolders[0]
    const pagesFolder = srcFolder.subFolders[1]
    const componentsFolder = srcFolder.subFolders[2]
    const gatsbyConfigFile = outputFolder.files.find((file) => file.name === 'gatsby-config')

    expect(gatsbyConfigFile).toBeDefined()
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

  it('runs without crashing and using only tokens', async () => {
    const result = await generator.generateProject(uidlSampleWithJustTokens, template)
    const srcFolder = result.subFolders.find((folder) => folder.name === 'src')
    const styleSheet = srcFolder.files.find(
      (file) => file.name === 'style' && file.fileType === FileType.JS
    )

    expect(styleSheet).toBeDefined()
    expect(styleSheet.content).toContain(`Greys700: '#999999'`)
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
