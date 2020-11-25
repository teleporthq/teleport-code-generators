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
    const { files, dependencies } = structure
    const appFileContent = files.get('_app').files[0].content

    files.set('_app', {
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

    files.set('next.config', {
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
