import { FileType, GeneratedFolder } from '@teleporthq/teleport-types'
import fallbackUidlSample from '../../../../examples/uidl-samples/tests.json'
import uidlSample from '../../../../examples/test-samples/project-sample.json'
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
import uidlSampleWithDependencies from '../../../../examples/test-samples/project-sample-with-dependency.json'
import uidlSampleWithoutProjectStyleesButImports from './project-with-import-without-global-styles.json'
import uidlSampleWithProjectStyleSheet from '../../../../examples/test-samples/project-with-import-global-styles.json'
import uidlSampleWithJustTokens from '../../../../examples/test-samples/project-with-only-tokens.json'
import uidlSampleWithMultiplePagesWithSameName from './project-with-same-page-names-in-diff-routes.json'
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
    const appFile = publicFolder?.files.find((file) => file.name === '_app')

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(outputFolder.files[0].name).toBe('package')
    expect(appFile).toBeDefined()
    expect(appFile?.content).toContain(`import "antd/dist/antd.css`)
  })

  it('runs without crashing and adding style sheet to _app.js file', async () => {
    const outputFolder = await generator.generateProject(uidlSampleWithProjectStyleSheet, template)
    const assetsPath = generator.getAssetsPath()

    const publicFolder = outputFolder.subFolders.find((folder) => folder.name === 'pages')
    const appFile = publicFolder?.files.find((file) => file.name === '_app')

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(outputFolder.files[0].name).toBe('package')
    expect(appFile).toBeDefined()
    expect(appFile?.content).not.toContain(`import "antd/dist/antd.css`)
    expect(appFile?.content).toContain(`import './style.css'`)
  })

  it('runs without crashing and adding external dependencies', async () => {
    const outputFolder = await generator.generateProject(uidlSampleWithDependencies, template)

    const pages = outputFolder.subFolders[1]

    expect(pages.files[0].content).toContain(`import Script from 'dangerous-html/react'`)
    expect(pages.files[0].content).toContain(`Page 1<Modal></Modal>`)
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

  it('runs without crashing and adds import of style sheet in _app.js', async () => {
    const result = await generator.generateProject(uidlSampleWithJustTokens, template)

    const pagesFolder = result.subFolders.find((folder) => folder.name === 'pages')
    const styleSheet = pagesFolder?.files.find(
      (file) => file.name === 'style' && file.fileType === FileType.CSS
    )
    const appFile = pagesFolder?.files.find(
      (file) => file.name === '_app' && file.fileType === FileType.JS
    )

    expect(styleSheet).toBeDefined()
    expect(styleSheet?.content).toContain(`--greys-500: #595959`)
    expect(appFile).toBeDefined()
    expect(appFile?.content).toContain(`import './style.css'`)
  })

  it('creates a default route if a page is marked as fallback', async () => {
    const { subFolders } = await generator.generateProject(fallbackUidlSample, template)
    const pages = subFolders.find((folder) => folder.name === 'pages')
    const fallbackPage = pages?.files.find((file) => file.name === '404')

    expect(fallbackPage).toBeDefined()
  })

  it('creates a next project and generates the named-slot for passing components', async () => {
    const { subFolders } = await generator.generateProject(fallbackUidlSample, template)
    const pages = subFolders.find((folder) => folder.name === 'pages')
    const components = subFolders.find((folder) => folder.name === 'components')
    const indexPage = pages?.files.find((file) => file.name === 'index')
    const heroComponent = components?.files.find((file) => file.name === 'hero')

    expect(indexPage).toMatchSnapshot()
    expect(heroComponent).toMatchSnapshot()
  })

  it('preserves the pages with same name if they are defined in different routes', async () => {
    const { subFolders } = await generator.generateProject(uidlSampleWithMultiplePagesWithSameName)
    const pagesFolder = getFolderFromSubFolders('pages', subFolders)

    expect(pagesFolder).toBeDefined()

    const booksFolder = getFolderFromSubFolders('book', pagesFolder?.subFolders)
    expect(booksFolder).toBeDefined()
    const hasPageInsideBooksFolder = booksFolder?.files.find((file) => file.name === 'page')
    expect(hasPageInsideBooksFolder).toBeDefined()

    const blogFolder = getFolderFromSubFolders('blog', pagesFolder?.subFolders)
    expect(blogFolder).toBeDefined()
    expect(blogFolder?.files?.length).toBe(2)

    const hasPageInsideBlogFolder = blogFolder?.files.find((file) => file.name === 'page')
    const hasDuplicatedPageInsideBlogFolder = blogFolder?.files.find(
      (file) => file.name === 'page1'
    )
    expect(hasPageInsideBlogFolder).toBeDefined()
    expect(hasDuplicatedPageInsideBlogFolder).toBeDefined()
  })

  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample, template)

    await expect(result).rejects.toThrow(Error)
  })
})

const getFolderFromSubFolders = (folderName: string, folders: GeneratedFolder[] = []) =>
  folders.find((folder) => folder.name === folderName)
