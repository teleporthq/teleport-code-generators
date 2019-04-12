import { ComponentDependency } from '@teleporthq/teleport-types-uidl-definitions'
import { ChunkDefinition } from '@teleporthq/teleport-types-generator'
export declare const extractExternalDependencies: (
  dependencies: Record<string, ComponentDependency>
) => Record<string, string>
export declare const groupChunksByFileId: (
  chunks: ChunkDefinition[]
) => Record<string, ChunkDefinition[]>
