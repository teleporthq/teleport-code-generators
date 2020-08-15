// @ts-ignore
import uidlSample from '../../../../examples/test-samples/project-sample.json'
// @ts-ignore
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
// @ts-ignore
import uidlSampleWithoutProjectStyleesButImports from './project-with-import-without-global-styles.json'
// @ts-ignore
import template from './template-definition.json'
import { createNextProjectGenerator } from '../../src'

describe('React Next Project Generator', () => {
  const generator = createNextProjectGenerator()

  it('runs without crashing and adding external imports to _app.js', async () => {
    const outputFolder = await generator.generateProject(
      uidlSampleWithoutProjectStyleesButImports,
      template
    )
    const assetsPath = generator.getAssetsPath()

    const publicFolder = outputFolder.subFolders.find((folder) => folder.name === 'pages')
    const appFile = publicFolder.files.find((file) => file.name === '_app')

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(outputFolder.files[0].name).toBe('package')
    expect(appFile).toBeDefined()
    expect(appFile.content).toContain(`import "antd/dist/antd.css`)
    expect(appFile.content).not.toContain(`import './style.css'`)
  })

  it('runs without crashing', async () => {
    const outputFolder = await generator.generateProject(uidlSample, template)
    const assetsPath = generator.getAssetsPath()

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(outputFolder.files[0].name).toBe('package')

    const components = outputFolder.subFolders[0]
    const pages = outputFolder.subFolders[1]

    expect(components.files[0].name).toBe('one-component')
    expect(pages.files[0].name).toBe('index')
    expect(pages.files[1].name).toBe('about')
  })
  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample, template)

    await expect(result).rejects.toThrow(Error)
  })
})
