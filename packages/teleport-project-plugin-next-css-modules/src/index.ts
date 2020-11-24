import {
  FileType,
  Mapping,
  ProjectPlugin,
  ProjectPluginStructure,
  ReactStyleVariation,
} from '@teleporthq/teleport-types'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { NextMapping } from '@teleporthq/teleport-project-generator-next'

class PluginNextCSSModules implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    const reactComponentGenerator = createReactComponentGenerator(ReactStyleVariation.CSSModules)
    reactComponentGenerator.addMapping(NextMapping as Mapping)

    structure.strategy.components.generator = reactComponentGenerator
    structure.strategy.pages.generator = reactComponentGenerator
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { rootFolder, files, dependencies } = structure
    if (files.has('next.config')) {
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
