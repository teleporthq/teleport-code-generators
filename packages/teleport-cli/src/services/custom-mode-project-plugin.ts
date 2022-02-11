import {
  ProjectPlugin,
  ProjectPluginStructure,
  ReactStyleVariation,
} from '@teleporthq/teleport-types'

class PluginCustomModeProjects implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    const { strategy } = structure
    const teleportPath = ['src', 'teleporthq']

    strategy.style = ReactStyleVariation.CSSModules
    strategy.pages.path = [...teleportPath, 'pages']
    strategy.components.path = [...teleportPath, 'components']
    strategy.projectStyleSheet.path = teleportPath

    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { files } = structure
    files.delete('entry')
    files.delete('router')
    files.delete('projectStyleSheet')

    return structure
  }
}

const pluginCustomMode = new PluginCustomModeProjects()
export { pluginCustomMode }
