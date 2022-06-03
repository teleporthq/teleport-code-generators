import { ProjectPluginStructure, ReactStyleVariation } from '@teleporthq/teleport-types'
import {
  createStyleSheetPlugin,
  createReactStyledComponentsPlugin,
} from '@teleporthq/teleport-plugin-react-styled-components'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import reactAppRoutingPlugin from '@teleporthq/teleport-plugin-react-app-routing'
import { STYLED_DEPENDENCIES } from './constant'

export const reactBeforeModifier = async (structure: ProjectPluginStructure) => {
  const { strategy } = structure

  strategy.style = ReactStyleVariation.StyledComponents
  if (strategy?.projectStyleSheet?.generator) {
    strategy.projectStyleSheet.plugins = [createStyleSheetPlugin(), importStatementsPlugin]
    strategy.router = {
      ...strategy.router,
      plugins: [createReactStyledComponentsPlugin(), reactAppRoutingPlugin, importStatementsPlugin],
    }
    if (strategy.framework?.config) {
      strategy.framework.config.isGlobalStylesDependent = false
    }
  }
}

export const reactAfterModifier = async (structure: ProjectPluginStructure) => {
  const { dependencies } = structure
  Object.keys(STYLED_DEPENDENCIES).forEach((dep: string) => {
    dependencies[dep] = STYLED_DEPENDENCIES[dep]
  })
}
