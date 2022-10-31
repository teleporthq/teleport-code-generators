import uidlSample from '../../../../examples/test-samples/project-sample.json'
import fallbackUidlSample from '../../../../examples/uidl-samples/project.json'
import uidlSampleWithExternalDependency from '../../../../examples/test-samples/project-sample-with-dependency.json'
import uidlWithProjectStyleSheet from '../../../../examples/test-samples/project-with-import-global-styles.json'
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
import template from './template-definition.json'
import { createGridsomeProjectGenerator } from '../../src'

describe('Gridsome Project Generator', () => {
  const generator = createGridsomeProjectGenerator()

  it('runs without crashing', async () => {
    const outputFolder = await generator.generateProject(uidlSample, template)
    const assetsPath = generator.getAssetsPath()

    const srcFolder = outputFolder.subFolders[0]
    const mainFile = srcFolder.files[0]

    expect(assetsPath).toBeDefined()
    expect(mainFile.content).not.toContain(`import '~/assets/style.css'`)
    expect(outputFolder.name).toBe(template.name)
    expect(srcFolder.files[0].name).toBe('main')
    expect(srcFolder.files[0].fileType).toBe('js')
  })

  it('runs without crashing with project style sheets', async () => {
    const outputFolder = await generator.generateProject(uidlWithProjectStyleSheet, template)
    const assetsPath = generator.getAssetsPath()

    const srcFolder = outputFolder.subFolders[0]
    const mainFile = srcFolder.files[0]
    const assetsFoler = srcFolder.subFolders[0]

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(srcFolder.files[0].name).toBe('main')
    expect(srcFolder.files[0].fileType).toBe('js')
    expect(mainFile.content).toContain(`import \"~/./assets/style.css`)
    expect(assetsFoler.files.length).toBe(1)
    expect(assetsFoler.files[0].name).toBe('style')
    expect(assetsFoler.files[0].content).toContain(`.primaryButton`)
  })

  it('runs without crashing with external dependencies with supported syntaxes', async () => {
    const outputFolder = await generator.generateProject(uidlSampleWithExternalDependency, template)
    const assetsPath = generator.getAssetsPath()

    const packageJSON = outputFolder.files[0]
    const pages = outputFolder.subFolders[0].subFolders[0]
    const components = outputFolder.subFolders[0].subFolders[1]

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(packageJSON).toBeDefined()
    expect(pages.files.length).toBe(3)
    expect(components.files.length).toBe(4)

    /*
     * Support for external dependencies for Nuxt is same as Vue
     * For further details, refer --> https://github.com/teleporthq/teleport-code-generators/pull/478
     */

    expect(components.files[2].content).toContain(`import { Button } from 'antd'`)
    expect(packageJSON.content).toContain(`"antd": "4.5.4"`)
    expect(packageJSON.content).toContain(`"dangerous-html": "0.1.9"`)

    /** For Nuxt based projects, just imports are injected in index file of the routes */
    expect(pages.files[0].content).toContain(`import 'antd/dist/antd.css'`)
    expect(pages.files[0].content).toContain(
      `import DangerousHTML from 'dangerous-html/dist/vue/lib.mjs'`
    )
  })

  it('creates a default route if a page is marked as fallback', async () => {
    const { subFolders } = await generator.generateProject(fallbackUidlSample, template)
    const pages = subFolders
      .find((folder) => folder.name === 'src')
      ?.subFolders.find((folder) => folder.name === 'pages')
    const fallbackPage = pages?.files.find((file) => file.name === '404')

    expect(fallbackPage).toBeDefined()
  })

  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample, template)

    await expect(result).rejects.toThrow(Error)
  })
})
