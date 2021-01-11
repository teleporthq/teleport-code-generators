import { FileType } from '@teleporthq/teleport-types'
import uidlSampleWithExternalDependencies from '../../../../examples/test-samples/project-sample-with-dependency.json'
import uidlSample from '../../../../examples/test-samples/project-sample.json'
import uidlSampleWithJustTokens from '../../../../examples/test-samples/project-with-only-tokens.json'
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
import template from './template-definition.json'
import { createReactProjectGenerator } from '../../src'

describe('React Project Generator', () => {
  const generator = createReactProjectGenerator()

  it('runs without crashing', async () => {
    const outputFolder = await generator.generateProject(
      (uidlSample as unknown) as Record<string, unknown>,
      template
    )
    const assetsPath = generator.getAssetsPath()
    const srcFolder = outputFolder.subFolders[0]
    const publicFolder = outputFolder.subFolders[1]
    const packageJSON = outputFolder.files[0]
    const componentsFoler = srcFolder.subFolders[0]

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(packageJSON.name).toBe('package')
    expect(srcFolder.files[0].name).toBe('index')
    expect(srcFolder.files[0].fileType).toBe('js')
    expect(publicFolder.files[0].name).toBe('manifest')
    expect(publicFolder.files[0].fileType).toBe('json')
    expect(publicFolder.files[1].name).toBe('index')
    expect(publicFolder.files[1].fileType).toBe('html')
    expect(componentsFoler.name).toBe('components')
    expect(srcFolder.subFolders[1].name).toBe('pages')
  })

  it('runs without crashing with external dependencies', async () => {
    const outputFolder = await generator.generateProject(
      (uidlSampleWithExternalDependencies as unknown) as Record<string, unknown>,
      template
    )
    const assetsPath = generator.getAssetsPath()
    const srcFolder = outputFolder.subFolders[0]
    const publicFolder = outputFolder.subFolders[1]
    const viewsFolder = srcFolder.subFolders[3]
    const packageJSON = outputFolder.files[0]
    const componentsFoler = srcFolder.subFolders[0]
    const modalComponent = componentsFoler.files[3]

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(packageJSON.name).toBe('package')
    expect(srcFolder.files[0].name).toBe('index')
    expect(srcFolder.files[0].fileType).toBe('js')
    expect(srcFolder.files[0].content).not.toContain(`import './style.module.css'`)
    expect(publicFolder.files[0].name).toBe('manifest')
    expect(publicFolder.files[0].fileType).toBe('json')
    expect(publicFolder.files[1].name).toBe('index')
    expect(publicFolder.files[1].fileType).toBe('html')
    expect(componentsFoler.name).toBe('components')
    expect(srcFolder.subFolders[1].name).toBe('pages')

    /*
     * For react based projects we just import the componetns wherever they are being used
     * and external dependencies are added to package.json
     *
     * External dependencies have first class support for react. For other frameworks and variants,
     * please refer --> https://github.com/teleporthq/teleport-code-generators/pull/478
     */

    expect(packageJSON.content).toContain(`{
  "name": "myvueproject",
  "version": "1.0.0",
  "description": "Project generated based on a UIDL document",
  "dependencies": {
    "react-helmet": "^6.1.0",
    "prop-types": "15.7.2",
    "antd": "4.5.4"
  }
}`)
    expect(modalComponent).toBeDefined()
    expect(modalComponent.content).toContain(`import { Button } from 'antd'`)
    expect(modalComponent.content).toContain(
      `<Button type="primary" onClick={() => setIsOpen(true)}>
        Show Popup
      </Button>`
    )
    expect(viewsFolder.files[0].content).toContain(`import Modal from '../components/modal'`)
    expect(viewsFolder.files[0].content).toContain(`Page 1<Modal></Modal>`)
    /* Imports that are just need to be inserted are added to router file by default */
    expect(srcFolder.files[0].content).toContain(`import 'antd/dist/antd.css'`)
  })

  it('runs without crashing and using only tokens', async () => {
    const result = await generator.generateProject(uidlSampleWithJustTokens, template)
    const srcFolder = result.subFolders.find((folder) => folder.name === 'src')
    const styleSheet = srcFolder.files.find(
      (file) => file.name === 'style.module' && file.fileType === FileType.CSS
    )
    const index = srcFolder.files.find(
      (file) => file.name === 'index' && file.fileType === FileType.JS
    )

    expect(styleSheet).toBeDefined()
    expect(styleSheet.content).toContain(`--greys-500: #595959`)
    expect(index).toBeDefined()
    expect(index.content).toContain(`import './style.module.css'`)
  })

  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample, template)

    await expect(result).rejects.toThrow(Error)
  })
})
