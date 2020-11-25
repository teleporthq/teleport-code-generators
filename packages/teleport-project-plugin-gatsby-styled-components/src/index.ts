import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { createCustomReactGatsbyComponentGenerator } from '@teleporthq/teleport-project-generator-gatsby'
import reactStyledComponentsPlugin, {
  createStyleSheetPlugin,
} from '@teleporthq/teleport-plugin-react-styled-components'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import headConfigPlugin from '@teleporthq/teleport-plugin-jsx-head-config'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import MagicString from 'magic-string'
import { STYLED_DEPENDENCIES } from './constants'

class PluginGatsbyStyledComponents implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    const { strategy, template, rootFolder, dependencies } = structure

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

    const fileName = 'gatsby-config'
    const configFile = template.files.find(
      (file) => file.name === 'gatsby-config' && file.fileType === FileType.JS
    )

    if (!configFile || !configFile.content) {
      throw new Error(`${fileName} not found, while adding gatsby-plugin-styled-components`)
    }

    const parsedFile = configFile.content.replace('/n', '//n')
    const magic = new MagicString(parsedFile)
    magic.appendRight(parsedFile.length - 10, `,'gatsby-plugin-styled-components'`)

    const content = magic.toString()
    rootFolder.files.push({ name: 'gatsby-config', fileType: FileType.JS, content })

    Object.keys(STYLED_DEPENDENCIES).forEach((dep: string) => {
      dependencies[dep] = STYLED_DEPENDENCIES[dep]
    })

    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    return structure
  }
}

const pluginGatsbyStyleedComponents = new PluginGatsbyStyledComponents()
export { PluginGatsbyStyledComponents }
export default pluginGatsbyStyleedComponents
