import { ComponentStructure, ComponentPlugin } from '@teleporthq/teleport-types-generator'
import { ComponentUIDL } from '@teleporthq/teleport-types-uidl-definitions'
export default class AssemblyLine {
  private plugins
  constructor(plugins?: ComponentPlugin[])
  run(
    uidl: ComponentUIDL,
    initialStructure?: ComponentStructure
  ): Promise<{
    chunks: Record<string, import('@teleporthq/teleport-types-generator').ChunkDefinition[]>
    externalDependencies: Record<string, string>
  }>
  addPlugin(plugin: ComponentPlugin): void
}
