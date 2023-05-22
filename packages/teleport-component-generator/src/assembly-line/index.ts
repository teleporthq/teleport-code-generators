import { groupChunksByFileType } from './utils'
import {
  ComponentStructure,
  ComponentPlugin,
  ComponentUIDL,
  GeneratorOptions,
} from '@teleporthq/teleport-types'
import { UIDLUtils } from '@teleporthq/teleport-shared'

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

    const externalDependencies = {
      ...UIDLUtils.extractExternalDependencies(finalStructure?.dependencies || {}),
      ...UIDLUtils.extractExternalDependencies(finalStructure.uidl?.peerDefinitions || {}),
    }
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
