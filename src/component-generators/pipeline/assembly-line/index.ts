import { ComponentPlugin, ComponentStructure } from '../../types'

import { ComponentUIDL } from '../../../uidl-definitions/types'

export default class ComponentAssemblyLine {
  private plugins: ComponentPlugin[]

  constructor(plugins: ComponentPlugin[] = []) {
    this.plugins = plugins
  }

  public async run(
    uidl: ComponentUIDL,
    initialStructure: ComponentStructure = {
      uidl,
      meta: null,
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

    return {
      chunks: finalStructure.chunks,
      dependencies: finalStructure.dependencies,
    }
  }

  public addPlugin(plugin: ComponentPlugin) {
    this.plugins.push(plugin)
  }
}
