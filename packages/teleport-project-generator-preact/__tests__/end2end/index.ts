import { FileType } from '@teleporthq/teleport-types'
import fallbackUidlSample from '../../../../examples/uidl-samples/project.json'
import uidlSampleWithDependencies from '../../../../examples/test-samples/project-sample-with-dependency.json'
import uidlSample from '../../../../examples/test-samples/project-sample.json'
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
import uidlSampleWithJustTokens from '../../../../examples/test-samples/project-with-only-tokens.json'
import template from './template-definition.json'
import { createPreactProjectGenerator } from '../../src'

describe('Preact Project Generator', () => {
  const generator = createPreactProjectGenerator()

  it('runs without crashing with external dependencies', async () => {
    const outputFolder = await generator.generateProject(uidlSample, template)
    const assetsPath = generator.getAssetsPath()

    const srcFolder = outputFolder.subFolders[0]
    const componentFiles = srcFolder.subFolders[0].files
    const packageJSON = outputFolder.files[0]

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(packageJSON).toBeDefined()
    expect(packageJSON.name).toBe('package')
    expect(srcFolder.files[0].name).toBe('index')
    expect(srcFolder.files[0].fileType).toBe('html')
    expect(srcFolder.subFolders[0].name).toBe('components')
    expect(srcFolder.subFolders[1].name).toBe('routes')
    expect(componentFiles.length).toBe(6)
    expect(componentFiles[componentFiles.length - 1].fileType).toBe('js')
    expect(componentFiles[componentFiles.length - 1].name).toBe('app')
  })

  it('runs without crashing with external dependencies', async () => {
    const outputFolder = await generator.generateProject(uidlSampleWithDependencies, template)
    const assetsPath = generator.getAssetsPath()

    const srcFolder = outputFolder.subFolders[0]
    const componentFiles = srcFolder.subFolders[0].files
    const packageJSON = outputFolder.files[0]
    const modalComponent = componentFiles[3]
    const routes = srcFolder.subFolders[1]

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(packageJSON).toBeDefined()
    expect(packageJSON.name).toBe('package')
    expect(packageJSON.content).toContain(`{
  "name": "myvueproject",
  "version": "1.0.0",
  "description": "Project generated based on a UIDL document",
  "dependencies": {
    "dangerous-html": "0.1.12",
    "@lottiefiles/react-lottie-player": "3.4.7",
    "react-helmet": "^6.1.0",
    "prop-types": "15.7.2",
    "antd": "4.5.4"
  }
}`)
    expect(srcFolder.files[0].name).toBe('index')
    expect(srcFolder.files[0].fileType).toBe('html')
    expect(srcFolder.subFolders[0].name).toBe('components')

    expect(componentFiles.length).toBe(6)
    expect(componentFiles[componentFiles.length - 1].fileType).toBe('js')
    expect(componentFiles[componentFiles.length - 1].name).toBe('app')
    expect(componentFiles[componentFiles.length - 1].content).not.toContain(
      `import '../routes/style.css'`
    )
    expect(modalComponent.content).toContain(
      `<Button type="primary" onClick={() => setIsOpen(true)}>
        Show Popup
      </Button>`
    )
    expect(modalComponent.content).toContain(`import { Button } from 'antd'`)

    expect(routes).toBeDefined()
    expect(routes.subFolders[0]).toBeDefined()
    expect(routes.subFolders[0].name).toBe('index')
    expect(routes.subFolders[0].files[0].content).toContain(`import 'dangerous-html'`)
    expect(routes.subFolders[0].files[0].content).toContain(`Page 1<Modal></Modal>`)
    expect(routes.subFolders[0].files[0].content).toContain(
      `<div class={styles['div']}>
        <dangerous-html
          html={\`<blockquote class='twitter-tweet'><p lang='en' dir='ltr'>Feels like the last 20 mins of Don’t Look Up right about now…</p>&mdash; Netflix (@netflix) <a href='https://twitter.com/netflix/status/1593420772948598784?ref_src=twsrc%5Etfw'>November 18, 2022</a></blockquote> <script async src='https://platform.twitter.com/widgets.js'></script>\`}
        ></dangerous-html>
      </div>`
    )

    /** Imports which are just inserted and left like css one's are added directly in app.js file */
    expect(componentFiles[componentFiles.length - 1].content).toContain(
      `import 'antd/dist/antd.css'`
    )
  })

  it('runs without crashing and using only tokens', async () => {
    const result = await generator.generateProject(uidlSampleWithJustTokens, template)
    const styleSheet = result.subFolders[0].files.find(
      (file) => file.name === 'global-style.module' && file.fileType === FileType.CSS
    )
    const components = result.subFolders[0].subFolders.find(
      (folder) => folder.name === 'components'
    )
    const index = components.files.find(
      (file) => file.name === 'app' && file.fileType === FileType.JS
    )

    expect(styleSheet).toBeDefined()
    expect(styleSheet.content).toContain(`--greys-500: #595959`)
    expect(index).toBeDefined()
    expect(index.content).toContain(`import '../global-style.module.css'`)
  })

  it('creates a default route if a page is marked as fallback', async () => {
    const { subFolders } = await generator.generateProject(fallbackUidlSample, template)
    const pages = subFolders
      .find((folder) => folder.name === 'src')
      ?.subFolders.find((folder) => folder.name === 'components')
    const routesPage = pages?.files.find((file) => file.name === 'app')

    expect(routesPage).toBeDefined()
    expect(routesPage?.content).toContain(`<Fallback default />`)
  })

  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample, template)

    await expect(result).rejects.toThrow(Error)
  })
})
