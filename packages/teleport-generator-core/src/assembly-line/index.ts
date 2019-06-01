import { extractExternalDependencies, groupChunksByFileId } from './utils'
import { ComponentStructure, ComponentPlugin, ComponentUIDL } from '@teleporthq/teleport-types'

export default class AssemblyLine {
  private plugins: ComponentPlugin[]

  constructor(plugins: ComponentPlugin[] = []) {
    this.plugins = plugins
  }

  public async run(
    uidl: ComponentUIDL,
    initialStructure: ComponentStructure = {
      uidl,
      chunks: [],
      dependencies: {},
    }
  ) {
    const structure = initialStructure

    const finalStructure: ComponentStructure = await this.plugins.reduce(
      async (previousPluginOperation: Promise<any>, plugin) => {
        const modifiedStructure = await previousPluginOperation
        return plugin(modifiedStructure)
      },
      Promise.resolve(structure)
    )

    const externalDependencies = extractExternalDependencies(finalStructure.dependencies)
    const chunks = groupChunksByFileId(finalStructure.chunks)

    return {
      chunks,
      externalDependencies,
    }
  }

  public getPlugins() {
    return this.plugins
  }

  public addPlugin(plugin: ComponentPlugin) {
    this.plugins.push(plugin)
  }
}
