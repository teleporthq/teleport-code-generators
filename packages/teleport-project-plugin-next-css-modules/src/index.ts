import {
  FileType,
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
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

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
    const { files, devDependencies } = structure
    const appFileContent = files.get('_app').files[0].content
    const content = `import "./style.module.css" \n
    ${appFileContent}
    `

    const formattedCode = prettierJS({ [FileType.JS]: content })

    files.set('_app', {
      path: files.get('_app').path,
      files: [
        {
          name: '_app',
          fileType: FileType.JS,
          content: formattedCode[FileType.JS],
        },
      ],
    })

    const nextContent = prettierJS({
      [FileType.JS]: `const withCSS = require('@zeit/next-css')
    module.exports = withCSS({
      cssModules: true
    })`,
    })

    files.set('next.config', {
      path: [],
      files: [
        {
          name: 'next.config',
          fileType: FileType.JS,
          content: nextContent[FileType.JS],
        },
      ],
    })

    devDependencies['@zeit/next-css'] = '^1.0.1'
    return structure
  }
}

const pluginNextCSSModules = new PluginNextCSSModules()
export { PluginNextCSSModules }
export default pluginNextCSSModules
