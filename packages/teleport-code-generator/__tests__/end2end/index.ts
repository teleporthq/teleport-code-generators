import {
  createNextProjectGenerator,
  NextTemplate,
} from '@teleporthq/teleport-project-generator-next'
import { ProjectPluginCSSModules } from '../../../teleport-project-plugin-css-modules'
import { ProjectPluginStyledComponents } from '../../../teleport-project-plugin-styled-components'
import projectUIDL from '../../../../examples/test-samples/project-with-import-global-styles.json'
import { FileType, ProjectType } from '@teleporthq/teleport-types'
import uidlSample from '../../../../examples/test-samples/project-sample.json'
import uidlSampleWithExternalDependencies from '../../../../examples/test-samples/project-sample-with-dependency.json'
import uidlSampleWithJustTokens from '../../../../examples/test-samples/project-with-only-tokens.json'
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'

describe('Generates NEXT-JS project with plugins', () => {
  it('NEXT + css-modules plugin', async () => {
    const generator = createNextProjectGenerator()
    generator.addPlugin(new ProjectPluginCSSModules({ framework: ProjectType.NEXT }))
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
    expect(nextConfig).toBeDefined()
    expect(pages.files.length).toBe(6)
    expect(styleModule).toBeDefined()
    expect(styleModule.name).toBe('style.module')
    expect(appRoot).toBeDefined()
    expect(appRoot.content).toContain(`import './style.module.css'`)
  })

  it('NEXT + StyledComponents', async () => {
    const generator = createNextProjectGenerator()
    generator.addPlugin(new ProjectPluginStyledComponents({ framework: ProjectType.NEXT }))
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
    expect(packgeJSON.content).toContain(`"styled-components": "^5.3.0"`)
    expect(packgeJSON.content).toContain(`"styled-system": "^5.1.5"`)
    expect(pages.files.length).toBe(6)
    expect(styleModule).toBeDefined()
    expect(styleModule.content).toContain(`import { variant } from 'styled-system'`)
    expect(document).toBeDefined()
    expect(document.content).toContain(`import { ServerStyleSheet } from 'styled-components'`)
    expect(document.content).toContain(`const sheet = new ServerStyleSheet()`)
    expect(document.content).toContain(`{this.props.styleTags}`)
    expect(appFile.content).not.toContain(`import "./style.css"`)
  })
})
