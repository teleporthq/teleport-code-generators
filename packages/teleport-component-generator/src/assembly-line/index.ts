import { extractExternalDependencies, groupChunksByFileType } from './utils'
import {
  ComponentStructure,
  ComponentPlugin,
  ComponentUIDL,
  GeneratorOptions,
} from '@teleporthq/teleport-types'

export default class AssemblyLine {
  private plugins: ComponentPlugin[]

  constructor(plugins: ComponentPlugin[] = []) {
    this.plugins = plugins
  }

  public async run(
    uidl: ComponentUIDL,
    options: GeneratorOptions,
    initialStructure: ComponentStructure = {
      uidl,
      options,
      chunks: [],
      dependencies: {},
    }
  ) {
    const structure = initialStructure

    const finalStructure: ComponentStructure = await this.plugins.reduce(
      async (previousPluginOperation: Promise<ComponentStructure>, plugin) => {
        const modifiedStructure = await previousPluginOperation
        return plugin(modifiedStructure)
      },
      Promise.resolve(structure)
    )

    const externalDependencies = extractExternalDependencies(finalStructure.dependencies)
    const chunks = groupChunksByFileType(finalStructure.chunks)

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
