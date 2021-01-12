import {
  createNextProjectGenerator,
  NextTemplate,
} from '@teleporthq/teleport-project-generator-next'
import {
  createGatsbyProjectGenerator,
  GatsbyTemplate as template,
} from '@teleporthq/teleport-project-generator-gatsby'
import pluginNextCSSModules from '@teleporthq/teleport-project-plugin-next-css-modules'
import pluginNextStyledComponents from '@teleporthq/teleport-project-plugin-next-styled-components'
import pluginGatsbyStyledComponents from '@teleporthq/teleport-project-plugin-gatsby-styled-components'
import projectUIDL from '../../../../examples/test-samples/project-with-import-global-styles.json'
import { FileType } from '@teleporthq/teleport-types'
import uidlSample from '../../../../examples/test-samples/project-sample.json'
import uidlSampleWithExternalDependencies from '../../../../examples/test-samples/project-sample-with-dependency.json'
import uidlSampleWithJustTokens from '../../../../examples/test-samples/project-with-only-tokens.json'
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'

describe('Generates NEXT-JS project with plugins', () => {
  it('NEXT + css-modules plugin', async () => {
    const generator = createNextProjectGenerator()
    generator.addPlugin(pluginNextCSSModules)
    const result = await generator.generateProject(projectUIDL, NextTemplate)

    const nextConfig = result.files.find(
      (file) => file.name === 'next.config' && file.fileType === FileType.JS
    )
    const packageJSON = result.files.find((file) => file.name === 'package')
    const pages = result.subFolders.find((folder) => folder.name === 'pages')
    const styleModule = pages.files.find((file) => file.fileType === FileType.CSS)
    const appRoot = pages.files.find((file) => file.name === '_app')

    expect(result.files.length).toBe(2)
    expect(packageJSON).toBeDefined()
    expect(packageJSON.content).toContain(`@zeit/next-css`)
    expect(nextConfig).toBeDefined()
    expect(nextConfig.content).toContain(`const withCSS = require('@zeit/next-css')`)
    expect(pages.files.length).toBe(6)
    expect(styleModule).toBeDefined()
    expect(styleModule.name).toBe('style.module')
    expect(appRoot).toBeDefined()
    expect(appRoot.content).toContain(`import './style.module.css'`)
  })

  it('NEXT + StyledComponents', async () => {
    const generator = createNextProjectGenerator()
    generator.addPlugin(pluginNextStyledComponents)
    const result = await generator.generateProject(projectUIDL, NextTemplate)

    const babelRC = result.files.find((file) => file.name === `.babelrc`)
    const packgeJSON = result.files.find((file) => file.name === 'package')
    const pages = result.subFolders.find((folder) => folder.name === 'pages')
    const styleModule = pages.files.find(
      (file) => file.name === 'style' && file.fileType === FileType.JS
    )
    const document = pages.files.find(
      (file) => file.name === '_document' && file.fileType === FileType.JS
    )
    const appFile = pages.files.find(
      (file) => file.name === '_app' && file.fileType === FileType.JS
    )

    expect(babelRC).toBeDefined()
    expect(babelRC.content).toContain(`styled-components`)
    expect(packgeJSON).toBeDefined()
    expect(packgeJSON.content).toContain(`"styled-components": "4.2.0"`)
    expect(pages.files.length).toBe(6)
    expect(styleModule).toBeDefined()
    expect(styleModule.content).toContain(`import { css } from 'styled-components'`)
    expect(document).toBeDefined()
    expect(document.content).toContain(`import { ServerStyleSheet } from 'styled-components'`)
    expect(document.content).toContain(`const sheet = new ServerStyleSheet()`)
    expect(document.content).toContain(`{this.props.styleTags}`)
    expect(appFile.content).not.toContain(`import "./style.css"`)
  })
})

describe('Generates Gatsby Projects with plugins', () => {
  it('runs without crashing', async () => {
    const generator = createGatsbyProjectGenerator()
    generator.addPlugin(pluginGatsbyStyledComponents)
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

  it('runs without crashing with external dependencies', async () => {
    const generator = createGatsbyProjectGenerator()
    generator.addPlugin(pluginGatsbyStyledComponents)
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
    const generator = createGatsbyProjectGenerator()
    generator.addPlugin(pluginGatsbyStyledComponents)
    const result = await generator.generateProject(uidlSampleWithJustTokens, template)
    const srcFolder = result.subFolders.find((folder) => folder.name === 'src')
    const styleSheet = srcFolder.files.find(
      (file) => file.name === 'style' && file.fileType === FileType.JS
    )

    expect(styleSheet).toBeDefined()
    expect(styleSheet.content).toContain(`Greys700: "#999999"`)
  })

  it('throws error when conifg file is not found with custom framework config', async () => {
    const generator = createGatsbyProjectGenerator()
    generator.addPlugin(pluginGatsbyStyledComponents)
    const result = generator.generateProject(invalidUidlSample, template)

    await expect(result).rejects.toThrow(Error)
  })

  it('Gatsby + Styled Components', async () => {
    const generator = createGatsbyProjectGenerator()
    generator.addPlugin(pluginGatsbyStyledComponents)

    const result = await generator.generateProject(projectUIDL, template)
    const packageJSON = result.files.find(
      (file) => file.name === 'package' && file.fileType === FileType.JSON
    )
    const gatsbyConfig = result.files.find(
      (file) => file.name === 'gatsby-config' && file.fileType === FileType.JS
    )
    const [styleModule] = result.subFolders.map((file) => {
      if (file.name === 'src') {
        return file.files.find(
          (subFile) => subFile.name === 'style' && subFile.fileType === FileType.JS
        )
      }
    })

    expect(gatsbyConfig).toBeDefined()
    expect(gatsbyConfig.content).toContain(`gatsby-plugin-styled-components`)
    expect(styleModule).toBeDefined()
    expect(styleModule.content).toContain(`import { css } from "styled-components"`)
    expect(packageJSON).toBeDefined()
    expect(packageJSON.content).toContain(`"babel-plugin-styled-components": "^1.10.6"`)
    expect(packageJSON.content).toContain(`"gatsby-plugin-styled-components": "^3.0.0"`)
  })
})
