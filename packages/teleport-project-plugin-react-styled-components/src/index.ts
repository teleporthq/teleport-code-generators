import {
  ProjectPlugin,
  ProjectPluginStructure,
  ReactStyleVariation,
} from '@teleporthq/teleport-types'
import {
  createStyleSheetPlugin,
  createReactStyledComponentsPlugin,
} from '@teleporthq/teleport-plugin-react-styled-components'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import reactAppRoutingPlugin from '@teleporthq/teleport-plugin-react-app-routing'

const STYLED_DEPENDENCIES: Record<string, string> = {
  'styled-components': '^5.3.0',
}

class PluginReactStyledComponents implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    const { strategy } = structure

    strategy.style = ReactStyleVariation.StyledComponents
    if (strategy?.projectStyleSheet?.generator) {
      strategy.projectStyleSheet.plugins = [createStyleSheetPlugin(), importStatementsPlugin]
      strategy.router = {
        ...strategy.router,
        plugins: [
          createReactStyledComponentsPlugin(),
          reactAppRoutingPlugin,
          importStatementsPlugin,
        ],
      }
      if (strategy.framework?.config) {
        strategy.framework.config.isGlobalStylesDependent = false
      }
    }

    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { dependencies } = structure

    Object.keys(STYLED_DEPENDENCIES).forEach((dep: string) => {
      dependencies[dep] = STYLED_DEPENDENCIES[dep]
    })

    return structure
  }
}

const pluginReactStyledComponennts = new PluginReactStyledComponents()
export { PluginReactStyledComponents }
export default pluginReactStyledComponennts
