import { ProjectPluginStructure, ProjectPlugin } from '@teleporthq/teleport-types'
import { createParseEmbedPlugin } from './component-plugin'
import { SUPPORTED_PROJECT_TYPES } from './utils'

export class ProjectPluginParseEmbed implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    const parseEmbedPlugin = createParseEmbedPlugin({
      projectType: structure.strategy.id as SUPPORTED_PROJECT_TYPES,
    })

    if (structure.strategy.pages?.plugins?.length > 0) {
      structure.strategy.pages.plugins.push(parseEmbedPlugin)
    } else {
      structure.strategy.pages.plugins = [parseEmbedPlugin]
    }

    if (structure.strategy.components?.plugins?.length > 0) {
      structure.strategy.components.plugins.push(parseEmbedPlugin)
    } else {
      structure.strategy.components.plugins = [parseEmbedPlugin]
    }

    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    return structure
  }
}
