import {
  ComponentDependency,
  ElementsMapping,
  ComponentUIDL,
  ContentNode,
} from '../../uidl-definitions/types'

export interface EmbedDefinition {
  chunkName: string
  slot: string
}

/**
 * React could have one or more JS chunks, nothing else.
 * Vue has a template chunk, of type XML/HTML, a javascript
 * chunk and a style chunk
 */
export interface ChunkDefinition {
  type: string
  name: string
  meta?: any | null
  wrap?: (content: string) => string
  content: any
  linker?: {
    slots?: {
      [key: string]: (chunks: ChunkDefinition[]) => any
    }
    after?: string[]
    embed?: EmbedDefinition
  }
}

/**
 * The structure of a component contains multiple chunks, and information
 * about how these chunks work togather
 */
export interface ComponentStructure {
  chunks: ChunkDefinition[]
  meta: any
  uidl: ComponentUIDL
  dependencies: Record<string, ComponentDependency>
}

/**
 * A consumer (plugin basically) is
 */
export type ComponentPlugin = (structure: ComponentStructure) => Promise<ComponentStructure>

/**
 * Configure a componnet plugin, specifing names or ids for chunks, to be later
 * used between other plugins and by the linker.
 */
interface ComponentDefaultPluginParams {
  fileId: string
}
export type ComponentPluginFactory<T> = (
  configuration?: Partial<T & ComponentDefaultPluginParams>
) => ComponentPlugin

export interface CompiledComponent {
  code: string
  externalCSS?: string
  dependencies: Record<string, ComponentDependency>
}

export interface ComponentGenerator {
  generateComponent: (uidl: ComponentUIDL, options?: GeneratorOptions) => Promise<CompiledComponent>
  resolveContentNode: (node: ContentNode, options?: GeneratorOptions) => ContentNode
  addPlugin: (plugin: ComponentPlugin) => void
  addMapping: (mapping: ElementsMapping) => void
}

export interface GeneratorOptions {
  localDependenciesPrefix?: string
  assetsPrefix?: string
  customMapping?: ElementsMapping
}

export type GeneratorFunction = (content: any) => string

/**
 * This structure is used for keeping information about a single state key while creating a component
 */
export interface StateIdentifier {
  key: string
  type: string
  setter: string
  default: any
}

export enum ReactComponentStylingFlavors {
  InlineStyles = 'InlineStyles',
  StyledJSX = 'StyledJSX',
  JSS = 'JSS',
  CSSModules = 'CSSModules',
}
