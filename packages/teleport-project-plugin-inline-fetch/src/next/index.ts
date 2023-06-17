import { ProjectPluginStructure } from '@teleporthq/teleport-types'
import { createNextComponentInlineFetchPlugin } from './utils'

export const nextBeforeModifier = (structure: ProjectPluginStructure) => {
  const pluginNextInlineFetch = createNextComponentInlineFetchPlugin({ files: structure.files })

  structure.strategy.pages.plugins.push(pluginNextInlineFetch)
  structure.strategy.components.plugins.push(pluginNextInlineFetch)
  return structure
}

export const nextAfterModifier = (structure: ProjectPluginStructure) => {
  return structure
}
