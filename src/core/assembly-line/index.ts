import { extractExternalDependencies, groupChunksByFileId } from './utils'

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
        try {
          const modifiedStructure = await previousPluginOperation
          return plugin(modifiedStructure)
        } catch (err) {
          console.warn(
            `The plugin ${
              plugin.name
            } failed. Process continues. Moving forward to the next plugin.`,
            err
          )
        }
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

  public addPlugin(plugin: ComponentPlugin) {
    this.plugins.push(plugin)
  }
}
