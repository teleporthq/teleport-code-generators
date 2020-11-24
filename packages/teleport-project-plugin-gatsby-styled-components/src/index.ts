import { ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { createCustomReactGatsbyComponentGenerator } from '@teleporthq/teleport-project-generator-gatsby'
import reactStyledComponentsPlugin, {
  createStyleSheetPlugin,
} from '@teleporthq/teleport-plugin-react-styled-components'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import headConfigPlugin from '@teleporthq/teleport-plugin-jsx-head-config'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

class PluginGatsbyStyledComponents implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    const { strategy } = structure
    const reactComponentGenerator = createCustomReactGatsbyComponentGenerator()
    reactComponentGenerator.addPlugin(reactStyledComponentsPlugin)
    reactComponentGenerator.addPlugin(importStatementsPlugin)

    const reactPagesGenerator = createCustomReactGatsbyComponentGenerator([headConfigPlugin])
    reactPagesGenerator.addPlugin(reactStyledComponentsPlugin)
    reactPagesGenerator.addPlugin(importStatementsPlugin)

    const projectStyleSheetGenerator = createComponentGenerator()
    projectStyleSheetGenerator.addPlugin(createStyleSheetPlugin())
    projectStyleSheetGenerator.addPlugin(importStatementsPlugin)
    projectStyleSheetGenerator.addPostProcessor(prettierJS)

    strategy.components.generator = reactComponentGenerator
    strategy.pages.generator = reactPagesGenerator
    strategy.projectStyleSheet = {
      generator: projectStyleSheetGenerator,
      path: ['src'],
      fileName: 'style',
    }

    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    return structure
  }
}

const pluginGatsbyStyleedComponents = new PluginGatsbyStyledComponents()
export { PluginGatsbyStyledComponents }
export default pluginGatsbyStyleedComponents
