import { ProjectPluginStructure } from '@teleporthq/teleport-types'
import { createInlineJSXFetchRequestsPlugins } from './utils'

export const jsxBeforeModifier = (structure: ProjectPluginStructure) => {
  const pluginJsxtInlineFetch = createInlineJSXFetchRequestsPlugins()

  structure.strategy.pages.plugins.push(pluginJsxtInlineFetch)
  structure.strategy.components.plugins.push(pluginJsxtInlineFetch)
  return structure
}

export const jsxAfterModifier = (structure: ProjectPluginStructure) => {
  return structure
}
