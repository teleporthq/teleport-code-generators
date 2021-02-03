import {
  FileType,
  ProjectPlugin,
  ProjectPluginStructure,
  ReactStyleVariation,
} from '@teleporthq/teleport-types'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css-modules'

class PluginNextCSSModules implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    const { strategy } = structure

    if (strategy.id !== 'teleport-project-next') {
      throw new Error('Plugin can be used only with teleport-project-next')
    }

    strategy.style = ReactStyleVariation.CSSModules
    if (strategy?.projectStyleSheet?.generator) {
      strategy.projectStyleSheet.plugins = [createStyleSheetPlugin({ moduleExtension: true })]
      strategy.framework.config.isGlobalStylesDependent = false
    }
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
