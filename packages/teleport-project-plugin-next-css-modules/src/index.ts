import {
  FileType,
  GeneratedFile,
  Mapping,
  ProjectPlugin,
  ProjectPluginStructure,
  ReactStyleVariation,
} from '@teleporthq/teleport-types'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { NextMapping } from '@teleporthq/teleport-project-generator-next'
import { createJSXHeadConfigPlugin } from '@teleporthq/teleport-plugin-jsx-head-config'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css-modules'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

class PluginNextCSSModules implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    const { strategy } = structure
    const reactComponentGenerator = createReactComponentGenerator(ReactStyleVariation.CSSModules)
    reactComponentGenerator.addMapping(NextMapping as Mapping)

    const headConfigPlugin = createJSXHeadConfigPlugin({
      configTagIdentifier: 'Head',
      configTagDependencyPath: 'next/head',
      isExternalPackage: false,
    })

    const reactPageGenerator = createReactComponentGenerator(ReactStyleVariation.CSSModules, {
      plugins: [headConfigPlugin],
      mappings: [NextMapping as Mapping],
    })

    const styleSheetGenerator = createComponentGenerator()
    styleSheetGenerator.addPlugin(createStyleSheetPlugin())

    strategy.components.generator = reactComponentGenerator
    strategy.pages.generator = reactPageGenerator
    strategy.projectStyleSheet = {
      generator: styleSheetGenerator,
      fileName: 'style',
      path: ['pages'],
    }
    strategy.framework.config.isGlobalStylesDependent = false

    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { rootFolder, files, dependencies, template } = structure
    const configFile = template.files.find(
      (file) => file.name === 'next.config' && file.fileType === FileType.JS
    )

    let appFile: GeneratedFile | null

    const publicFolder = template.subFolders.find((folder) => folder.name === 'pages')
    if (publicFolder) {
      appFile = publicFolder.files.find((file) => file.name === '_app')
      if (appFile) {
        /* Modify from template */
      }
    }

    if (files.has('_app') && !appFile) {
      const appFileContent = files.get('_app').files[0].content

      files.set('_app', {
        rootFolder,
        path: files.get('_app').path,
        files: [
          {
            name: '_app',
            fileType: FileType.JS,
            content: `import "./style.module.css" \n
${appFileContent}
`,
          },
        ],
      })
    }

    if (files.has('next.config') || configFile) {
      // const content = configFile.content
      /* Config already exists so edit the existing one */
      return structure
    }

    files.set('next.config', {
      rootFolder,
      path: [],
      files: [
        {
          name: 'next.config',
          fileType: FileType.JS,
          content: `const withCSS = require('@zeit/next-css')
module.exports = withCSS({
  cssModules: true
})`,
        },
      ],
    })

    dependencies['@zeit/next-css'] = '^1.0.1'
    return structure
  }
}

const pluginNextCSSModules = new PluginNextCSSModules()
export { PluginNextCSSModules }
export default pluginNextCSSModules
