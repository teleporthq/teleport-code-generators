import { ComponentPlugin, ComponentStructure, ChunkDefinition } from '../../shared/types'

import { ComponentUIDL } from '../../uidl-definitions/types'

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

    return {
      chunks: finalStructure.chunks,
      dependencies: finalStructure.dependencies,
    }
  }

  public addPlugin(plugin: ComponentPlugin) {
    this.plugins.push(plugin)
  }

  public groupChunksByFileId(chunks: ChunkDefinition[]): Record<string, ChunkDefinition[]> {
    return chunks.reduce((chunksByFileId: Record<string, ChunkDefinition[]>, chunk) => {
      const fileId = (chunk.meta && chunk.meta.fileId) || 'default'
      if (!chunksByFileId[fileId]) {
        chunksByFileId[fileId] = []
      }
      chunksByFileId[fileId].push(chunk)
      return chunksByFileId
    }, {})
  }
}
